use crate::agents::domain::chunk_state::ChunkState;
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

pub struct ExplanationAgent {
    llm: Arc<dyn LlmClient>,
}

impl ExplanationAgent {
    pub fn new(llm: Arc<dyn LlmClient>) -> Self {
        Self { llm }
    }
}

#[async_trait::async_trait]
impl Agent for ExplanationAgent {
    fn name(&self) -> &'static str {
        "explanation"
    }

    async fn run(&self, state: &ChunkState) -> anyhow::Result<ChunkState> {
        let system = "You are an Explanation Agent. Explain complex jargon or concepts in simple terms for the user based on the meeting chunk.
Return JSON: { \"explanation\": \"simple explanation\" }
If there is nothing worth explaining, omit the \"explanation\" key entirely.
CRITICAL: Output ONLY raw JSON. No markdown, no ```json fences, no explanation text.";

        let user = format!("Chunk: {}\nSpeaker: {}", state.chunk_text, state.speaker);

        let json = self.llm.complete_json(system, &user).await?;

        let mut next = state.clone();
        if let Some(e) = json.get("explanation").and_then(|v| v.as_str()) {
            // A JSON null deserialises to None, but the literal string "null"
            // used to pass straight through and render as an explanation card
            // reading "null".
            let e = e.trim();
            if !e.is_empty() && !e.eq_ignore_ascii_case("null") && !e.eq_ignore_ascii_case("none") {
                next.explanation = Some(e.to_string());
            }
        }
        Ok(next)
    }
}
