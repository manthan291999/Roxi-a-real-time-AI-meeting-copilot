//! The live capture, as the rest of the app needs to see it.
//!
//! One at a time — `CaptureUseCase::start` already rejects a second concurrent
//! session, and the audio device can only be captured once. Modelled as
//! `Option<ActiveSession>` rather than a map so "two sessions running" stays
//! unrepresentable instead of merely unhandled.
//!
//! ## Why this is separate from `CaptureUseCase`
//!
//! `CaptureUseCase` owns the audio pipeline and the control channel: things that
//! start and stop. This owns the session's *identity and accumulated state*,
//! which the event router and the agent pipeline read on every chunk and which
//! neither of them should have to reach through the capture machinery to get.

use crate::domain::project::ProjectRef;
use crate::domain::session::{SessionId, SessionSnapshot, TranscriptWindow};
use std::sync::RwLock;

struct ActiveSession {
    id: SessionId,
    project: Option<ProjectRef>,
    /// Filled in when the gateway reports the row it inserted. Absent until
    /// then, which is why the brief store keys on `SessionId` instead.
    meeting_id: Option<i64>,
    display_id: Option<String>,
    window: TranscriptWindow,
}

#[derive(Default)]
pub struct SessionRegistry {
    inner: RwLock<Option<ActiveSession>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mint an identity for a capture that is about to start.
    ///
    /// Called before the gateway sidecar is spawned, so the briefs can be
    /// compiled and warm before the first transcript comes back.
    pub fn open(&self, project: Option<ProjectRef>) -> SessionId {
        let id = SessionId::mint();
        if let Ok(mut guard) = self.inner.write() {
            *guard = Some(ActiveSession {
                id,
                project,
                meeting_id: None,
                display_id: None,
                window: TranscriptWindow::default(),
            });
        } else {
            tracing::error!("[session] registry lock poisoned — this capture will be un-grounded");
        }
        id
    }

    /// End the capture, returning the id so the caller can release its briefs.
    pub fn close(&self) -> Option<SessionId> {
        let taken = self.inner.write().ok()?.take()?;
        Some(taken.id)
    }

    /// Record the meeting row the gateway inserted.
    ///
    /// Ignored when no session is live, or when the report belongs to a session
    /// that has already ended: a `MeetingStarted` racing a `stop_capture` must
    /// not resurrect state for a capture that is over.
    pub fn record_meeting(&self, meeting_id: i64, display_id: Option<String>) {
        let Ok(mut guard) = self.inner.write() else {
            return;
        };
        let Some(session) = guard.as_mut() else {
            tracing::debug!(
                meeting_id,
                "[session] meeting reported after the capture ended — ignoring"
            );
            return;
        };
        session.meeting_id = Some(meeting_id);
        session.display_id = display_id;
        tracing::info!(
            session = %session.id,
            meeting_id,
            display_id = session.display_id.as_deref().unwrap_or("-"),
            "[session] meeting row bound to capture"
        );
    }

    /// Record a finalized turn in the rolling window.
    pub fn push_turn(&self, speaker: &str, text: &str) {
        if let Ok(mut guard) = self.inner.write() {
            if let Some(session) = guard.as_mut() {
                session.window.push(speaker, text);
            }
        }
    }

    /// Read the session as the pipeline needs it for one chunk.
    ///
    /// `None` between captures — a chunk arriving then has nowhere to belong,
    /// and the caller drops it rather than analysing it against no session.
    pub fn snapshot(&self) -> Option<SessionSnapshot> {
        let guard = self.inner.read().ok()?;
        let session = guard.as_ref()?;
        Some(SessionSnapshot {
            id: session.id,
            project: session.project.clone(),
            meeting_id: session.meeting_id,
            rolling_window: session.window.render(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::project::ProjectId;

    fn a_project() -> ProjectRef {
        ProjectRef {
            id: ProjectId::new(1),
            code: "ROXI".into(),
            name: "Project Roxi".into(),
        }
    }

    #[test]
    fn there_is_no_snapshot_between_captures() {
        let registry = SessionRegistry::new();
        assert!(registry.snapshot().is_none());

        registry.open(Some(a_project()));
        assert!(registry.snapshot().is_some());

        registry.close();
        assert!(registry.snapshot().is_none());
    }

    #[test]
    fn the_snapshot_carries_the_project_and_the_window() {
        let registry = SessionRegistry::new();
        registry.open(Some(a_project()));
        registry.push_turn("Alex", "we ship Friday");

        let snapshot = registry.snapshot().unwrap();
        assert_eq!(snapshot.project.unwrap().code, "ROXI");
        assert_eq!(snapshot.rolling_window, "Alex: we ship Friday");
        assert_eq!(snapshot.meeting_id, None);
    }

    #[test]
    fn a_meeting_reported_after_the_capture_ended_is_ignored() {
        let registry = SessionRegistry::new();
        registry.open(None);
        registry.close();

        registry.record_meeting(42, Some("GEN-001".into()));

        assert!(registry.snapshot().is_none());
    }

    #[test]
    fn reopening_starts_a_new_identity_and_an_empty_window() {
        let registry = SessionRegistry::new();
        let first = registry.open(None);
        registry.push_turn("Alex", "stale");
        registry.close();

        let second = registry.open(None);
        assert_ne!(first, second);
        assert_eq!(registry.snapshot().unwrap().rolling_window, "");
    }
}
