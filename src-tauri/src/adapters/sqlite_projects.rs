//! `ProjectRepository` over `meeting_history.db`.

use crate::adapters::db_paths;
use crate::adapters::meeting_scope::apply_meeting_scope;
use crate::adapters::sqlite_schema::{ensure_projects, meetings_are_project_scoped};
use crate::domain::project::{
    derive_code, Project, ProjectId, ProjectRef, ProjectSelection, DEFAULT_PROJECT_CODE,
};
use crate::ports::account_scope::CurrentAccount;
use crate::ports::project_repository::ProjectRepository;
use anyhow::{anyhow, Result};
use rusqlite::{Connection, OptionalExtension};
use std::sync::Arc;
use std::time::Duration;

/// How many `-2`, `-3`… suffixes to try before giving up on a derived code.
const MAX_CODE_ATTEMPTS: u32 = 50;

/// Projects are shared by every account on this Mac; the meeting counts and
/// "last used" dates they show are the signed-in account's own.
pub struct SqliteProjectRepository {
    account: Arc<dyn CurrentAccount>,
}

impl SqliteProjectRepository {
    pub fn new(account: Arc<dyn CurrentAccount>) -> Self {
        Self { account }
    }

    fn open(&self) -> Result<Connection> {
        let conn = Connection::open(db_paths::meeting_history_db())?;
        // The gateway is writing this file throughout a meeting. Every reader
        // sets a timeout for the same reason.
        conn.busy_timeout(Duration::from_secs(5))?;
        ensure_projects(&conn)?;
        apply_meeting_scope(&conn, &self.account.meeting_scope())?;
        Ok(conn)
    }

    /// A code no existing project holds. `projects.code` is UNIQUE, so this is
    /// a convenience for the common case, not the correctness guarantee — the
    /// insert is still what rejects a duplicate.
    fn unique_code(conn: &Connection, name: &str) -> Result<String> {
        let base = derive_code(name);
        for attempt in 0..MAX_CODE_ATTEMPTS {
            let candidate = if attempt == 0 {
                base.clone()
            } else {
                format!("{base}{}", attempt + 1)
            };
            let taken: Option<i64> = conn
                .query_row(
                    "SELECT 1 FROM projects WHERE code = ?1",
                    [&candidate],
                    |row| row.get(0),
                )
                .optional()?;
            if taken.is_none() {
                return Ok(candidate);
            }
        }
        Err(anyhow!(
            "could not derive a free project code from '{name}'"
        ))
    }

    fn by_name(conn: &Connection, name: &str) -> Result<Option<ProjectRef>> {
        Ok(conn
            .query_row(
                "SELECT project_id, code, name FROM projects WHERE name = ?1 COLLATE NOCASE",
                [name],
                Self::to_reference,
            )
            .optional()?)
    }

    fn to_reference(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRef> {
        Ok(ProjectRef {
            id: ProjectId::new(row.get(0)?),
            code: row.get(1)?,
            name: row.get(2)?,
        })
    }

    /// The `Unsorted` bucket. `ensure_projects` seeds it, so a missing row here
    /// means the database was tampered with rather than merely un-migrated.
    fn unsorted(conn: &Connection) -> Result<ProjectRef> {
        conn.query_row(
            "SELECT project_id, code, name FROM projects WHERE code = ?1",
            [DEFAULT_PROJECT_CODE],
            Self::to_reference,
        )
        .map_err(|e| anyhow!("the '{DEFAULT_PROJECT_CODE}' project is missing: {e}"))
    }
}

impl ProjectRepository for SqliteProjectRepository {
    fn list(&self) -> Result<Vec<Project>> {
        let conn = self.open()?;

        // Ordering is a product decision: people run several meetings for one
        // project in a row, so most-recently-used first is what makes the
        // default selection right most of the time. On an un-migrated database
        // there is no join to make, so fall back to newest-created.
        let sql = if meetings_are_project_scoped(&conn) {
            "SELECT p.project_id, p.code, p.name, p.description,
                    COUNT(m.id)          AS meeting_count,
                    MAX(m.start_time)    AS last_used_at
             FROM projects p
             LEFT JOIN meetings m ON m.project_id = p.project_id
             WHERE p.archived_at IS NULL
             GROUP BY p.project_id
             ORDER BY last_used_at DESC NULLS LAST, p.created_at DESC"
        } else {
            "SELECT p.project_id, p.code, p.name, p.description, 0, NULL
             FROM projects p
             WHERE p.archived_at IS NULL
             ORDER BY p.created_at DESC"
        };

        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |row| {
            Ok(Project {
                reference: ProjectRef {
                    id: ProjectId::new(row.get(0)?),
                    code: row.get(1)?,
                    name: row.get(2)?,
                },
                description: row.get(3)?,
                meeting_count: row.get(4)?,
                last_used_at: row.get(5)?,
            })
        })?;

        Ok(rows.filter_map(Result::ok).collect())
    }

    fn create(&self, name: &str, description: Option<&str>) -> Result<ProjectRef> {
        let name = name.trim();
        if name.is_empty() {
            return Err(anyhow!("a project needs a name"));
        }

        let conn = self.open()?;

        // Idempotent on name. The inline "+ New project" row is one mistyped
        // Enter away from a second "Project Roxi", and a duplicate project
        // silently splits a brief's history in half.
        if let Some(existing) = Self::by_name(&conn, name)? {
            tracing::info!(
                project = %existing.id,
                "[projects] reusing existing project for name '{name}'"
            );
            return Ok(existing);
        }

        let code = Self::unique_code(&conn, name)?;
        let description = description.map(str::trim).filter(|d| !d.is_empty());

        conn.execute(
            "INSERT INTO projects (name, code, description) VALUES (?1, ?2, ?3)",
            rusqlite::params![name, code, description],
        )?;

        let id = ProjectId::new(conn.last_insert_rowid());
        tracing::info!(project = %id, code = %code, "[projects] created '{name}'");

        Ok(ProjectRef {
            id,
            code,
            name: name.to_string(),
        })
    }

    fn get(&self, id: ProjectId) -> Result<Option<Project>> {
        Ok(self.list()?.into_iter().find(|p| p.reference.id == id))
    }

    fn resolve(&self, selection: &ProjectSelection) -> Result<ProjectRef> {
        match selection {
            ProjectSelection::Existing(id) => {
                let conn = self.open()?;
                let found = conn
                    .query_row(
                        "SELECT project_id, code, name FROM projects WHERE project_id = ?1",
                        [id.value()],
                        Self::to_reference,
                    )
                    .optional()?;

                match found {
                    Some(reference) => Ok(reference),
                    None => {
                        // A stale id from a picker rendered before a delete.
                        // The user is about to be in a meeting; taxonomy is
                        // never worth blocking capture on.
                        tracing::warn!(
                            project = %id,
                            "[projects] selected project no longer exists — filing under Unsorted"
                        );
                        Self::unsorted(&conn)
                    }
                }
            }
            ProjectSelection::New { name } => self.create(name, None),
            ProjectSelection::Unsorted => Self::unsorted(&self.open()?),
        }
    }
}
