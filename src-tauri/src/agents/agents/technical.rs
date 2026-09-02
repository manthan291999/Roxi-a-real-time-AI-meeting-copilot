use crate::agents::domain::chunk_state::ChunkState;
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

pub struct TechnicalAgent {
    llm: Arc<dyn LlmClient>,
}

impl TechnicalAgent {
    pub fn new(llm: Arc<dyn LlmClient>) -> Self {
        Self { llm }
    }
}

#[async_trait::async_trait]
impl Agent for TechnicalAgent {
    fn name(&self) -> &'static str {
        "technical"
    }

    async fn run(&self, state: &ChunkState) -> anyhow::Result<ChunkState> {
        let system = "You are a Technical Agent. Extract purely technical architectural decisions, constraints, or engineering notes from the meeting chunk.
Return JSON: { \"technical_explanation\": \"notes or null\" }
CRITICAL: Output ONLY raw JSON. No markdown, no ```json fences, no explanation text.";

        let user = format!("Chunk: {}\nSpeaker: {}", state.chunk_text, state.speaker);

        let json = self.llm.complete_json(system, &user).await?;

        let mut next = state.clone();
        if let Some(e) = json.get("technical_explanation").and_then(|v| v.as_str()) {
            next.technical_explanation = Some(e.to_string());
        }
        Ok(next)
    }
}
