use crate::agents::domain::chunk_state::ChunkState;
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

pub struct ContextManagerAgent {
    llm: Arc<dyn LlmClient>,
}

impl ContextManagerAgent {
    pub fn new(llm: Arc<dyn LlmClient>) -> Self {
        Self { llm }
    }
}

#[async_trait::async_trait]
impl Agent for ContextManagerAgent {
    fn name(&self) -> &'static str {
        "context_manager"
    }

    async fn run(&self, state: &ChunkState) -> anyhow::Result<ChunkState> {
        let system = "You are the Context Manager for a real-time meeting copilot. 
Update current_topic if changed. Summarize state in conversation_summary (1-2 sentences). 
Extract new terminology in new_technical_terms.
Return JSON: { \"current_topic\": \"...\", \"conversation_summary\": \"...\", \"new_technical_terms\": {\"term\": \"definition\"} }
CRITICAL: Output ONLY raw JSON. No markdown, no ```json fences, no explanation text.";

        let user = format!(
            "Topic: {:?}\nSummary: {:?}\nChunk: {}\nSpeaker: {}",
            state.current_topic, state.conversation_summary, state.chunk_text, state.speaker
        );

        let json = self.llm.complete_json(system, &user).await?;

        let mut next = state.clone();
        if let Some(t) = json.get("current_topic").and_then(|v| v.as_str()) {
            next.current_topic = Some(t.to_string());
        }
        if let Some(s) = json.get("conversation_summary").and_then(|v| v.as_str()) {
            next.conversation_summary = Some(s.to_string());
        }
        if let Some(terms) = json.get("new_technical_terms").and_then(|v| v.as_object()) {
            for (k, v) in terms {
                if let Some(v_str) = v.as_str() {
                    next.new_technical_terms.insert(k.clone(), v_str.to_string());
                }
            }
        }
        Ok(next)
    }
}
