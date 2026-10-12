//! ComplexityAnalyzerAgent — fast LLM classifier (≤ 20 completion tokens).
//!
//! SUPERSEDED AND UNWIRED. Complexity classification now happens inside
//! ContextManagerAgent as one extra JSON field, because this agent cost a full
//! ~900ms sequential round-trip to emit ~5 tokens. Nothing constructs it.
//!
//! Kept because it is still a correct, self-contained implementation: if you ever
//! need complexity on a different model or a different cadence from the context
//! manager, re-wire this in lib.rs and split the two calls again.
//!
//! On any error: returns state unchanged → Complexity::Medium (default) → safe fallback.

#![allow(dead_code)]

use crate::agents::agents::prompt;
use crate::agents::domain::chunk_state::{ChunkState, Complexity};
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

/// Not registered in `role_contracts::ALL`: nothing constructs this agent, so
/// compiling a brief for it would pay for a prefix nobody sends. Re-wiring the
/// agent means adding it there too.
pub const ROLE_CONTRACT: &str = "\
You are a meeting-chunk classifier. Classify the chunk complexity.
Return ONLY this JSON, no other text:
{\"complexity\":\"low\"|\"medium\"|\"high\"}

low    = filler, pleasantry, single-word ack, chit-chat, single simple fact
medium = question, explanation needed, multi-sentence discussion
high   = decision being made, technical deep-dive, multiple concepts, risk or deadline mentioned";

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
        let built = prompt::build(ROLE_CONTRACT, self.name(), state)
            .with("Speaker", &state.speaker)
            .with_optional("Current topic", state.current_topic.as_ref());

        let json = self
            .llm
            .complete_json(&built.prompt.system, &built.prompt.user, &built.meta)
            .await?;

        let complexity = match json
            .get("complexity")
            .and_then(|v| v.as_str())
            .unwrap_or("medium")
        {
            "low" => Complexity::Low,
            "high" => Complexity::High,
            _ => Complexity::Medium,
        };

        let mut next = state.clone();
        next.complexity = complexity;
        Ok(next)
    }
}
