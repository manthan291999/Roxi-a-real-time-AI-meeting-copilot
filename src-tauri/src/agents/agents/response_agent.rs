use crate::agents::agents::prompt;
use crate::agents::domain::chunk_state::ChunkState;
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

/// See `explanation::ROLE_CONTRACT` for why this is public and `const`.
pub const ROLE_CONTRACT: &str = r#"You are the Response Agent. You MUST respond with ONLY a JSON object matching this exact schema — no prose, no markdown fences, no extra keys. Missing any required field is a failure. Suggest a conversational reply, clarifying question, or formalize a decision based on the chunk and extracted context.
Speak as the user, in the role the brief states, and stay consistent with the project's prior decisions.
Cite the brief's reference material or prior meetings when a claim rests on them.
Schema:
{
  "suggested_response": "...",
  "suggested_bullets": [
    { "text": "...", "is_best": true },
    { "text": "...", "is_best": false }
  ],
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
suggested_bullets: 2–3 short bullets (one sentence each).
Exactly one must have "is_best": true.

HOW TO PICK is_best — this is the critical rule:
Mark the bullet that most directly serves what the user needs to say
RIGHT NOW given: (a) their stated role from the brief, (b) what the
speaker just said in this exact moment, and (c) the project's prior
decisions and context. Do NOT pick the bullet that sounds generically
best — pick the one that fits THIS user, in THIS role, in THIS moment.
Example: if the user is a Technical Lead and the speaker raised a
deployment risk, mark the technical mitigation bullet as is_best,
not the polite acknowledgement bullet, even if the acknowledgement
reads more naturally.
Each bullet must stand alone without the others.

For each source fact you used, rate how closely it matches the speaker's exact wording from 0.0 to 1.0 (match_confidence). Do not include an "is_verbatim" field — it is derived automatically from match_confidence.
CRITICAL: Output ONLY raw JSON. No markdown, no ```json fences, no explanation text."#;

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
        // Upstream agents' output is per-chunk, so it goes below the frozen
        // prefix as an addendum rather than into it.
        let built = prompt::build(ROLE_CONTRACT, self.name(), state)
            .with("Speaker", &state.speaker)
            .with_optional("Explanation context", state.explanation.as_ref())
            .with_optional("Technical context", state.technical_explanation.as_ref());

        let json = self
            .llm
            .complete_json(&built.prompt.system, &built.prompt.user, &built.meta)
            .await?;

        let mut next = state.clone();

        if let Some(resp) = json.get("suggested_response").and_then(|v| v.as_str()) {
            next.suggested_response = Some(resp.to_string());
        }
        if let Some(t) = json.get("type").and_then(|v| v.as_str()) {
            next.suggested_response_type = Some(t.to_string());
        }
        if let Some(items) = json.get("context_items").and_then(|v| v.as_array()) {
            match serde_json::from_value::<Vec<crate::agents::domain::context_item::ContextItem>>(
                serde_json::Value::Array(items.clone()),
            ) {
                Ok(mut parsed_items) => {
                    for item in &mut parsed_items {
                        item.is_verbatim = item.match_confidence
                            > crate::agents::domain::context_item::VERBATIM_CONFIDENCE_THRESHOLD;
                    }
                    next.context_items = parsed_items;
                }
                Err(e) => {
                    tracing::error!("[response_agent] Failed to parse context_items: {}", e);
                }
            }
        }

        if let Some(bullets_val) = json.get("suggested_bullets").and_then(|v| v.as_array()) {
            match serde_json::from_value::<Vec<crate::agents::domain::chunk_state::ResponseBullet>>(
                serde_json::Value::Array(bullets_val.clone()),
            ) {
                Ok(parsed) if !parsed.is_empty() => {
                    next.suggested_bullets = Some(parsed);
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!("[response_agent] suggested_bullets parse failed: {}", e);
                }
            }
        }

        Ok(next)
    }
}
