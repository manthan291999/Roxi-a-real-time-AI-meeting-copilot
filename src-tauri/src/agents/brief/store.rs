//! Holds the compiled briefs for the life of a capture.
//!
//! Keyed by `(SessionId, agent tag)` rather than by meeting id. The meeting row
//! is created by the gateway sidecar, so its id does not exist yet at the
//! moment the briefs are compiled — and the brief's lifetime is the capture's,
//! not the row's. `SessionId` is minted by the Rust host before the sidecar is
//! spawned, which is what lets the briefs be warm before the first transcript
//! arrives. The meeting id is recorded on the session separately, once the
//! gateway reports it, for the usage rows.
//!
//! One brief *per agent*: each agent's role contract sits at the top of its own
//! frozen block, so they cannot share a prefix. They do share one round of I/O
//! — N strings compiled from one `BriefInputs`.

use super::model::SharedBrief;
use crate::domain::session::SessionId;
use std::collections::HashMap;
use std::sync::RwLock;

/// An agent's tag, as returned by `Agent::name()`. The same string used as the
/// `tag` on usage rows, so a brief and its LLM calls line up in the dashboard
/// without a second mapping to keep in sync.
pub type AgentTag = &'static str;

#[derive(Default)]
pub struct BriefStore {
    inner: RwLock<HashMap<SessionId, HashMap<AgentTag, SharedBrief>>>,
}

impl BriefStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put(&self, session: SessionId, tag: AgentTag, brief: SharedBrief) {
        // A poisoned lock means a panic happened while a brief was being
        // written. Losing the brief degrades to un-grounded prompts; taking the
        // process down would lose the meeting. Recover and carry on.
        if let Ok(mut guard) = self.inner.write() {
            guard.entry(session).or_default().insert(tag, brief);
        } else {
            tracing::error!("[brief_store] lock poisoned — brief for {tag} dropped");
        }
    }

    pub fn get(&self, session: SessionId, tag: AgentTag) -> Option<SharedBrief> {
        self.inner
            .read()
            .ok()?
            .get(&session)?
            .get(tag)
            .map(SharedBrief::clone)
    }

    /// Release a finished capture's briefs. Called from `stop_capture`.
    pub fn clear_session(&self, session: SessionId) {
        if let Ok(mut guard) = self.inner.write() {
            guard.remove(&session);
        }
    }

    /// How many agents have a brief for this session. Used by the startup
    /// assertion and by logging, not by the pipeline.
    pub fn len(&self, session: SessionId) -> usize {
        self.inner
            .read()
            .ok()
            .and_then(|g| g.get(&session).map(HashMap::len))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::super::budget::Budget;
    use super::super::compiler::compile;
    use super::super::model::BriefInputs;
    use super::*;
    use std::sync::Arc;

    fn a_brief() -> SharedBrief {
        Arc::new(compile("ROLE", &BriefInputs::default(), &Budget::default()).unwrap())
    }

    #[test]
    fn briefs_are_scoped_to_their_session_and_agent() {
        let store = BriefStore::new();
        let one = SessionId::mint();
        let two = SessionId::mint();

        store.put(one, "explanation", a_brief());

        assert!(store.get(one, "explanation").is_some());
        assert!(store.get(one, "risk_detector").is_none());
        assert!(store.get(two, "explanation").is_none());
    }

    #[test]
    fn clearing_one_session_leaves_the_other_intact() {
        let store = BriefStore::new();
        let one = SessionId::mint();
        let two = SessionId::mint();
        store.put(one, "explanation", a_brief());
        store.put(two, "explanation", a_brief());

        store.clear_session(one);

        assert_eq!(store.len(one), 0);
        assert_eq!(store.len(two), 1);
    }
}
