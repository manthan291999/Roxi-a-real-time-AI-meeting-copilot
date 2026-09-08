//! Brief data types — plain data, no behaviour beyond accessors.
//!
//! Everything here is an input to or an output of `compiler::compile`, which is
//! a pure function. Nothing in this module knows about SQLite, HTTP or a clock.

use crate::domain::project::ProjectRef;
use std::sync::Arc;

/// One glossary entry, project-scoped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlossaryTerm {
    pub term: String,
    pub definition: String,
}

/// A known participant. `role` is optional because most are learned from STT
/// labels before anyone renames them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Participant {
    pub name: String,
    pub role: Option<String>,
}

/// A prior meeting compressed to what the brief can afford to carry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MeetingDigest {
    /// `ROXI-007`. Sorts and renders as the human-facing identity.
    pub display_id: String,
    /// `YYYY-MM-DD`. A stored date, never a rendered "now" — see the compiler's
    /// determinism contract.
    pub date: String,
    pub summary: Option<String>,
    pub decisions: Vec<String>,
}

/// An unresolved action item or risk carried into this meeting.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenItem {
    pub kind: OpenItemKind,
    pub text: String,
    pub owner: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenItemKind {
    Action,
    Risk,
}

impl OpenItemKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Action => "action",
            Self::Risk => "risk",
        }
    }
}

/// One retrieved document passage.
#[derive(Clone, Debug, PartialEq)]
pub struct DocExtract {
    pub file_name: String,
    pub page: Option<i64>,
    pub text: String,
    /// Retrieval score. Carried for logging only — the compiler consumes the
    /// slice in the order the caller ranked it and never re-sorts by score.
    pub score: f32,
}

/// Everything gathered once, at capture start, for one project.
///
/// The caller is responsible for rank order on `prior_meetings` (newest first)
/// and `doc_extracts` (best first). The compiler re-sorts only the sets that
/// have a canonical order — glossary by term, roster by name — because those
/// arrive from a query whose order is not part of their meaning.
#[derive(Clone, Debug, Default)]
pub struct BriefInputs {
    pub project: Option<ProjectRef>,
    pub project_description: Option<String>,
    pub user_context: Option<String>,
    pub user_role: Option<String>,
    pub glossary: Vec<GlossaryTerm>,
    pub roster: Vec<Participant>,
    /// Caller passes newest-first.
    pub prior_meetings: Vec<MeetingDigest>,
    pub open_items: Vec<OpenItem>,
    /// Caller passes rank-ordered.
    pub doc_extracts: Vec<DocExtract>,
}

/// A compiled, frozen prefix plus everything needed to prove it is stable.
#[derive(Clone, Debug)]
pub struct CompiledBrief {
    /// The frozen prefix, sentinel to sentinel.
    ///
    /// Private with no setter: the one failure mode that matters is a byte
    /// mutating after construction, and the type system is a cheaper guard
    /// against it than any convention or review checklist.
    prefix: String,
    /// sha256 of `prefix`, hex, first 16 chars. `COUNT(DISTINCT prefix_hash)`
    /// per (session, agent) must be 1 — see the dashboard's stability panel.
    pub prefix_hash: String,
    pub token_estimate: usize,
    /// False when the brief is under OpenAI's 1024-token caching floor, in
    /// which case no prefix caching happens at all — silently, with no error.
    pub above_cache_floor: bool,
    pub included: BriefManifest,
    /// What the budget cut, and why.
    pub dropped: BriefManifest,
}

impl CompiledBrief {
    /// Constructor lives here rather than in the compiler so `prefix` can stay
    /// private to this module.
    pub(super) fn new(
        prefix: String,
        prefix_hash: String,
        token_estimate: usize,
        above_cache_floor: bool,
        included: BriefManifest,
        dropped: BriefManifest,
    ) -> Self {
        Self {
            prefix,
            prefix_hash,
            token_estimate,
            above_cache_floor,
            included,
            dropped,
        }
    }

    pub fn prefix(&self) -> &str {
        &self.prefix
    }
}

/// What a brief carries, or what it had to leave out.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BriefManifest {
    pub glossary_terms: usize,
    pub participants: usize,
    /// `display_id`s.
    pub prior_meetings: Vec<String>,
    pub open_items: usize,
    /// `"contract.pdf p4"`.
    pub doc_chunks: Vec<String>,
    /// Human-readable drop reasons, e.g. `"6 glossary terms: over budget"`.
    pub reasons: Vec<String>,
}

/// Shared so N agents' briefs — compiled from one round of I/O and held for the
/// life of a capture — are cloned by pointer, not by 5k tokens of string.
pub type SharedBrief = Arc<CompiledBrief>;
