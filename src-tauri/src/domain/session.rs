//! Capture-session identity and the rolling transcript window.
//!
//! A capture has an identity from the moment the user presses Start — before
//! the gateway sidecar exists and therefore before `meetings.id` exists. The
//! brief store keys on this, which is what lets the briefs be compiled and warm
//! before the first transcript comes back.

use crate::domain::project::ProjectRef;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};

/// Process-local capture identity. Not persisted and not a database key —
/// `meetings.id` remains the durable identity of a meeting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionId(u64);

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

impl SessionId {
    pub fn mint() -> Self {
        Self(NEXT_SESSION.fetch_add(1, Ordering::Relaxed))
    }

    pub fn value(self) -> u64 {
        self.0
    }
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// A point-in-time read of the live capture, taken once per chunk.
///
/// A snapshot rather than a shared handle so the pipeline cannot observe the
/// window changing underneath it: a chunk is analysed against the transcript as
/// it stood when that chunk arrived, not as it stands when the last agent
/// happens to finish.
#[derive(Clone, Debug)]
pub struct SessionSnapshot {
    pub id: SessionId,
    /// `None` only if project resolution failed, which files the meeting under
    /// `Unsorted` rather than blocking capture.
    pub project: Option<ProjectRef>,
    /// `meetings.id`, once the gateway has reported it. Absent for the first
    /// chunk or two of a session.
    pub meeting_id: Option<i64>,
    pub rolling_window: String,
}

/// How many final turns the volatile suffix carries.
///
/// Small on purpose. This text is re-sent on every call of every chunk and is
/// never cached, so it is the part of the prompt that actually costs per-chunk
/// money. The brief carries the durable context; this only needs to carry
/// enough for a pronoun to resolve.
pub const DEFAULT_WINDOW_TURNS: usize = 8;

/// Per-turn cap. One pathological STT turn must not be able to push the
/// volatile half past the frozen half in size.
const MAX_TURN_CHARS: usize = 600;

/// The last N final turns, oldest first. Bounded by construction — an unbounded
/// window grows the per-chunk prompt for the length of the meeting.
#[derive(Debug, Clone)]
pub struct TranscriptWindow {
    turns: VecDeque<String>,
    capacity: usize,
}

impl Default for TranscriptWindow {
    fn default() -> Self {
        Self::with_capacity(DEFAULT_WINDOW_TURNS)
    }
}

impl TranscriptWindow {
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            turns: VecDeque::with_capacity(capacity.max(1)),
            capacity: capacity.max(1),
        }
    }

    /// Record a finalized turn, evicting the oldest once full.
    pub fn push(&mut self, speaker: &str, text: &str) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        let speaker = match speaker.trim() {
            "" => "Unknown",
            s => s,
        };
        if self.turns.len() == self.capacity {
            self.turns.pop_front();
        }
        self.turns
            .push_back(format!("{}: {}", speaker, truncate(text, MAX_TURN_CHARS)));
    }

    /// Render oldest-first, which is how the turns were spoken.
    pub fn render(&self) -> String {
        self.turns
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// Truncate on a char boundary. Byte-slicing mid-codepoint panics, and STT
/// output routinely contains curly quotes and em dashes.
fn truncate(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minted_ids_are_distinct() {
        assert_ne!(SessionId::mint(), SessionId::mint());
    }

    #[test]
    fn the_window_evicts_the_oldest_turn() {
        let mut w = TranscriptWindow::with_capacity(2);
        w.push("A", "one");
        w.push("B", "two");
        w.push("A", "three");
        assert_eq!(w.render(), "B: two\nA: three");
    }

    #[test]
    fn blank_turns_are_not_recorded() {
        let mut w = TranscriptWindow::default();
        w.push("A", "   ");
        assert_eq!(w.render(), "");
    }

    #[test]
    fn an_unnamed_speaker_still_renders() {
        let mut w = TranscriptWindow::default();
        w.push("  ", "hello");
        assert_eq!(w.render(), "Unknown: hello");
    }

    #[test]
    fn a_pathological_turn_is_capped_on_a_char_boundary() {
        let mut w = TranscriptWindow::default();
        w.push("A", &"🙂".repeat(500));
        assert!(w.render().len() < 800);
    }
}
