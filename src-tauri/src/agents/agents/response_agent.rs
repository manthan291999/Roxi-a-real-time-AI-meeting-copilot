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
        let system = r#"You are the Response Agent. Suggest a conversational reply, clarifying question, or formalize a decision based on the chunk and extracted context.
Return JSON:
{
  "suggested_response": "...",
  "type": "reply|question|decision",
  "context_items": [
    {
      "text": "source snippet from the context",
      "match_confidence": 0.95,
      "is_technical": false,
      "tags": ["decision"]
    }
  ]
}
For each source fact you used, rate how closely it matches the speaker's exact wording from 0.0 to 1.0 (match_confidence). Do not include an "is_verbatim" field — it is derived automatically from match_confidence.
CRITICAL: Output ONLY raw JSON. No markdown, no ```json fences, no explanation text."#;

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
        if let Some(items) = json.get("context_items").and_then(|v| v.as_array()) {
            match serde_json::from_value::<Vec<crate::agents::domain::context_item::ContextItem>>(serde_json::Value::Array(items.clone())) {
                Ok(mut parsed_items) => {
                    for item in &mut parsed_items {
                        item.is_verbatim = item.match_confidence
                            > crate::agents::domain::context_item::VERBATIM_CONFIDENCE_THRESHOLD;
                    }
                    next.context_items = parsed_items;
                }
                Err(e) => {
                    tracing::error!("[response_agent] Failed to parse context_items: {:?}", e);
                }
            }
        }
        
        Ok(next)
    }
}
