use crate::agents::agents::prompt;
use crate::agents::domain::chunk_state::ChunkState;
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

/// See `explanation::ROLE_CONTRACT` for why this is public and `const`.
pub const ROLE_CONTRACT: &str = "You are a Technical Agent. Extract purely technical architectural decisions, constraints, or engineering notes from the meeting chunk.
Ground your notes in the project's reference material where it is relevant.
Return JSON: { \"technical_explanation\": \"notes\" }
If there are no technical notes, omit the \"technical_explanation\" key entirely.
CRITICAL: Output ONLY raw JSON. No markdown, no ```json fences, no explanation text.";

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
        let built =
            prompt::build(ROLE_CONTRACT, self.name(), state).with("Speaker", &state.speaker);

        let json = self
            .llm
            .complete_json(&built.prompt.system, &built.prompt.user, &built.meta)
            .await?;

        let mut next = state.clone();
        if let Some(e) = json.get("technical_explanation").and_then(|v| v.as_str()) {
            // See explanation.rs: the literal string "null" must not become a card.
            let e = e.trim();
            if !e.is_empty() && !e.eq_ignore_ascii_case("null") && !e.eq_ignore_ascii_case("none") {
                next.technical_explanation = Some(e.to_string());
            }
        }
        Ok(next)
    }
}
