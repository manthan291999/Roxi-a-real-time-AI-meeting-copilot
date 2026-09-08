//! What the brief use case needs from meeting storage — and nothing else.
//!
//! Deliberately separate from `ports::db::Database`, which serves the history
//! UI. Widening `Database` with five brief-shaped methods would force the
//! history adapter and every fake of it to carry methods it never calls; the
//! precedent is `EvidenceSource` sitting beside `Retriever` in the chatbot
//! rather than `Retriever` growing.
//!
//! Every method is synchronous: these are local SQLite reads, and making them
//! async would buy nothing but a runtime dependency in the port.

use crate::agents::brief::model::{GlossaryTerm, MeetingDigest, OpenItem, Participant};
use crate::domain::project::ProjectId;
use anyhow::Result;

/// Read side of the brief's episodic and semantic memory.
///
/// Implementations must return **deterministically ordered** results. The
/// compiler re-sorts the sets that have a canonical order, but `recent_digests`
/// is consumed in the order given, so its `ORDER BY` is part of the prefix
/// contract.
pub trait BriefSource: Send + Sync {
    /// Project glossary, most-recently-seen first. `limit` caps the query, not
    /// the brief — the budget does that.
    fn glossary_for_project(&self, project: ProjectId, limit: usize) -> Result<Vec<GlossaryTerm>>;

    /// Known participants across the project's meetings.
    fn roster_for_project(&self, project: ProjectId) -> Result<Vec<Participant>>;

    /// The project's last `limit` meetings, newest first.
    ///
    /// The meeting being captured cannot appear: briefs are compiled before the
    /// gateway inserts its row.
    fn recent_digests(&self, project: ProjectId, limit: usize) -> Result<Vec<MeetingDigest>>;

    /// Action items and risks from the project's prior meetings that nothing
    /// has resolved.
    fn open_items(&self, project: ProjectId, limit: usize) -> Result<Vec<OpenItem>>;
}
