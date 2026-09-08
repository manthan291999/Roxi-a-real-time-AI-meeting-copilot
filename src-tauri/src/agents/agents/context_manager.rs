//! ContextManagerAgent — topic tracking, summarisation AND complexity classification.
//!
//! PERF: complexity used to be a second sequential LLM call (ComplexityAnalyzerAgent)
//! that emitted ~5 completion tokens for a full ~900ms round-trip. It is folded into
//! this agent's JSON instead — same information, one hop instead of two.
//! On any parse failure the field falls back to Complexity::Medium, which is the
//! ChunkState default and the safe route (explanation + risk).

use crate::agents::agents::prompt;
use crate::agents::domain::chunk_state::{ChunkState, Complexity};
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

/// See `explanation::ROLE_CONTRACT` for why this is public and `const`.
pub const ROLE_CONTRACT: &str = "You are the Context Manager for a real-time meeting copilot.
Update current_topic if changed. Summarize state in conversation_summary (1-2 sentences).
Extract new terminology in new_technical_terms — only terms the project glossary does not already define.
Also classify the chunk's complexity:
low    = filler, pleasantry, single-word ack, chit-chat, single simple fact
medium = question, explanation needed, multi-sentence discussion
high   = decision being made, technical deep-dive, multiple concepts, risk or deadline mentioned
Return JSON: { \"current_topic\": \"...\", \"conversation_summary\": \"...\", \"new_technical_terms\": {\"term\": \"definition\"}, \"complexity\": \"low\"|\"medium\"|\"high\" }
CRITICAL: Output ONLY raw JSON. No markdown, no ```json fences, no explanation text.";

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
        // The live topic and running summary are volatile by definition, so they
        // go in as addenda below the current turn — never into the frozen
        // prefix, where they would mutate it on every chunk.
        //
        // (These used to be built with `{:?}`, which sent the model Rust debug
        // syntax — `Topic: None`, `Summary: Some("...")` — and made it read
        // through the syntax to reach its own context. An absent value now
        // contributes no line at all.)
        let built = prompt::build(ROLE_CONTRACT, self.name(), state)
            .with("Speaker", &state.speaker)
            .with_optional("Current topic", state.current_topic.as_ref())
            .with_optional("Running summary", state.conversation_summary.as_ref());

        let json = self
            .llm
            .complete_json(&built.prompt.system, &built.prompt.user, &built.meta)
            .await?;

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

        // Folded-in complexity classification. A missing or unrecognised value falls
        // through to Medium — the safe route — exactly as the old separate agent did.
        next.complexity = match json
            .get("complexity")
            .and_then(|v| v.as_str())
            .unwrap_or("medium")
        {
            "low"  => Complexity::Low,
            "high" => Complexity::High,
            _      => Complexity::Medium,
        };

        Ok(next)
    }
}
