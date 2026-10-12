//! Per-account visibility for `meeting_history.db`, enforced in one place.
//!
//! `apply_meeting_scope` creates TEMP views named `meetings`, `transcripts`,
//! `chunks`, … on a connection. SQLite resolves an unqualified table name in
//! the `temp` schema before `main`, so every existing query on that
//! connection (`FROM meetings`, `JOIN meetings m`, `FROM transcripts WHERE
//! meeting_id = ?`) reads the filtered view without being rewritten. A new
//! query is scoped by default; reaching another account's rows would take an
//! explicit `main.` prefix.
//!
//! The views are read-only. A write through a scoped connection fails loudly
//! instead of touching another account's rows; the gateway, which writes, uses
//! its own connection.

use anyhow::Result;
use rusqlite::Connection;

use crate::adapters::sqlite_schema::{has_column, has_table};
use crate::ports::account_scope::MeetingScope;

/// Tables whose rows belong to a meeting through `meeting_id`.
const MEETING_CHILD_TABLES: &[&str] = &[
    "transcripts",
    "chunks",
    "decisions",
    "action_items",
    "technical_analyses",
    "suggested_replies",
    "risks",
    "summaries",
    "glossary_terms",
    "speaker_profiles",
];

/// Adds `meetings.account_id` when missing. Kept in lockstep with gateway
/// migration M011, which tolerates the column already being there. Needed
/// here because the app reads history before any capture has run.
pub fn ensure_meeting_owner(conn: &Connection) -> Result<()> {
    if !has_table(conn, "meetings") {
        // The gateway creates the table, and M011 with it, on first capture.
        return Ok(());
    }
    if !has_column(conn, "meetings", "account_id") {
        conn.execute_batch("ALTER TABLE main.meetings ADD COLUMN account_id TEXT;")?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS main.idx_meetings_account ON meetings (account_id, start_time DESC);")?;
    Ok(())
}

/// Limits every meeting read on `conn` to what `scope` may see.
pub fn apply_meeting_scope(conn: &Connection, scope: &MeetingScope) -> Result<()> {
    if *scope == MeetingScope::Everyone || !has_table(conn, "meetings") {
        return Ok(());
    }
    let visible = match scope {
        MeetingScope::Account(id) if has_column(conn, "meetings", "account_id") => {
            format!("account_id = {}", sql_literal(id))
        }
        // No owner column yet means no meeting is owned by anyone.
        _ => "0".to_string(),
    };

    let mut sql = format!(
        "DROP VIEW IF EXISTS temp.meetings;
         CREATE TEMP VIEW meetings AS SELECT * FROM main.meetings WHERE {visible};"
    );
    for table in MEETING_CHILD_TABLES {
        if has_table(conn, table) && has_column(conn, table, "meeting_id") {
            sql.push_str(&format!(
                "DROP VIEW IF EXISTS temp.{table};
                 CREATE TEMP VIEW {table} AS SELECT * FROM main.{table} WHERE meeting_id IN (SELECT id FROM temp.meetings);"
            ));
        }
    }
    conn.execute_batch(&sql)?;
    Ok(())
}

/// Gives this Mac's unowned meetings (recorded before accounts, or in
/// local-only mode) to the account whose email is `ROXI_HISTORY_OWNER_EMAIL`.
///
/// An explicit email rather than "whoever signs in first", so a newcomer who
/// signs up on this Mac can never inherit someone else's history. Unset means
/// unowned meetings stay hidden from every account.
pub struct UnownedHistoryOwner {
    owner_email: Option<String>,
    db_path: std::path::PathBuf,
}

impl UnownedHistoryOwner {
    pub fn new(owner_email: Option<&str>, db_path: impl Into<std::path::PathBuf>) -> Self {
        let owner_email = owner_email
            .map(|e| e.trim().to_ascii_lowercase())
            .filter(|e| !e.is_empty());
        Self {
            owner_email,
            db_path: db_path.into(),
        }
    }

    pub fn from_env() -> Self {
        Self::new(
            std::env::var("ROXI_HISTORY_OWNER_EMAIL").ok().as_deref(),
            crate::adapters::db_paths::meeting_history_db(),
        )
    }
}

impl crate::ports::account_scope::UnownedHistoryClaim for UnownedHistoryOwner {
    fn claim_if_owner(&self, user_id: &str, email: Option<&str>) -> Result<usize> {
        let (Some(owner), Some(email)) = (&self.owner_email, email) else {
            return Ok(0);
        };
        if email.trim().to_ascii_lowercase() != *owner
            || user_id.trim().is_empty()
            || !self.db_path.exists()
        {
            return Ok(0);
        }
        let conn = Connection::open(&self.db_path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        ensure_meeting_owner(&conn)?;
        if !has_table(&conn, "meetings") {
            return Ok(0);
        }
        Ok(conn.execute(
            "UPDATE main.meetings SET account_id = ?1 WHERE account_id IS NULL",
            [user_id],
        )?)
    }
}

/// A single-quoted SQL string literal. Views cannot take bound parameters.
fn sql_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OpenFlags;

    fn temp_db() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("roxi-scope-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("h.db")
    }

    fn seeded(path: &std::path::Path) -> Connection {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE meetings (id INTEGER PRIMARY KEY, start_time TEXT, name TEXT);
             CREATE TABLE transcripts (id INTEGER PRIMARY KEY, meeting_id INTEGER, text TEXT);
             INSERT INTO meetings VALUES (1, '2026-01-01', 'a1'), (2, '2026-01-02', 'b1'), (3, '2026-01-03', 'legacy');
             INSERT INTO transcripts VALUES (1, 1, 'a'), (2, 2, 'b'), (3, 3, 'old');",
        )
        .unwrap();
        ensure_meeting_owner(&conn).unwrap();
        conn.execute_batch("UPDATE meetings SET account_id = 'user-a' WHERE id = 1; UPDATE meetings SET account_id = 'user-b' WHERE id = 2;")
            .unwrap();
        conn
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn each_account_sees_only_its_own_meetings_and_their_rows() {
        let path = temp_db();
        drop(seeded(&path));

        // Read-only, like LocalHistory: temp views still work.
        let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        apply_meeting_scope(&conn, &MeetingScope::Account("user-a".into())).unwrap();
        let name: String = conn
            .query_row("SELECT name FROM meetings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "a1");
        assert_eq!(count(&conn, "transcripts"), 1);
        // A child row of another account's meeting is unreachable by id too.
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM transcripts WHERE meeting_id = 2",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        // Re-applying (a different account on the same connection) replaces the views.
        apply_meeting_scope(&conn, &MeetingScope::Account("user-b".into())).unwrap();
        assert_eq!(count(&conn, "meetings"), 1);
        assert_eq!(count(&conn, "main.meetings"), 3);
    }

    #[test]
    fn nobody_sees_nothing_and_everyone_sees_all() {
        let conn = seeded(&temp_db());
        apply_meeting_scope(&conn, &MeetingScope::Everyone).unwrap();
        assert_eq!(count(&conn, "meetings"), 3);
        apply_meeting_scope(&conn, &MeetingScope::Nobody).unwrap();
        assert_eq!(count(&conn, "meetings"), 0);
        assert_eq!(count(&conn, "transcripts"), 0);
    }

    #[test]
    fn unowned_legacy_meetings_are_hidden_from_every_account() {
        let conn = seeded(&temp_db());
        apply_meeting_scope(&conn, &MeetingScope::Account("someone-new".into())).unwrap();
        assert_eq!(count(&conn, "meetings"), 0);
    }

    #[test]
    fn an_id_with_a_quote_cannot_widen_the_filter() {
        let conn = seeded(&temp_db());
        apply_meeting_scope(&conn, &MeetingScope::Account("x' OR '1'='1".into())).unwrap();
        assert_eq!(count(&conn, "meetings"), 0);
    }

    #[test]
    fn only_the_designated_email_claims_unowned_meetings() {
        use crate::ports::account_scope::UnownedHistoryClaim;
        let path = temp_db();
        drop(seeded(&path));
        let owner = UnownedHistoryOwner::new(Some(" Admin@Example.com "), &path);

        assert_eq!(
            owner
                .claim_if_owner("someone", Some("new@example.com"))
                .unwrap(),
            0
        );
        assert_eq!(owner.claim_if_owner("someone", None).unwrap(), 0);
        assert_eq!(
            owner
                .claim_if_owner("admin-id", Some("admin@example.com"))
                .unwrap(),
            1,
            "only the legacy meeting"
        );
        assert_eq!(
            owner
                .claim_if_owner("admin-id", Some("admin@example.com"))
                .unwrap(),
            0,
            "idempotent"
        );

        let conn = Connection::open(&path).unwrap();
        let owners: Vec<Option<String>> = conn
            .prepare("SELECT account_id FROM meetings ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            owners,
            vec![
                Some("user-a".into()),
                Some("user-b".into()),
                Some("admin-id".into())
            ],
            "owned meetings are never reassigned"
        );

        let unset = UnownedHistoryOwner::new(None, &path);
        assert_eq!(
            unset
                .claim_if_owner("admin-id", Some("admin@example.com"))
                .unwrap(),
            0
        );
    }

    #[test]
    fn ensuring_the_owner_column_is_idempotent() {
        let conn = seeded(&temp_db());
        ensure_meeting_owner(&conn).unwrap();
        assert!(has_column(&conn, "meetings", "account_id"));
    }
}
