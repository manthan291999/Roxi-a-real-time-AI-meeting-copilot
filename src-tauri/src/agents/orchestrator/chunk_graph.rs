//! ChunkGraph — Hybrid Agent Orchestrator (production)
//!
//! Execution model:
//!   Stage 0 (local):     chit_chat_gate — zero LLM, fast exit for filler
//!   Stage 1 (sequential): context_manager → complexity_analyzer
//!   Stage 2 (conditional parallel): routing::decide() selects active agents
//!   Stage 3 (sequential): response_agent synthesises all stage-2 outputs
//!
//! Error model: run_safe() wraps every agent — one crash never kills the pipeline.
//! Fallback:    Complexity::Medium is the ChunkState default — if complexity_analyzer
//!              fails, the medium path (explanation + risk) runs automatically.

use crate::agents::agents::chit_chat_gate;
use crate::agents::domain::chunk_state::ChunkState;
use crate::agents::domain::pipeline_trace::PipelineTrace;
use crate::agents::orchestrator::routing;
use crate::agents::ports::agent_port::Agent;
use std::sync::Arc;
use std::time::Instant;

pub struct ChunkGraph {
    // Stage 1 — always sequential
    context_manager:     Arc<dyn Agent>,
    complexity_analyzer: Arc<dyn Agent>,
    // Stage 2 — conditional parallel (selected by routing::decide)
    explanation:         Arc<dyn Agent>,
    technical:           Arc<dyn Agent>,
    risk:                Arc<dyn Agent>,
    analyst:             Arc<dyn Agent>,
    // Stage 3 — always sequential
    response_agent:      Arc<dyn Agent>,
}

impl ChunkGraph {
    pub fn new(
        context_manager:     Arc<dyn Agent>,
        complexity_analyzer: Arc<dyn Agent>,
        explanation:         Arc<dyn Agent>,
        technical:           Arc<dyn Agent>,
        risk:                Arc<dyn Agent>,
        analyst:             Arc<dyn Agent>,
        response_agent:      Arc<dyn Agent>,
    ) -> Self {
        Self { context_manager, complexity_analyzer, explanation, technical, risk, analyst, response_agent }
    }

    pub async fn run(&self, chunk: &str, speaker: &str) -> (ChunkState, PipelineTrace) {
        let overall_start = Instant::now();
        let mut state = ChunkState {
            chunk_text: chunk.to_string(),
            speaker: speaker.to_string(),
            ..Default::default()
        };

        // Stage 0: Local chit-chat gate — zero LLM cost
        if chit_chat_gate::is_filler(&state.chunk_text) {
            state.is_chit_chat = true;
            let mut trace = PipelineTrace::new(chunk, speaker, &state.complexity);
            trace.add_span("chit_chat_gate", 0, 0, "PASS");
            trace.total_ms = overall_start.elapsed().as_millis() as u64;
            trace.log_summary();
            return (state, trace);
        }

        // We defer trace creation because complexity is unknown, but we'll collect spans first
        let mut initial_spans = Vec::new();

        // Stage 1: Sequential — build context, then classify
        let (new_state, duration, status) = self.run_safe_timed(&self.context_manager, state).await;
        state = new_state;
        initial_spans.push(("context_manager", 1, duration, status));

        let (new_state, duration, status) = self.run_safe_timed(&self.complexity_analyzer, state).await;
        state = new_state;
        initial_spans.push(("complexity", 1, duration, status));

        // Now we know complexity, create trace
        let mut trace = PipelineTrace::new(chunk, speaker, &state.complexity);
        for (name, stage, dur, stat) in initial_spans {
            trace.add_span(name, stage, dur, &stat);
        }

        // Stage 2: Conditional parallel fan-out
        let route = routing::decide(&state);

        let mut stage2_futures: Vec<std::pin::Pin<Box<dyn std::future::Future<Output = (ChunkState, &'static str, u64, String)> + Send + '_>>> = Vec::new();
        let mut skipped = Vec::new();

        macro_rules! maybe_run {
            ($flag:expr, $agent:expr, $name:expr) => {
                if $flag {
                    stage2_futures.push(Box::pin(async {
                        let (res_state, dur, stat) = self.run_safe_timed(&$agent, ChunkState::default()).await;
                        (res_state, $name, dur, stat)
                    }));
                } else {
                    skipped.push($name.to_string());
                }
            };
        }

        maybe_run!(route.run_explanation, self.explanation, "explanation");
        maybe_run!(route.run_technical,   self.technical,   "technical");
        maybe_run!(route.run_risk,        self.risk,        "risk");
        maybe_run!(route.run_analyst,     self.analyst,     "analyst");

        // Agents that DO run remain parallel via join_all — no latency regression
        let results = futures::future::join_all(stage2_futures).await;
        for (partial, name, dur, stat) in results {
            state.merge_from(partial);
            trace.add_span(name, 2, dur, &stat);
        }
        state.skipped_agents.extend(skipped);

        // Stage 3: Sequential — synthesise all stage-2 outputs
        let (new_state, duration, status) = self.run_safe_timed(&self.response_agent, state).await;
        state = new_state;
        trace.add_span("response_agent", 3, duration, &status);

        trace.total_ms = overall_start.elapsed().as_millis() as u64;
        trace.log_summary();

        (state, trace)
    }

    /// Wraps every agent call: on error, logs and returns state unchanged, along with duration.
    async fn run_safe_timed(&self, agent: &Arc<dyn Agent>, state: ChunkState) -> (ChunkState, u64, String) {
        let start = Instant::now();
        match agent.run(&state).await {
            Ok(new_state) => (new_state, start.elapsed().as_millis() as u64, "OK".to_string()),
            Err(e) => {
                tracing::error!("[chunk_graph] {} failed: {:?}", agent.name(), e);
                (state, start.elapsed().as_millis() as u64, "ERR".to_string())
            }
        }
    }
}
