//! ChunkGraph — Hybrid Agent Orchestrator (production)
//!
//! Execution model (fast lane / slow lane):
//!   Stage 0 (local):      chit_chat_gate — zero LLM, fast exit for filler
//!   Stage 1 (concurrent): context_manager ‖ explanation
//!                         context_manager now also returns complexity, so this is
//!                         one hop instead of two. explanation runs on every route
//!                         and reads only chunk_text, so it needs nothing from
//!                         stage 1 and starts at t=0 rather than after it.
//!   Stage 2 (split):      routing::decide() selects the conditional agents.
//!                         • technical  — awaited, because response_agent reads it
//!                         • risk, analyst — DETACHED. response_agent never reads
//!                           their output, so blocking on them only delays the
//!                           reply. They are returned as `DetachedWork` for the
//!                           caller to poll and emit whenever they land.
//!   Stage 3 (sequential): response_agent synthesises chunk + explanation + technical
//!
//! Critical path is therefore 2 sequential LLM hops on Low/Medium
//! (context‖explanation → response) and 3 on High (+ technical), down from 4.
//!
//! Error model: run_agent_timed() wraps every agent — one crash never kills the pipeline.
//! Fallback:    Complexity::Medium is the ChunkState default — if context_manager
//!              fails or omits the field, the medium path (explanation + risk) runs.
//!
//! ## The brief
//!
//! Each agent's frozen prefix is resolved here, per agent, as it is dispatched —
//! `seed_for(agent)` looks up `(session, agent.name())` in the `BriefStore` and
//! hands the agent a state carrying its own brief. Agents never reach into the
//! store: they receive a finished `CompiledBrief` and know nothing about where it
//! came from, which is what keeps them testable without SQLite, an embedding
//! gateway or project state.
//!
//! A missing brief is not an error. The agent falls back to its bare role
//! contract, which is exactly the behaviour before the brain existed — so a
//! brief that failed to compile degrades the grounding and nothing else.

use crate::agents::agents::chit_chat_gate;
use crate::agents::brief::store::BriefStore;
use crate::agents::domain::chunk_state::{ChunkState, Complexity};
use crate::agents::domain::pipeline_trace::{AgentSpan, PipelineTrace};
use crate::agents::orchestrator::routing;
use crate::agents::ports::agent_port::Agent;
use crate::domain::session::SessionSnapshot;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Instant;

/// Output of the detached (slow-lane) agents. Only `decisions`, `action_items`
/// and `risks` are meaningful here — the other fields are carried over from the
/// base state and were already emitted by the fast lane.
pub struct DetachedOutcome {
    pub state: ChunkState,
    pub spans: Vec<AgentSpan>,
}

/// Work the caller should drive to completion on its own task, off the reply path.
pub type DetachedWork = Pin<Box<dyn Future<Output = DetachedOutcome> + Send + 'static>>;

/// Runs one agent, timing it and swallowing errors so a single failure can never
/// abort the pipeline. Free function (not `&self`) so detached work can own its agents.
async fn run_agent_timed(agent: Arc<dyn Agent>, state: ChunkState) -> (ChunkState, u64, String) {
    let start = Instant::now();
    match agent.run(&state).await {
        Ok(next) => (next, start.elapsed().as_millis() as u64, "OK".to_string()),
        Err(e) => {
            tracing::error!("[chunk_graph] {} failed: {}", agent.name(), e);
            (state, start.elapsed().as_millis() as u64, "ERR".to_string())
        }
    }
}

pub struct ChunkGraph {
    // Stage 1 — concurrent pair
    context_manager: Arc<dyn Agent>,
    explanation: Arc<dyn Agent>,
    // Stage 2 — conditional (selected by routing::decide)
    technical: Arc<dyn Agent>,
    risk: Arc<dyn Agent>,
    analyst: Arc<dyn Agent>,
    // Stage 3 — always sequential
    response_agent: Arc<dyn Agent>,
    /// The compiled prefixes for whatever captures are live. Shared with the
    /// brief use case, which fills it at `start_capture`.
    briefs: Arc<BriefStore>,
}

impl ChunkGraph {
    pub fn new(
        context_manager: Arc<dyn Agent>,
        explanation: Arc<dyn Agent>,
        technical: Arc<dyn Agent>,
        risk: Arc<dyn Agent>,
        analyst: Arc<dyn Agent>,
        response_agent: Arc<dyn Agent>,
        briefs: Arc<BriefStore>,
    ) -> Self {
        Self {
            context_manager,
            explanation,
            technical,
            risk,
            analyst,
            response_agent,
            briefs,
        }
    }

    /// Every agent this graph dispatches, for the dev-build contract check.
    fn all_agents(&self) -> [&Arc<dyn Agent>; 6] {
        [
            &self.context_manager,
            &self.explanation,
            &self.technical,
            &self.risk,
            &self.analyst,
            &self.response_agent,
        ]
    }

    /// Fires in dev when an agent is dispatched here but has no entry in
    /// `role_contracts::ALL`. Without it, forgetting the entry means that agent
    /// silently runs un-grounded forever — no error, no log, just worse answers.
    pub fn assert_every_agent_has_a_contract(&self) {
        for agent in self.all_agents() {
            debug_assert!(
                crate::agents::agents::role_contracts::ALL
                    .iter()
                    .any(|(tag, _)| *tag == agent.name()),
                "agent '{}' is dispatched by ChunkGraph but has no entry in role_contracts::ALL — it will never receive a brief",
                agent.name()
            );
        }
    }

    /// A copy of `base` carrying `agent`'s own frozen prefix.
    ///
    /// One lookup per dispatch rather than one per chunk: each agent's prefix
    /// differs (its role contract is the first section), so they cannot share.
    fn seed_for(&self, agent: &Arc<dyn Agent>, base: &ChunkState) -> ChunkState {
        let mut state = base.clone();
        state.brief = base
            .session_id
            .and_then(|session| self.briefs.get(session, agent.name()));
        state
    }

    /// Returns the reply-path state, its trace, and any detached slow-lane work.
    /// The caller MUST drive `DetachedWork` to completion (on a separate task) or
    /// the risk/decision/action-item signals for this chunk are silently dropped.
    pub async fn run(
        &self,
        chunk: &str,
        speaker: &str,
        session: &SessionSnapshot,
    ) -> (ChunkState, PipelineTrace, Option<DetachedWork>) {
        let overall_start = Instant::now();
        // The session fields are seeded once, here. Agents read them and never
        // write them; `merge_from` deliberately leaves them alone.
        let mut state = ChunkState {
            chunk_text: chunk.to_string(),
            speaker: speaker.to_string(),
            session_id: Some(session.id),
            meeting_id: session.meeting_id,
            project_id: session.project.as_ref().map(|p| p.id),
            rolling_window: session.rolling_window.clone(),
            ..Default::default()
        };

        // Stage 0: Local chit-chat gate — zero LLM cost
        if chit_chat_gate::is_filler(&state.chunk_text) {
            state.is_chit_chat = true;
            let mut trace = PipelineTrace::new(chunk, speaker, &state.complexity);
            trace.add_span("chit_chat_gate", 0, 0, "PASS");
            trace.total_ms = overall_start.elapsed().as_millis() as u64;
            trace.log_summary();
            return (state, trace, None);
        }

        // ── Stage 1: context_manager ‖ explanation ────────────────────────────
        // Both read only the base state, so they are independent. explanation is
        // unconditional (every branch of routing::decide sets run_explanation),
        // which is what makes starting it here safe rather than speculative.
        let (ctx_res, expl_res) = futures::future::join(
            run_agent_timed(
                self.context_manager.clone(),
                self.seed_for(&self.context_manager, &state),
            ),
            run_agent_timed(
                self.explanation.clone(),
                self.seed_for(&self.explanation, &state),
            ),
        )
        .await;

        let (ctx_state, ctx_ms, ctx_status) = ctx_res;
        let (expl_state, expl_ms, expl_status) = expl_res;

        // Take fields explicitly rather than via merge_from(): merge_from EXTENDS the
        // vector fields, and both halves carry a copy of the same base state, so
        // merging them would double up anything already present. It also does not
        // carry `complexity` at all (Complexity has no "unset" variant to guard on),
        // which is exactly the field stage 1 exists to produce.
        state.current_topic = ctx_state.current_topic;
        state.conversation_summary = ctx_state.conversation_summary;
        state.new_technical_terms = ctx_state.new_technical_terms;
        state.complexity = ctx_state.complexity;
        state.explanation = expl_state.explanation;

        let mut trace = PipelineTrace::new(chunk, speaker, &state.complexity);
        trace.add_span("context_manager", 1, ctx_ms, &ctx_status);
        trace.add_span("explanation", 1, expl_ms, &expl_status);

        // ── Stage 2: split conditional agents by whether the reply needs them ──
        let route = routing::decide(&state);

        // Enforces the invariant the eager start above depends on: explanation must be
        // unconditional. If a route ever stops requesting it, this fires in dev rather
        // than silently burning a call per chunk.
        debug_assert!(
            route.run_explanation,
            "explanation is started eagerly in stage 1; routing must not skip it"
        );

        let mut skipped: Vec<String> = Vec::new();

        // Detached: response_agent reads neither of these, so they must not block it.
        // Each is seeded with its own brief here, on the calling task, because
        // `self` does not outlive the detached future.
        let mut detached_agents: Vec<(Arc<dyn Agent>, &'static str, ChunkState)> = Vec::new();
        if route.run_risk {
            detached_agents.push((self.risk.clone(), "risk", self.seed_for(&self.risk, &state)));
        } else {
            skipped.push("risk".to_string());
        }
        if route.run_analyst {
            detached_agents.push((
                self.analyst.clone(),
                "analyst",
                self.seed_for(&self.analyst, &state),
            ));
        } else {
            skipped.push("analyst".to_string());
        }

        let detached: Option<DetachedWork> = if detached_agents.is_empty() {
            None
        } else {
            Some(Box::pin(async move {
                let futs = detached_agents
                    .into_iter()
                    .map(|(agent, name, seeded)| async move {
                        let (st, ms, status) = run_agent_timed(agent, seeded).await;
                        (st, name, ms, status)
                    });
                let results = futures::future::join_all(futs).await;

                let mut out = ChunkState::default();
                let mut spans = Vec::new();
                for (partial, name, ms, status) in results {
                    // Safe to merge here: `base` carries empty decision/action/risk
                    // vectors, so each partial contributes only its own new items.
                    out.merge_from(partial);
                    spans.push(AgentSpan {
                        name: name.to_string(),
                        stage: 2,
                        latency_ms: ms,
                        status,
                    });
                }
                DetachedOutcome { state: out, spans }
            }))
        };

        // Awaited: response_agent reads `technical_explanation`, so this one stays
        // on the critical path — but only on the High route that actually asks for it.
        if route.run_technical {
            let (tech_state, tech_ms, tech_status) = run_agent_timed(
                self.technical.clone(),
                self.seed_for(&self.technical, &state),
            )
            .await;
            state.technical_explanation = tech_state.technical_explanation;
            trace.add_span("technical", 2, tech_ms, &tech_status);
        } else {
            skipped.push("technical".to_string());
        }

        state.skipped_agents.extend(skipped);

        // ── Stage 3: the reply ────────────────────────────────────────────────
        // Skipped for Low: a simple fact or short statement doesn't need a
        // synthesised conversational reply, and this is the priciest call.
        if state.complexity != Complexity::Low {
            let (resp_state, resp_ms, resp_status) = run_agent_timed(
                self.response_agent.clone(),
                self.seed_for(&self.response_agent, &state),
            )
            .await;
            state.suggested_response = resp_state.suggested_response;
            state.suggested_response_type = resp_state.suggested_response_type;
            state.context_items = resp_state.context_items;
            trace.add_span("response_agent", 3, resp_ms, &resp_status);
        } else {
            trace.add_span("response_agent", 3, 0, "SKIPPED_LOW_COMPLEXITY");
        }

        trace.total_ms = overall_start.elapsed().as_millis() as u64;
        trace.log_summary();

        (state, trace, detached)
    }
}
