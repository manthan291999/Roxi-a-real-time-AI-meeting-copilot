//! Gathers the brief's inputs through ports and fills the store.
//!
//! This is the I/O half of the brain; `agents::brief::compiler` is the pure
//! half. Keeping them apart is what makes the compiler testable without a
//! database and what keeps every agent unaware that a brief was ever gathered.
//!
//! ## Called before the sidecar is spawned
//!
//! `CaptureUseCase::start` runs this first. Two reasons:
//!   * By the time the first transcript comes back the briefs are warm, so no
//!     chunk waits on gathering.
//!   * A gathering failure surfaces as something the user can see at the moment
//!     they pressed Start, rather than as quietly worse answers ten minutes in.
//!
//! ## Failure policy
//!
//! Graded, deliberately:
//!   * **Document retrieval fails** — log, compile with no reference material. A
//!     brief without documents is still worth having.
//!   * **Meeting history fails** — same. Each section is gathered
//!     independently so one bad table cannot cost the whole brief.
//!   * **A brief exceeds the cap** — that agent gets no brief and falls back to
//!     its bare contract. Loud in the log, invisible to the user.
//!
//! Nothing here fails the capture. The user is about to be in a meeting, and an
//! un-grounded session is worth vastly more than no session.

use crate::agents::brief::budget::Budget;
use crate::agents::brief::compiler;
use crate::agents::brief::model::{BriefInputs, DocExtract, SharedBrief};
use crate::agents::brief::store::BriefStore;
use crate::domain::project::ProjectRef;
use crate::domain::session::SessionId;
use crate::ports::brief_source::BriefSource;
use crate::ports::document_source::DocumentSource;
use crate::ports::embedding::EmbeddingGateway;
use crate::ports::project_repository::ProjectRepository;
use std::sync::Arc;

/// Query caps. These bound the *query*, not the brief — `Budget` decides what
/// actually fits. Generous enough that the budget is what does the choosing.
const GLOSSARY_QUERY_LIMIT: usize = 80;
const HISTORY_QUERY_LIMIT: usize = 8;
const OPEN_ITEMS_QUERY_LIMIT: usize = 20;
/// Top-K document passages. Eight ~250-token chunks is ~2000 tokens, which is
/// the documents budget. More would be trimmed; fewer wastes the retrieval.
const DOC_TOP_K: usize = 8;

/// What the user typed in the intake modal, frozen at capture.
#[derive(Clone, Debug, Default)]
pub struct CaptureContext {
    pub context_text: Option<String>,
    pub role: Option<String>,
    pub doc_ids: Option<Vec<String>>,
}

pub struct BriefUseCase {
    projects: Arc<dyn ProjectRepository>,
    source: Arc<dyn BriefSource>,
    documents: Arc<dyn DocumentSource>,
    embeddings: Arc<dyn EmbeddingGateway>,
    store: Arc<BriefStore>,
    budget: Budget,
}

impl BriefUseCase {
    pub fn new(
        projects: Arc<dyn ProjectRepository>,
        source: Arc<dyn BriefSource>,
        documents: Arc<dyn DocumentSource>,
        embeddings: Arc<dyn EmbeddingGateway>,
        store: Arc<BriefStore>,
    ) -> Self {
        Self {
            projects,
            source,
            documents,
            embeddings,
            store,
            budget: Budget::default(),
        }
    }

    /// Compile and store one brief per registered agent.
    ///
    /// Never returns `Err`: see the failure policy above.
    pub async fn build_for_capture(
        &self,
        session: SessionId,
        project: Option<&ProjectRef>,
        context: &CaptureContext,
    ) {
        let inputs = self.gather(project, context).await;

        let mut compiled = 0usize;
        let mut below_floor = Vec::new();

        for (tag, role_contract) in crate::agents::agents::role_contracts::ALL {
            match compiler::compile(role_contract, &inputs, &self.budget) {
                Ok(brief) => {
                    tracing::info!(
                        session = %session,
                        agent = *tag,
                        prefix_hash = %brief.prefix_hash,
                        tokens = brief.token_estimate,
                        above_cache_floor = brief.above_cache_floor,
                        glossary = brief.included.glossary_terms,
                        participants = brief.included.participants,
                        meetings = brief.included.prior_meetings.len(),
                        docs = brief.included.doc_chunks.len(),
                        "[brief] compiled"
                    );
                    if !brief.dropped.reasons.is_empty() {
                        tracing::debug!(
                            agent = *tag,
                            "[brief] budget dropped: {}",
                            brief.dropped.reasons.join(", ")
                        );
                    }
                    if !brief.above_cache_floor {
                        below_floor.push(*tag);
                    }
                    // `role_contracts::ALL` holds `&'static str` tags, and the
                    // store keys on the same `&'static str` the agent returns
                    // from `name()` — so no allocation and no second mapping.
                    self.store.put(session, *tag, SharedBrief::new(brief));
                    compiled += 1;
                }
                Err(e) => {
                    // Over the cap. That agent runs un-grounded rather than the
                    // whole capture losing its brain.
                    tracing::error!(
                        session = %session,
                        agent = *tag,
                        "[brief] compile failed, agent will run un-grounded: {e:#}"
                    );
                }
            }
        }

        if !below_floor.is_empty() {
            // Not an error. A brand-new project has no history, no glossary and
            // no documents, so its brief cannot reach 1024 tokens and nothing
            // will be cached — small brief, small prefill, nothing to save.
            // Logged so a flat-zero cache hit rate in the dashboard reads as
            // "expected" rather than "broken".
            tracing::info!(
                session = %session,
                "[brief] below the {}-token cache floor for {} — no prefix caching this session",
                compiler::CACHE_FLOOR_TOKENS,
                below_floor.join(", ")
            );
        }

        // Read back from the store rather than trusting the local counter: what
        // matters is what an agent will actually find, not what compiled.
        tracing::info!(
            session = %session,
            stored = self.store.len(session),
            compiled,
            of = crate::agents::agents::role_contracts::ALL.len(),
            "[brief] ready"
        );
    }

    /// Release a finished capture's briefs.
    pub fn release(&self, session: SessionId) {
        self.store.clear_session(session);
    }

    /// One round of I/O, all of it here.
    ///
    /// Each section degrades to empty on failure rather than propagating: a
    /// missing glossary table must not cost the roster, the history or the
    /// user's own context.
    async fn gather(&self, project: Option<&ProjectRef>, context: &CaptureContext) -> BriefInputs {
        let Some(project) = project else {
            // No project resolved — everything project-scoped is empty, but the
            // role contract and the user's stated context still make a brief.
            return BriefInputs {
                user_context: context.context_text.clone(),
                user_role: context.role.clone(),
                ..Default::default()
            };
        };

        let id = project.id;

        let description = match self.projects.get(id) {
            Ok(Some(found)) => found.description,
            Ok(None) => None,
            Err(e) => {
                tracing::warn!("[brief] project lookup failed: {e:#}");
                None
            }
        };

        BriefInputs {
            project: Some(project.clone()),
            project_description: description,
            user_context: context.context_text.clone(),
            user_role: context.role.clone(),
            glossary: or_empty(
                self.source.glossary_for_project(id, GLOSSARY_QUERY_LIMIT),
                "glossary",
            ),
            roster: or_empty(self.source.roster_for_project(id), "roster"),
            prior_meetings: or_empty(
                self.source.recent_digests(id, HISTORY_QUERY_LIMIT),
                "history",
            ),
            open_items: or_empty(
                self.source.open_items(id, OPEN_ITEMS_QUERY_LIMIT),
                "open items",
            ),
            doc_extracts: self.retrieve_documents(project, context).await,
        }
    }

    /// The one retrieval, at capture start.
    ///
    /// This is the part of the brain that is not pure CAG: a 200-page SOW does
    /// not fit a 5k budget, so the reference section is top-K chunks chosen by
    /// an embedding query — RAG once, CAG thereafter. One embedding call per
    /// meeting, where the live path it replaces paid one per chunk.
    ///
    /// The failure mode that follows is worth stating plainly: a bad seed query
    /// grounds *every* chunk of the meeting on the wrong passages, and unlike
    /// per-query retrieval there is no later correction. That is why arbitrary
    /// mid-meeting lookups stay with the chatbot's `DocumentEvidenceSource`.
    async fn retrieve_documents(
        &self,
        project: &ProjectRef,
        context: &CaptureContext,
    ) -> Vec<DocExtract> {
        // If the user explicitly selected documents, use those directly.
        if let Some(doc_ids) = &context.doc_ids {
            if !doc_ids.is_empty() {
                match self.documents.chunks_for_documents(doc_ids) {
                    Ok(extracts) => {
                        tracing::info!(
                            chunks = extracts.len(),
                            docs = doc_ids.len(),
                            "[brief] explicitly selected documents fetched"
                        );
                        return extracts;
                    }
                    Err(e) => {
                        tracing::warn!("[brief] failed to fetch explicitly selected documents: {e:#}");
                        // Fall through to embedding search or return empty?
                        // If explicit fetch failed, embedding search might fail too. 
                        // But let's fallback to embedding just in case, or just return empty.
                        return Vec::new();
                    }
                }
            }
        }

        // Otherwise, fall back to embedding-based semantic retrieval.
        match self.documents.count(project.id) {
            Ok(0) => return Vec::new(),
            Ok(_) => {}
            Err(e) => {
                tracing::warn!("[brief] document store unreadable: {e:#}");
                return Vec::new();
            }
        }

        let query = seed_query(project, context);
        let vector = match self.embeddings.embed_one(&query, "brief_seed").await {
            Ok(vector) => vector,
            Err(e) => {
                tracing::warn!("[brief] seed embedding failed, no reference material: {e:#}");
                return Vec::new();
            }
        };

        match self.documents.top_chunks(project.id, &vector, DOC_TOP_K) {
            Ok(extracts) => {
                tracing::info!(
                    project = %project.id,
                    chunks = extracts.len(),
                    top_score = extracts.first().map(|e| e.score).unwrap_or(0.0),
                    "[brief] document pre-retrieval done"
                );
                extracts
            }
            Err(e) => {
                tracing::warn!("[brief] document retrieval failed: {e:#}");
                Vec::new()
            }
        }
    }
}

/// The query the reference material is chosen by: what this project is, plus
/// what the user said this meeting is about.
///
/// Pure and separate so it can be reasoned about on its own — it is the single
/// input that decides whether the whole meeting is grounded on the right pages.
fn seed_query(project: &ProjectRef, context: &CaptureContext) -> String {
    let mut parts = vec![project.name.clone()];
    if let Some(text) = context
        .context_text
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        parts.push(text.to_string());
    }
    if let Some(role) = context
        .role
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        parts.push(format!("Perspective: {role}"));
    }
    parts.join(". ")
}

/// Log and degrade to empty. One section failing must not cost the others.
fn or_empty<T>(result: anyhow::Result<Vec<T>>, what: &str) -> Vec<T> {
    match result {
        Ok(values) => values,
        Err(e) => {
            tracing::warn!("[brief] could not read {what}: {e:#}");
            Vec::new()
        }
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
    fn the_seed_query_joins_the_project_and_the_users_own_words() {
        let query = seed_query(
            &a_project(),
            &CaptureContext {
                context_text: Some("  SOW review with the client  ".into()),
                role: Some("Technical Lead".into()),
                doc_ids: None,
            },
        );
        assert_eq!(
            query,
            "Project Roxi. SOW review with the client. Perspective: Technical Lead"
        );
    }

    #[test]
    fn a_context_free_capture_still_produces_a_usable_seed() {
        assert_eq!(
            seed_query(&a_project(), &CaptureContext::default()),
            "Project Roxi"
        );
    }

    #[test]
    fn a_failed_section_degrades_to_empty() {
        let failed: anyhow::Result<Vec<i32>> = Err(anyhow::anyhow!("no such table"));
        assert!(or_empty(failed, "glossary").is_empty());
    }
}
