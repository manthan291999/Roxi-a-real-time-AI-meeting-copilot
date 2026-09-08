//! Constructs the agent pipeline. Every model-tier decision is made here and
//! nowhere else — no agent hardcodes its own model.

use crate::agents::adapters::openai_adapter::OpenAiAdapter;
use crate::agents::brief::store::BriefStore;
use crate::agents::orchestrator::chunk_graph::ChunkGraph;
use crate::agents::ports::agent_port::Agent;
use crate::agents::ports::llm_port::LlmClient;
use std::sync::Arc;

/// Latency tier. Everything that feeds the reply runs here.
const FAST_MODEL: &str = "gpt-4o-mini";
/// Quality tier, reserved for the final synthesis step.
///
/// Note on caching economics: the GPT-5.6 family bills cache *writes* at a
/// premium. With few chunks per meeting the write can cost more than the reads
/// save, so this tier is the one to measure per-model rather than assume.
const PREMIUM_MODEL: &str = "gpt-4o-mini";

/// Build the graph, sharing `briefs` with the brief use case that fills it.
///
/// The store is passed in rather than created here because two collaborators
/// need the same one: this graph reads it per chunk, and `BriefUseCase` writes
/// it at `start_capture`. Constructing it in the composition root is what keeps
/// that pairing visible in one place.
pub fn initialize_agent_graph(briefs: Arc<BriefStore>) -> Arc<ChunkGraph> {
    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        tracing::error!("[FATAL] OPENAI_API_KEY is not set or is empty. LLM agents will fail with 401 Unauthorized.");
        tracing::error!("[FATAL] Set it in a .env file next to the app, or export it before launching.");
    }

    // The tag on each adapter must equal the agent's `Agent::name()`: it is the
    // usage-row tag, the brief store key and half the prompt cache key, so a
    // mismatch splits one agent across two identities in the dashboard and
    // hands it the wrong prefix.
    let llm_context: Arc<dyn LlmClient> =
        Arc::new(OpenAiAdapter::with_tag(&api_key, FAST_MODEL, "context_manager"));
    let llm_explanation: Arc<dyn LlmClient> =
        Arc::new(OpenAiAdapter::with_tag(&api_key, FAST_MODEL, "explanation"));
    let llm_technical: Arc<dyn LlmClient> =
        Arc::new(OpenAiAdapter::with_tag(&api_key, FAST_MODEL, "technical"));
    let llm_analyst: Arc<dyn LlmClient> =
        Arc::new(OpenAiAdapter::with_tag(&api_key, FAST_MODEL, "analyst"));
    let llm_risk: Arc<dyn LlmClient> =
        Arc::new(OpenAiAdapter::with_tag(&api_key, FAST_MODEL, "risk_detector"));
    let llm_response: Arc<dyn LlmClient> =
        Arc::new(OpenAiAdapter::with_tag(&api_key, PREMIUM_MODEL, "response_agent"));

    let context_mgr: Arc<dyn Agent> = Arc::new(crate::agents::agents::context_manager::ContextManagerAgent::new(llm_context));
    let explanation: Arc<dyn Agent> = Arc::new(crate::agents::agents::explanation::ExplanationAgent::new(llm_explanation));
    let technical: Arc<dyn Agent> = Arc::new(crate::agents::agents::technical::TechnicalAgent::new(llm_technical));
    let analyst: Arc<dyn Agent> = Arc::new(crate::agents::agents::analyst::AnalystAgent::new(llm_analyst));
    let risk: Arc<dyn Agent> = Arc::new(crate::agents::agents::risk_detector::RiskDetectorAgent::new(llm_risk));
    let response: Arc<dyn Agent> = Arc::new(crate::agents::agents::response_agent::ResponseAgent::new(llm_response));

    let graph = Arc::new(ChunkGraph::new(
        context_mgr,
        explanation,
        technical,
        risk,
        analyst,
        response,
        briefs,
    ));

    // Dev-build check: an agent dispatched here with no entry in
    // `role_contracts::ALL` would run un-grounded forever with nothing
    // reporting it.
    graph.assert_every_agent_has_a_contract();

    graph
}
