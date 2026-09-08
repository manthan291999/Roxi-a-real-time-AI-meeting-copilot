//! The one place an agent prompt is assembled. Pure.
//!
//! Every agent calls `compose`; nobody hand-assembles a prompt. That is the
//! invariant that keeps the frozen prefix stable a year from now when someone
//! adds a ninth agent and reaches for `format!`.
//!
//! ## Why the split is system / user rather than one string
//!
//! The brain doc's contract is a single string: frozen block, then
//! `--- LIVE SESSION ---`, then the volatile suffix. This module honours the
//! *ordering* requirement but returns the two halves separately, because the
//! provider caches on a prefix of the serialized message array. Putting the
//! frozen block in the system message and the volatile turn in the user message
//! means the cached region is exactly the frozen block — and, more importantly,
//! volatile content cannot reach above the closing sentinel even by mistake,
//! because it is a different string. `as_single_string()` reproduces the doc's
//! single-string layout for the tests that assert that ordering.
//!
//! When there is no brief, the system message is the agent's bare role
//! contract: today's behaviour exactly. That degradation path is also the
//! feature flag and the A/B mechanism.

use super::model::CompiledBrief;

/// Separator opening the volatile half. Asserted on by the compiler's tests.
pub const LIVE_SESSION_MARKER: &str = "--- LIVE SESSION ---";

/// A prompt split into its cacheable and its per-chunk halves.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComposedPrompt {
    /// Frozen for the life of the capture. Byte-identical on every call.
    pub system: String,
    /// Free to change every chunk.
    pub user: String,
}

impl ComposedPrompt {
    /// The two halves in the single-string layout the prompt contract is
    /// written in: frozen block, then `--- LIVE SESSION ---`, then the turn.
    ///
    /// Test-only. The invariant it exists to assert — that nothing volatile
    /// appears above the closing sentinel — is structural in the split form, so
    /// production never needs to rejoin them.
    #[cfg(test)]
    pub fn as_single_string(&self) -> String {
        format!("{}\n\n{}", self.system, self.user)
    }
}

/// Compose one agent's prompt.
///
/// `role_contract` is used only when `brief` is absent — a compiled brief
/// already carries the contract as the first section of its frozen block, and
/// duplicating it would pay for the same tokens twice.
pub fn compose(
    role_contract: &str,
    brief: Option<&CompiledBrief>,
    rolling_window: &str,
    chunk: &str,
) -> ComposedPrompt {
    let system = match brief {
        Some(b) => b.prefix().to_string(),
        None => role_contract.trim().to_string(),
    };

    let mut user = String::with_capacity(rolling_window.len() + chunk.len() + 96);
    user.push_str(LIVE_SESSION_MARKER);
    if !rolling_window.trim().is_empty() {
        user.push_str("\nRecent transcript:\n");
        user.push_str(rolling_window.trim());
    }
    user.push_str("\n\nCurrent turn:\n");
    user.push_str(chunk.trim());

    ComposedPrompt { system, user }
}

/// Append an agent-specific volatile addendum below the current turn.
///
/// This is where anything that can change mid-meeting goes: a late joiner, a
/// term learned live, an upstream agent's output the caller needs to pass down.
/// It exists so agents that need extra context add it *below* the frozen block
/// instead of reaching for their own `format!` and mutating the prefix.
pub fn with_addendum(mut prompt: ComposedPrompt, label: &str, value: &str) -> ComposedPrompt {
    let value = value.trim();
    if value.is_empty() {
        return prompt;
    }
    prompt.user.push_str("\n\n");
    prompt.user.push_str(label);
    prompt.user.push_str(":\n");
    prompt.user.push_str(value);
    prompt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_rolling_window_omits_the_transcript_heading() {
        let prompt = compose("ROLE", None, "   ", "hello");
        assert!(!prompt.user.contains("Recent transcript"));
        assert!(prompt.user.contains("Current turn:\nhello"));
    }

    #[test]
    fn addenda_land_below_the_current_turn() {
        let prompt = compose("ROLE", None, "window", "turn");
        let with = with_addendum(prompt, "Explanation Context", "because X");
        let turn = with.user.find("Current turn").unwrap();
        assert!(with.user.find("Explanation Context").unwrap() > turn);
    }

    #[test]
    fn an_empty_addendum_adds_nothing() {
        let prompt = compose("ROLE", None, "window", "turn");
        assert_eq!(with_addendum(prompt.clone(), "Label", "  "), prompt);
    }
}
