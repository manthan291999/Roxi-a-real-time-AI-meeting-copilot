use crate::agents::agents::prompt;
use crate::agents::domain::{action_item::ActionItem, chunk_state::ChunkState, decision::Decision};
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

/// See `explanation::ROLE_CONTRACT` for why this is public and `const`.
pub const ROLE_CONTRACT: &str = "You are an Analyst Agent. Extract action items and decisions.
Use the participant roster to resolve an assignee to a real name where you can; leave assignee empty rather than guessing.
Do not restate an item that the brief already lists as still open — only what this turn adds or changes.
Return JSON exactly matching:
{
  \"decisions\": [ {\"text\": \"...\", \"confidence\": 0.9} ],
  \"action_items\": [ {\"text\": \"...\", \"assignee\": \"...\", \"deadline\": \"...\"} ]
}
CRITICAL: Output ONLY raw JSON. No markdown, no ```json fences, no explanation text.";

pub struct AnalystAgent {
    llm: Arc<dyn LlmClient>,
}

impl AnalystAgent {
    pub fn new(llm: Arc<dyn LlmClient>) -> Self {
        Self { llm }
    }
}

#[async_trait::async_trait]
impl Agent for AnalystAgent {
    fn name(&self) -> &'static str {
        "analyst"
    }

    async fn run(&self, state: &ChunkState) -> anyhow::Result<ChunkState> {
        let built =
            prompt::build(ROLE_CONTRACT, self.name(), state).with("Speaker", &state.speaker);

        let json = self
            .llm
            .complete_json(&built.prompt.system, &built.prompt.user, &built.meta)
            .await?;

        let mut next = state.clone();

        if let Some(decisions) = json.get("decisions").and_then(|v| v.as_array()) {
            for d in decisions {
                if let Ok(decision) = serde_json::from_value::<Decision>(d.clone()) {
                    next.decisions.push(decision);
                }
            }
        }

        if let Some(items) = json.get("action_items").and_then(|v| v.as_array()) {
            for i in items {
                if let Ok(item) = serde_json::from_value::<ActionItem>(i.clone()) {
                    next.action_items.push(item);
                }
            }
        }

        Ok(next)
    }
}
