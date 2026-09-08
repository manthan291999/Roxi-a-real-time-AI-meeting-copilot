//! The glue every agent uses to turn a `ChunkState` into a call.
//!
//! Two lines of it, in one place, on purpose. The frozen prefix only stays
//! stable if nobody hand-assembles a prompt — and the temptation to reach for
//! `format!` inside an agent is exactly what breaks it, silently, a year from
//! now when a ninth agent is added.
//!
//! `compose` is pure and knows nothing about calls; this module is the seam
//! where the pure prompt meets the call metadata the adapter needs.

use crate::agents::brief::compose::{self, ComposedPrompt};
use crate::agents::domain::chunk_state::ChunkState;
use crate::agents::ports::llm_port::LlmCallMeta;

/// A prompt plus the metadata that identifies the call it belongs to.
pub struct AgentPrompt {
    pub prompt: ComposedPrompt,
    pub meta: LlmCallMeta,
}

impl AgentPrompt {
    /// Append a volatile addendum below the current turn.
    ///
    /// Anything that can change mid-meeting goes here — a late joiner, a term
    /// learned live, an upstream agent's output. Never above the sentinel.
    pub fn with(mut self, label: &str, value: &str) -> Self {
        self.prompt = compose::with_addendum(self.prompt, label, value);
        self
    }

    /// Append an addendum only when there is one.
    pub fn with_optional(self, label: &str, value: Option<&String>) -> Self {
        match value {
            Some(v) => self.with(label, v),
            None => self,
        }
    }
}

/// Build `tag`'s prompt for this chunk.
///
/// `role_contract` is used only when the state carries no brief: a compiled
/// brief already opens with the contract, and sending it twice pays for the
/// same tokens twice.
pub fn build(role_contract: &str, tag: &'static str, state: &ChunkState) -> AgentPrompt {
    let brief = state.brief.as_deref();

    AgentPrompt {
        prompt: compose::compose(
            role_contract,
            brief,
            &state.rolling_window,
            &state.chunk_text,
        ),
        meta: LlmCallMeta {
            session_id: state.session_id,
            meeting_id: state.meeting_id,
            agent_tag: Some(tag),
            prefix_hash: brief.map(|b| b.prefix_hash.clone()),
            brief_tokens: brief.map(|b| b.token_estimate).unwrap_or(0),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> ChunkState {
        ChunkState {
            chunk_text: "we should ship on Friday".into(),
            speaker: "Alex".into(),
            rolling_window: "Priya: what is the date".into(),
            ..Default::default()
        }
    }

    #[test]
    fn the_speaker_and_window_land_in_the_volatile_half() {
        let built = build("ROLE", "explanation", &state());
        assert!(built.prompt.user.contains("we should ship on Friday"));
        assert!(built.prompt.user.contains("what is the date"));
        assert_eq!(built.prompt.system, "ROLE");
    }

    #[test]
    fn no_brief_means_no_prefix_hash_and_zero_brief_tokens() {
        let built = build("ROLE", "explanation", &state());
        assert_eq!(built.meta.prefix_hash, None);
        assert_eq!(built.meta.brief_tokens, 0);
        assert_eq!(built.meta.agent_tag, Some("explanation"));
    }

    #[test]
    fn optional_addenda_are_skipped_when_absent() {
        let a = build("ROLE", "t", &state()).with_optional("Label", None);
        let b = build("ROLE", "t", &state());
        assert_eq!(a.prompt, b.prompt);
    }
}
