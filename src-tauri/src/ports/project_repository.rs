//! Project taxonomy: list, create, resolve.
//!
//! ## Writer ownership
//!
//! `gateway/db/index.js` documents the gateway as the sole writer of
//! `meeting_history.db`, to keep two Node processes off the same WAL. That rule
//! is about *meeting-scoped* tables written during a live capture. `projects`
//! is neither: rows are created from the intake modal, before any sidecar
//! exists, and never touched again while a meeting runs.
//!
//! So the split is:
//!   * Rust creates and lists `projects` rows (this port). No sidecar is
//!     running at that moment, so there is nobody to delegate to.
//!   * The gateway assigns `meetings.project_id`, `project_seq` and
//!     `display_id` at insert time — `project_seq` must be `MAX + 1` inside the
//!     same transaction as the insert, so it can only live with the writer of
//!     that row.
//!
//! Adapters must set a `busy_timeout` for the same reason every other reader
//! does.

use crate::domain::project::{Project, ProjectId, ProjectRef, ProjectSelection};
use anyhow::Result;

pub trait ProjectRepository: Send + Sync {
    /// Every non-archived project, most recently used first. What the picker
    /// renders, so its order is a product decision, not an incidental one:
    /// people run several meetings for one project in a row.
    fn list(&self) -> Result<Vec<Project>>;

    /// Create a project, deriving a unique code from `name`.
    ///
    /// Idempotent on name: an existing project with the same name is returned
    /// rather than duplicated, because the intake modal's "+ New project" row
    /// is one mistyped Enter away from a second `Project Roxi`.
    fn create(&self, name: &str, description: Option<&str>) -> Result<ProjectRef>;

    fn get(&self, id: ProjectId) -> Result<Option<Project>>;

    /// Turn what the user picked into a concrete project, creating one or
    /// falling back to the `Unsorted` bucket as needed.
    ///
    /// Never fails for a missing project: a stale id from a picker rendered
    /// before a delete falls back to `Unsorted` rather than blocking capture.
    /// The user is about to be in a meeting.
    fn resolve(&self, selection: &ProjectSelection) -> Result<ProjectRef>;
}
