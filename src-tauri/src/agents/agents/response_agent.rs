use crate::agents::domain::chunk_state::ChunkState;
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

pub struct ResponseAgent {
    llm: Arc<dyn LlmClient>,
}

impl ResponseAgent {
    pub fn new(llm: Arc<dyn LlmClient>) -> Self {
        Self { llm }
    }
}

#[async_trait::async_trait]
impl Agent for ResponseAgent {
    fn name(&self) -> &'static str {
        "response_agent"
    }

    async fn run(&self, state: &ChunkState) -> anyhow::Result<ChunkState> {
        let system = "You are the Response Agent. Suggest a conversational reply, clarifying question, or formalize a decision based on the chunk and extracted context.
Return JSON: { \"suggested_response\": \"...\", \"type\": \"reply|question|decision\" }
CRITICAL: Output ONLY raw JSON. No markdown, no ```json fences, no explanation text.";

        let user = format!(
            "Chunk: {}\nSpeaker: {}\nExplanation Context: {:?}\nTechnical Context: {:?}",
            state.chunk_text, state.speaker, state.explanation, state.technical_explanation
        );

        let json = self.llm.complete_json(system, &user).await?;

        let mut next = state.clone();
        
        if let Some(resp) = json.get("suggested_response").and_then(|v| v.as_str()) {
            next.suggested_response = Some(resp.to_string());
        }
        if let Some(t) = json.get("type").and_then(|v| v.as_str()) {
            next.suggested_response_type = Some(t.to_string());
        }
        
        Ok(next)
    }
}
