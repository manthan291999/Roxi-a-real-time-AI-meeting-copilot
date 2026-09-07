use std::sync::Arc;
use crate::agents::ports::llm_port::LlmClient;
use crate::agents::ports::agent_port::Agent;
use crate::agents::orchestrator::chunk_graph::ChunkGraph;

pub fn initialize_agent_graph() -> Arc<ChunkGraph> {
    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        tracing::error!("[FATAL] OPENAI_API_KEY is not set or is empty. LLM agents will fail with 401 Unauthorized.");
        tracing::error!("[FATAL] Set it in a .env file next to the app, or export it before launching.");
    }

    let fast_model = "gpt-4o-mini";
    let premium_model = "gpt-5.6-luna";

    let llm_context: Arc<dyn LlmClient> = Arc::new(crate::agents::adapters::openai_adapter::OpenAiAdapter::with_tag(&api_key, fast_model, "context_manager"));
    let llm_explanation: Arc<dyn LlmClient> = Arc::new(crate::agents::adapters::openai_adapter::OpenAiAdapter::with_tag(&api_key, fast_model, "explanation"));
    let llm_technical: Arc<dyn LlmClient> = Arc::new(crate::agents::adapters::openai_adapter::OpenAiAdapter::with_tag(&api_key, fast_model, "technical"));
    let llm_analyst: Arc<dyn LlmClient> = Arc::new(crate::agents::adapters::openai_adapter::OpenAiAdapter::with_tag(&api_key, fast_model, "analyst"));
    let llm_risk: Arc<dyn LlmClient> = Arc::new(crate::agents::adapters::openai_adapter::OpenAiAdapter::with_tag(&api_key, fast_model, "risk_detector"));
    let llm_response: Arc<dyn LlmClient> = Arc::new(crate::agents::adapters::openai_adapter::OpenAiAdapter::with_tag(&api_key, premium_model, "response_agent"));

    let context_mgr: Arc<dyn Agent> = Arc::new(crate::agents::agents::context_manager::ContextManagerAgent::new(llm_context));
    let explanation: Arc<dyn Agent> = Arc::new(crate::agents::agents::explanation::ExplanationAgent::new(llm_explanation));
    let technical: Arc<dyn Agent> = Arc::new(crate::agents::agents::technical::TechnicalAgent::new(llm_technical));
    let analyst: Arc<dyn Agent> = Arc::new(crate::agents::agents::analyst::AnalystAgent::new(llm_analyst));
    let risk: Arc<dyn Agent> = Arc::new(crate::agents::agents::risk_detector::RiskDetectorAgent::new(llm_risk));
    let response: Arc<dyn Agent> = Arc::new(crate::agents::agents::response_agent::ResponseAgent::new(llm_response));

    Arc::new(ChunkGraph::new(
        context_mgr,
        explanation,
        technical,
        risk,
        analyst,
        response,
    ))
}
