//! Builds the control commands that ask the gateway to persist ChunkGraph output.
//!
//! Why the host does not write the database itself: the gateway is the sole
//! writer of `meeting_history.db` (this process and the chatbot both read it,
//! the latter read-only, to avoid WAL write contention), and only the gateway
//! knows the current meeting id.
//!
//! The pipeline has two lanes, so a chunk's artifacts arrive in two waves: the
//! reply path finishes first, and the detached risk/analyst lane lands later or
//! is shed under load. Each chunk therefore gets a `chunkRef` the host mints, so
//! the later wave can be attached to the row the first wave created.

use crate::agents::domain::chunk_state::{ChunkState, Complexity};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

static CHUNK_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Mint a reference that identifies this chunk across both lanes.
pub fn next_chunk_ref() -> String {
    format!("c{}", CHUNK_COUNTER.fetch_add(1, Ordering::Relaxed))
}

fn significance(complexity: &Complexity) -> &'static str {
    match complexity {
        Complexity::Low => "low",
        Complexity::Medium => "medium",
        Complexity::High => "high",
    }
}

fn artifacts(state: &ChunkState) -> Value {
    json!({
        "decisions": state.decisions.iter().map(|d| json!({
            "text": d.text,
            "confidence": d.confidence,
        })).collect::<Vec<_>>(),
        "actionItems": state.action_items.iter().map(|a| json!({
            "text": a.text,
            "assignee": a.assignee,
            "deadline": a.deadline,
        })).collect::<Vec<_>>(),
        "risks": state.risks.iter().map(|r| json!({
            "text": r.text,
            "category": r.category,
            "severity": r.severity,
        })).collect::<Vec<_>>(),
    })
}

/// First wave: create the chunk row and store whatever the reply path produced.
pub fn persist_chunk_command(
    chunk_ref: &str,
    text: &str,
    speaker: &str,
    state: &ChunkState,
) -> Value {
    json!({
        "command": "persistChunk",
        "chunkRef": chunk_ref,
        "chunk": {
            "text": text,
            "speaker": speaker,
            "significance": significance(&state.complexity),
            "topic": state.current_topic,
        },
        "artifacts": artifacts(state),
        "technicalAnalysis": state.technical_explanation,
        "suggestedReply": state.suggested_response,
        "glossary": state.new_technical_terms,
    })
}

/// Second wave: attach the detached lane's artifacts to the existing chunk.
pub fn persist_artifacts_command(chunk_ref: &str, state: &ChunkState) -> Value {
    json!({
        "command": "persistArtifacts",
        "chunkRef": chunk_ref,
        "artifacts": artifacts(state),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::domain::decision::Decision;

    #[test]
    fn chunk_refs_are_unique() {
        let a = next_chunk_ref();
        let b = next_chunk_ref();
        assert_ne!(a, b);
    }

    #[test]
    fn persist_chunk_carries_text_speaker_and_significance() {
        let mut state = ChunkState::default();
        state.complexity = Complexity::High;
        state.current_topic = Some("release".to_string());
        state.decisions = vec![Decision {
            text: "ship friday".into(),
            confidence: 0.9,
        }];

        let cmd = persist_chunk_command("c0", "we ship friday", "Alice", &state);

        assert_eq!(cmd["command"], "persistChunk");
        assert_eq!(cmd["chunkRef"], "c0");
        assert_eq!(cmd["chunk"]["text"], "we ship friday");
        assert_eq!(cmd["chunk"]["speaker"], "Alice");
        assert_eq!(cmd["chunk"]["significance"], "high");
        assert_eq!(cmd["chunk"]["topic"], "release");
        assert_eq!(cmd["artifacts"]["decisions"][0]["text"], "ship friday");
    }

    #[test]
    fn significance_maps_every_complexity() {
        assert_eq!(significance(&Complexity::Low), "low");
        assert_eq!(significance(&Complexity::Medium), "medium");
        assert_eq!(significance(&Complexity::High), "high");
    }

    #[test]
    fn persist_artifacts_references_the_same_chunk() {
        let state = ChunkState::default();
        let cmd = persist_artifacts_command("c7", &state);
        assert_eq!(cmd["command"], "persistArtifacts");
        assert_eq!(cmd["chunkRef"], "c7");
        assert!(cmd["artifacts"]["risks"].as_array().unwrap().is_empty());
    }
}
