//! Read side of the document store, for the brief's one-shot pre-retrieval.
//!
//! This is the part of the brain that is **not** pure CAG. A 200-page SOW is
//! ~100k tokens and does not fit a 5k budget, so the reference-material section
//! is top-K chunks chosen by an embedding query — a retrieval step, run once at
//! capture start instead of once per chunk. The design is *retrieve once, cache
//! thereafter*.
//!
//! The failure mode that follows is worth naming: if the capture-time seed query
//! selects the wrong chunks, every chunk in the meeting is grounded on the wrong
//! material, and unlike per-query RAG there is no later correction. That is why
//! this port narrows rather than replaces `DocumentEvidenceSource` in the
//! chatbot — arbitrary mid-meeting lookups against the full document still go
//! there.

use crate::agents::brief::model::DocExtract;
use crate::domain::project::ProjectId;
use anyhow::Result;

pub trait DocumentSource: Send + Sync {
    /// Top `limit` passages by cosine similarity, best first.
    ///
    /// Scope is `project_id IS NULL OR project_id = ?`: a shared template stays
    /// global, a client contract scopes to its project.
    ///
    /// Returns an empty vector when no documents are indexed — the caller must
    /// not have to distinguish "nothing uploaded" from "nothing matched", and
    /// neither is an error.
    fn top_chunks(
        &self,
        project: ProjectId,
        query_vector: &[f32],
        limit: usize,
    ) -> Result<Vec<DocExtract>>;

    /// Number of indexed chunks in scope.
    ///
    /// Exists so the use case can skip embedding the seed query entirely when
    /// the corpus is empty. Without it, an install with no documents pays for
    /// one embedding call on every capture, forever, to match against nothing.
    fn count(&self, project: ProjectId) -> Result<usize>;

    /// Fetch all chunks for specific document IDs, in order.
    /// Used when the user explicitly attaches documents to a meeting.
    fn chunks_for_documents(&self, doc_ids: &[String]) -> Result<Vec<DocExtract>>;
}
