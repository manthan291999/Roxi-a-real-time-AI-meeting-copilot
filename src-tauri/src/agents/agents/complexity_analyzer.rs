//! ComplexityAnalyzerAgent — fast LLM classifier (≤ 20 completion tokens).
//! Runs after context_manager, before the parallel stage-2 swarm.
//! On any error: returns state unchanged → Complexity::Medium (default) → safe fallback.

use crate::agents::domain::chunk_state::{ChunkState, Complexity};
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

pub struct ComplexityAnalyzerAgent {
    llm: Arc<dyn LlmClient>,
}

impl ComplexityAnalyzerAgent {
    pub fn new(llm: Arc<dyn LlmClient>) -> Self {
        Self { llm }
    }
}

#[async_trait::async_trait]
impl Agent for ComplexityAnalyzerAgent {
    fn name(&self) -> &'static str {
        "complexity"
    }

    async fn run(&self, state: &ChunkState) -> anyhow::Result<ChunkState> {
        let system = "\
You are a meeting-chunk classifier. Classify the chunk complexity.
Return ONLY this JSON, no other text:
{\"complexity\":\"low\"|\"medium\"|\"high\"}

low    = filler, pleasantry, single-word ack, chit-chat, single simple fact
medium = question, explanation needed, multi-sentence discussion
high   = decision being made, technical deep-dive, multiple concepts, risk or deadline mentioned";

        let user = format!(
            "Topic: {:?}\nChunk: {}\nSpeaker: {}",
            state.current_topic, state.chunk_text, state.speaker
        );

        let json = self.llm.complete_json(system, &user).await?;

        let complexity = match json
            .get("complexity")
            .and_then(|v| v.as_str())
            .unwrap_or("medium")
        {
            "low"  => Complexity::Low,
            "high" => Complexity::High,
            _      => Complexity::Medium,
        };

        let mut next = state.clone();
        next.complexity = complexity;
        Ok(next)
    }
}
