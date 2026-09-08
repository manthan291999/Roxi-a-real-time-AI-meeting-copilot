use crate::domain::usage::{AgentUsage, SessionUsage};
use crate::ports::usage::UsageRepository;
use anyhow::Result;
use rusqlite::{Connection, OpenFlags};
use std::time::Duration;

/// Reads `llm_usage.db`, written by `agents::adapters::usage_store`.
///
/// Read-only and tolerant of the database not existing yet: a session that
/// hasn't made an LLM call has nothing to report, not an error, and this must
/// never be the thing that creates a stray `llm_usage.db` on a fresh install.
pub struct SqliteUsageRepository;

impl SqliteUsageRepository {
    pub fn new() -> Self {
        Self
    }

    fn open_db(&self) -> Result<Connection> {
        let conn = Connection::open_with_flags(
            crate::adapters::db_paths::llm_usage_db(),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(Duration::from_secs(5))?;
        Ok(conn)
    }

    fn table_exists(conn: &Connection) -> Result<bool> {
        let count: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='llm_requests'",
            [],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }
}

/// The two queries, split out from `SqliteUsageRepository` so they're
/// testable against an in-memory connection without touching the filesystem
/// or `LLM_USAGE_DB`.
fn query_usage(conn: &Connection, session_id: u64) -> Result<SessionUsage> {
    let session_id_i64 = session_id as i64;

    let (calls, prompt_tokens, completion_tokens, cost_usd, first_ts): (
        i64,
        i64,
        i64,
        f64,
        Option<String>,
    ) = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(prompt_tokens), 0),
                COALESCE(SUM(completion_tokens), 0),
                COALESCE(SUM(cost_usd), 0),
                MIN(ts)
         FROM llm_requests WHERE session_id = ?1",
        [session_id_i64],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    )?;

    let mut stmt = conn.prepare(
        "SELECT COALESCE(tag, '(untagged)') AS tag, COUNT(*), COALESCE(SUM(cost_usd), 0)
         FROM llm_requests
         WHERE session_id = ?1
         GROUP BY tag
         ORDER BY 3 DESC",
    )?;
    let by_agent = stmt
        .query_map([session_id_i64], |row| {
            Ok(AgentUsage {
                tag: row.get(0)?,
                calls: row.get(1)?,
                cost_usd: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(SessionUsage {
        session_id,
        cost_usd,
        calls,
        prompt_tokens,
        completion_tokens,
        first_ts,
        by_agent,
    })
}

impl UsageRepository for SqliteUsageRepository {
    fn session_usage(&self, session_id: u64) -> Result<SessionUsage> {
        // No db file yet (no LLM call has ever been recorded) is the common
        // case on a fresh install, not a failure — degrade to empty rather
        // than surface an error the UI would have to explain.
        let conn = match self.open_db() {
            Ok(conn) => conn,
            Err(_) => return Ok(SessionUsage::empty(session_id)),
        };
        if !Self::table_exists(&conn)? {
            return Ok(SessionUsage::empty(session_id));
        }
        query_usage(&conn, session_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal schema: just the columns `query_usage` reads. The real table
    /// (`usage_store.rs::SCHEMA`) has more, but this adapter never writes.
    fn seeded_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE llm_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                tag TEXT,
                status TEXT NOT NULL,
                prompt_tokens INTEGER,
                completion_tokens INTEGER,
                cost_usd REAL NOT NULL DEFAULT 0,
                session_id INTEGER
            );",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO llm_requests (ts, tag, status, prompt_tokens, completion_tokens, cost_usd, session_id) VALUES
                ('2026-01-01T10:00:00Z', 'response_agent', 'ok', 500, 200, 0.09, 1),
                ('2026-01-01T10:00:05Z', 'explanation',    'ok', 300, 100, 0.03, 1),
                ('2026-01-01T10:00:10Z', 'explanation',    'ok', 250,  80, 0.02, 1),
                ('2026-01-01T09:00:00Z', 'response_agent', 'ok', 400, 150, 5.00, 2);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn sums_cost_and_tokens_scoped_to_one_session() {
        let usage = query_usage(&seeded_db(), 1).unwrap();
        assert_eq!(usage.session_id, 1);
        assert_eq!(usage.calls, 3);
        assert_eq!(usage.prompt_tokens, 1050);
        assert_eq!(usage.completion_tokens, 380);
        assert!((usage.cost_usd - 0.14).abs() < 1e-9);
        // A different session's $5.00 row must not leak into this total.
        assert!(usage.cost_usd < 1.0);
    }

    #[test]
    fn groups_by_agent_tag_highest_cost_first() {
        let usage = query_usage(&seeded_db(), 1).unwrap();
        assert_eq!(usage.by_agent.len(), 2);
        assert_eq!(usage.by_agent[0].tag, "response_agent");
        assert_eq!(usage.by_agent[0].calls, 1);
        assert_eq!(usage.by_agent[1].tag, "explanation");
        assert_eq!(usage.by_agent[1].calls, 2);
    }

    #[test]
    fn a_session_with_no_calls_is_zeroed_not_an_error() {
        let usage = query_usage(&seeded_db(), 999).unwrap();
        assert_eq!(usage.calls, 0);
        assert_eq!(usage.cost_usd, 0.0);
        assert!(usage.by_agent.is_empty());
        assert!(usage.first_ts.is_none());
    }

    #[test]
    fn first_ts_is_the_earliest_call_in_the_session() {
        let usage = query_usage(&seeded_db(), 1).unwrap();
        assert_eq!(usage.first_ts.as_deref(), Some("2026-01-01T10:00:00Z"));
    }
}
