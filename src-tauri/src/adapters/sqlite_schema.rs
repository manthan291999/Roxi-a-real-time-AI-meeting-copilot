//! Schema guards for the tables Rust touches in `meeting_history.db`.
//!
//! ## Why any DDL lives on this side at all
//!
//! The gateway owns the schema and evolves it through forward-only migrations.
//! But the project picker runs *before the first capture ever happens*, so on a
//! fresh install there is no sidecar to have applied migration M008 yet, and
//! "+ New project" would have nothing to insert into.
//!
//! The split that resolves it:
//!
//! * Rust ensures the `projects` table exists, because Rust is what writes it
//!   (see `ports::project_repository` for why that ownership is correct).
//! * The gateway's M008 owns the `meetings` columns — `project_seq` has to be
//!   `MAX + 1` inside the same transaction as the meeting insert, so only the
//!   writer of that row can assign it.
//!
//! The `projects` DDL is therefore stated in two places: here and in
//! `gateway/db/migrate.js` M008. Both are idempotent and byte-equivalent in
//! effect, so whichever runs first wins and the other is a no-op. **Change them
//! together.**
//!
//! Everything Rust *reads* from `meetings` is column-guarded instead of
//! created, so an un-migrated database degrades to an un-scoped brief rather
//! than to an error.

use crate::domain::project::DEFAULT_PROJECT_CODE;
use anyhow::Result;
use rusqlite::Connection;

/// Kept in lockstep with gateway migration M008.
const PROJECTS_DDL: &str = "
CREATE TABLE IF NOT EXISTS projects (
  project_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name ON projects (name);
";

/// Create the `projects` table if it is missing and seed the `Unsorted` bucket.
///
/// The seed matters more than it looks: every code path that cannot resolve a
/// project falls back to it, so its absence would turn "the user skipped the
/// picker" into a failed capture.
pub fn ensure_projects(conn: &Connection) -> Result<()> {
    conn.execute_batch(PROJECTS_DDL)?;
    conn.execute(
        "INSERT INTO projects (name, code) SELECT 'Unsorted', ?1
         WHERE NOT EXISTS (SELECT 1 FROM projects WHERE code = ?1)",
        [DEFAULT_PROJECT_CODE],
    )?;
    Ok(())
}

/// Whether a table exists. Every read path checks, because the history UI can
/// open before any capture has created the database.
pub fn has_table(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
    .unwrap_or(false)
}

/// Whether a column exists on a table.
///
/// Used instead of adding the column: `meetings` belongs to the gateway, and a
/// project-scoped query against a database the gateway has not migrated yet
/// should return nothing, not fail and not silently acquire a schema Rust
/// cannot keep consistent.
pub fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    let Ok(mut stmt) = conn.prepare(&format!("PRAGMA table_info({table})")) else {
        return false;
    };
    // Collected rather than chained: the iterator borrows `stmt`, which the
    // tail expression would outlive.
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) else {
        return false;
    };
    let names: Vec<String> = rows.filter_map(Result::ok).collect();
    names.iter().any(|name| name == column)
}

/// True when the gateway has applied M008 and project scoping is usable.
pub fn meetings_are_project_scoped(conn: &Connection) -> bool {
    has_table(conn, "meetings") && has_column(conn, "meetings", "project_id")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn ensuring_projects_is_idempotent_and_seeds_one_bucket() {
        let conn = memory_db();
        ensure_projects(&conn).unwrap();
        ensure_projects(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM projects WHERE code = 'GEN'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "the Unsorted bucket must not be duplicated");
    }

    #[test]
    fn column_and_table_probes_report_absence_rather_than_failing() {
        let conn = memory_db();
        assert!(!has_table(&conn, "meetings"));
        assert!(!has_column(&conn, "meetings", "project_id"));
        assert!(!meetings_are_project_scoped(&conn));

        conn.execute_batch("CREATE TABLE meetings (id INTEGER PRIMARY KEY)")
            .unwrap();
        assert!(has_table(&conn, "meetings"));
        assert!(!meetings_are_project_scoped(&conn));

        conn.execute_batch("ALTER TABLE meetings ADD COLUMN project_id INTEGER")
            .unwrap();
        assert!(meetings_are_project_scoped(&conn));
    }
}
