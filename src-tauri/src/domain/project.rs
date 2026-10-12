//! Project identity — the scope axis for everything the brain reads.
//!
//! Deliberately a domain type rather than a bare `i64` threaded through
//! signatures. A project id reaches the brief compiler, the document source, the
//! brief source and three Tauri commands; at that many call sites an untyped
//! integer is indistinguishable from a meeting id or a chunk id at the point of
//! the mistake.

use serde::{Deserialize, Serialize};

/// Newtype over the `projects.project_id` surrogate key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectId(i64);

impl ProjectId {
    pub fn new(raw: i64) -> Self {
        Self(raw)
    }

    pub fn value(self) -> i64 {
        self.0
    }
}

impl std::fmt::Display for ProjectId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// A project as everything downstream needs to see it: enough to render, to
/// scope a query, and to build a display id — and nothing more.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectRef {
    pub id: ProjectId,
    /// Short uppercase code, the `ROXI` in `ROXI-007`.
    pub code: String,
    pub name: String,
}

/// A project row as the UI lists it. Carries `description` because the project
/// picker shows it and the brief compiler embeds it; `ProjectRef` stays narrow
/// so hot paths don't clone a charter they never read.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    #[serde(flatten)]
    pub reference: ProjectRef,
    pub description: Option<String>,
    pub meeting_count: i64,
    /// RFC3339. Used by the picker to order "recent" ahead of alphabetical.
    pub last_used_at: Option<String>,
}

/// The `Unsorted` bucket every un-filed meeting lands in. Created by gateway
/// migration M008 so it always exists; nothing here may assume its id.
pub const DEFAULT_PROJECT_CODE: &str = "GEN";

/// What the user picked in the intake modal: an existing project, a new one to
/// create, or nothing at all.
///
/// Modelled as a sum type rather than two `Option` fields so "both set" and
/// "id set but name also set" are unrepresentable instead of merely unhandled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectSelection {
    Existing(ProjectId),
    New {
        name: String,
    },
    /// "Skip this context" — file under `DEFAULT_PROJECT_CODE`.
    Unsorted,
}

impl ProjectSelection {
    /// Build a selection from the loose pair the Tauri command receives.
    /// An explicit id wins over a name: the picker only sends a name for the
    /// inline "+ New project" row, which has no id yet.
    pub fn from_parts(project_id: Option<i64>, new_project_name: Option<String>) -> Self {
        if let Some(id) = project_id {
            return Self::Existing(ProjectId::new(id));
        }
        match new_project_name.map(|n| n.trim().to_string()) {
            Some(name) if !name.is_empty() => Self::New { name },
            _ => Self::Unsorted,
        }
    }
}

// NOTE: the `display_id` format (`CODE-007`) is not defined here. Rust never
// writes one: the gateway builds it in the same transaction as the meeting
// insert (it needs `MAX(project_seq) + 1`), and the intake modal previews it in
// TypeScript. A third copy on this side would be a copy nothing calls.

/// Derive a project code from a free-text name, for inline creation.
///
/// Pure and deterministic; uniqueness is the database's job (`projects.code` is
/// UNIQUE), and the repository is what disambiguates a collision.
pub fn derive_code(name: &str) -> String {
    let letters: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(4)
        .collect::<String>()
        .to_uppercase();

    if letters.is_empty() {
        DEFAULT_PROJECT_CODE.to_string()
    } else {
        letters
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_code_strips_punctuation_and_falls_back() {
        assert_eq!(derive_code("Project Roxi"), "PROJ");
        assert_eq!(derive_code("  !!!  "), DEFAULT_PROJECT_CODE);
    }

    #[test]
    fn an_explicit_id_wins_over_a_name() {
        assert_eq!(
            ProjectSelection::from_parts(Some(4), Some("Ignored".into())),
            ProjectSelection::Existing(ProjectId::new(4))
        );
        assert_eq!(
            ProjectSelection::from_parts(None, Some("  ".into())),
            ProjectSelection::Unsorted
        );
    }
}
