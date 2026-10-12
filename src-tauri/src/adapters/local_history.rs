//! Reads this Mac's meeting history for import into the cloud account.
//!
//! Read-only: the gateway is the sole writer of `meeting_history.db`, and an
//! import must never change local history. Output matches the JSON the
//! server's `POST /v1/import/meetings` expects.
//!
//! Older databases may be missing tables (every migration added some), and
//! SQLite columns are loosely typed, so every read tolerates both.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags, Row};
use serde::Serialize;
use serde_json::{json, Value};

use crate::adapters::meeting_scope::apply_meeting_scope;
use crate::ports::account_scope::{CurrentAccount, MeetingScope, Unscoped};

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalHistoryStats {
    pub meetings: usize,
    pub transcript_lines: usize,
    pub projects: usize,
}

pub struct LocalHistory {
    path: PathBuf,
    account: Arc<dyn CurrentAccount>,
}

impl LocalHistory {
    /// Sees every meeting in the file. Production narrows it with `scoped`.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            account: Arc::new(Unscoped),
        }
    }

    /// Only the signed-in account's meetings are counted and imported.
    pub fn scoped(mut self, account: Arc<dyn CurrentAccount>) -> Self {
        self.account = account;
        self
    }

    /// Projects are shared by every account on this Mac; an account imports
    /// only the ones its own meetings are filed under.
    fn projects_filter(&self, conn: &Connection) -> &'static str {
        match self.account.meeting_scope() {
            MeetingScope::Everyone => "",
            _ if has_table(conn, "meetings").unwrap_or(false) => {
                " WHERE project_id IN (SELECT project_id FROM meetings)"
            }
            _ => " WHERE 0",
        }
    }

    pub fn default_location() -> Self {
        Self::new(crate::adapters::db_paths::meeting_history_db())
    }

    fn open(&self) -> Result<Option<Connection>> {
        if !Path::new(&self.path).exists() {
            return Ok(None);
        }
        let conn = Connection::open_with_flags(&self.path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        apply_meeting_scope(&conn, &self.account.meeting_scope())?;
        Ok(Some(conn))
    }

    pub fn stats(&self) -> Result<LocalHistoryStats> {
        let Some(conn) = self.open()? else {
            return Ok(LocalHistoryStats::default());
        };
        let count = |table: &str| -> Result<usize> {
            if !has_table(&conn, table)? {
                return Ok(0);
            }
            let filter = if table == "projects" {
                self.projects_filter(&conn)
            } else {
                ""
            };
            let n: i64 =
                conn.query_row(&format!("SELECT count(*) FROM {table}{filter}"), [], |r| {
                    r.get(0)
                })?;
            Ok(n as usize)
        };
        Ok(LocalHistoryStats {
            meetings: count("meetings")?,
            transcript_lines: count("transcripts")?,
            projects: count("projects")?,
        })
    }

    pub fn meeting_ids(&self) -> Result<Vec<i64>> {
        let Some(conn) = self.open()? else {
            return Ok(Vec::new());
        };
        if !has_table(&conn, "meetings")? {
            return Ok(Vec::new());
        }
        let mut stmt = conn.prepare("SELECT id FROM meetings ORDER BY id")?;
        let ids = stmt
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<i64>>>()?;
        Ok(ids)
    }

    pub fn projects(&self) -> Result<Vec<Value>> {
        let Some(conn) = self.open()? else {
            return Ok(Vec::new());
        };
        if !has_table(&conn, "projects")? {
            return Ok(Vec::new());
        }
        let mut stmt = conn.prepare(&format!(
            "SELECT project_id, name, code, description, created_at, archived_at FROM projects{}",
            self.projects_filter(&conn)
        ))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "local_id": r.get::<_, i64>(0)?,
                    "name": text(r, 1).unwrap_or_default(),
                    "code": text(r, 2).unwrap_or_default(),
                    "description": text(r, 3),
                    "created_at": time(r, 4),
                    "archived_at": time(r, 5),
                }))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Full payloads for the given meeting ids, children included.
    pub fn meetings(&self, ids: &[i64]) -> Result<Vec<Value>> {
        let Some(conn) = self.open()? else {
            return Ok(Vec::new());
        };
        let columns = table_columns(&conn, "meetings")?;
        let col = |name: &str| {
            if columns.iter().any(|c| c == name) {
                name.to_string()
            } else {
                format!("NULL AS {name}")
            }
        };
        let select = format!(
            "SELECT id, {}, {}, {}, {}, {}, {}, {}, {}, {}, {} FROM meetings WHERE id = ?1",
            col("start_time"),
            col("end_time"),
            col("summary"),
            col("context"),
            col("status"),
            col("provider"),
            col("project_id"),
            col("display_id"),
            col("role"),
            col("name"),
        );

        let mut out = Vec::with_capacity(ids.len());
        for &id in ids {
            let meeting = conn.query_row(&select, [id], |r| {
                Ok(json!({
                    "local_id": id,
                    "started_at": time(r, 1),
                    "ended_at": time(r, 2),
                    "summary": text(r, 3),
                    "context": text(r, 4),
                    "status": text(r, 5),
                    "provider": text(r, 6),
                    "project_local_id": r.get::<_, Option<i64>>(7).ok().flatten(),
                    "display_id": text(r, 8),
                    "role": text(r, 9),
                    "name": text(r, 10),
                }))
            });
            let mut meeting = match meeting {
                Ok(m) => m,
                Err(rusqlite::Error::QueryReturnedNoRows) => continue,
                Err(e) => return Err(e.into()),
            };

            meeting["transcripts"] = children(&conn, "transcripts", "SELECT speaker, text, timestamp FROM transcripts WHERE meeting_id = ?1 ORDER BY id", id, |r| {
                Ok(text(r, 1).map(|t| json!({ "speaker": text(r, 0), "text": t, "spoken_at": time(r, 2) })))
            })?;
            meeting["chunks"] = children(&conn, "chunks", "SELECT seq, speaker, text, significance, topic, created_at FROM chunks WHERE meeting_id = ?1 ORDER BY seq", id, |r| {
                let seq = r.get::<_, i64>(0)?;
                Ok(text(r, 2).map(|t| json!({
                    "seq": seq, "speaker": text(r, 1), "text": t,
                    "significance": text(r, 3), "topic": text(r, 4), "created_at": time(r, 5),
                })))
            })?;
            meeting["decisions"] = children(&conn, "decisions", "SELECT description, confidence, timestamp FROM decisions WHERE meeting_id = ?1 ORDER BY id", id, |r| {
                Ok(text(r, 0).map(|d| json!({ "description": d, "confidence": real(r, 1), "created_at": time(r, 2) })))
            })?;
            meeting["action_items"] = children(&conn, "action_items", "SELECT assignee, description, deadline, timestamp FROM action_items WHERE meeting_id = ?1 ORDER BY id", id, |r| {
                Ok(text(r, 1).map(|d| json!({ "assignee": text(r, 0), "description": d, "deadline": text(r, 2), "created_at": time(r, 3) })))
            })?;
            meeting["risks"] = children(&conn, "risks", "SELECT text, category, severity, created_at FROM risks WHERE meeting_id = ?1 ORDER BY id", id, |r| {
                Ok(text(r, 0).map(|t| json!({ "text": t, "category": text(r, 1), "severity": text(r, 2), "created_at": time(r, 3) })))
            })?;
            meeting["summaries"] = children(
                &conn,
                "summaries",
                "SELECT kind, text, created_at FROM summaries WHERE meeting_id = ?1 ORDER BY id",
                id,
                |r| {
                    Ok(text(r, 1).map(
                        |t| json!({ "kind": text(r, 0), "text": t, "created_at": time(r, 2) }),
                    ))
                },
            )?;
            meeting["glossary"] = children(
                &conn,
                "glossary_terms",
                "SELECT term, definition, first_seen FROM glossary_terms WHERE meeting_id = ?1",
                id,
                |r| {
                    Ok(text(r, 0).map(|t| json!({ "term": t, "definition": text(r, 1), "first_seen": time(r, 2) })))
                },
            )?;
            out.push(meeting);
        }
        Ok(out)
    }
}

fn has_table(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n > 0)
}

fn table_columns(conn: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let cols = stmt.query_map([], |r| r.get::<_, String>(1))?.collect();
    cols
}

/// Rows of one child table, skipping rows the mapper rejects (empty text).
fn children(
    conn: &Connection,
    table: &str,
    sql: &str,
    meeting_id: i64,
    map: impl Fn(&Row) -> rusqlite::Result<Option<Value>>,
) -> rusqlite::Result<Value> {
    if !has_table(conn, table)? {
        return Ok(Value::Array(Vec::new()));
    }
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([meeting_id], |r| map(r))?;
    let mut out = Vec::new();
    for row in rows {
        if let Some(v) = row? {
            out.push(v);
        }
    }
    Ok(Value::Array(out))
}

/// Any column as trimmed text; empty and NULL become `None`.
fn text(row: &Row, idx: usize) -> Option<String> {
    let s = match row.get_ref(idx).ok()? {
        ValueRef::Text(b) => String::from_utf8_lossy(b).into_owned(),
        ValueRef::Integer(i) => i.to_string(),
        ValueRef::Real(f) => f.to_string(),
        ValueRef::Null | ValueRef::Blob(_) => return None,
    };
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

fn real(row: &Row, idx: usize) -> Option<f64> {
    match row.get_ref(idx).ok()? {
        ValueRef::Real(f) => Some(f),
        ValueRef::Integer(i) => Some(i as f64),
        ValueRef::Text(b) => String::from_utf8_lossy(b).trim().parse().ok(),
        _ => None,
    }
}

fn time(row: &Row, idx: usize) -> Option<String> {
    match row.get_ref(idx).ok()? {
        ValueRef::Integer(i) => from_epoch(i),
        ValueRef::Real(f) => from_epoch(f as i64),
        ValueRef::Text(b) => parse_timestamp(&String::from_utf8_lossy(b)),
        _ => None,
    }
    .map(|t| t.to_rfc3339())
}

fn from_epoch(n: i64) -> Option<DateTime<Utc>> {
    // Values past year 2286 in seconds are milliseconds.
    if n > 10_000_000_000 {
        Utc.timestamp_millis_opt(n).single()
    } else {
        Utc.timestamp_opt(n, 0).single()
    }
}

/// SQLite's `CURRENT_TIMESTAMP` writes `YYYY-MM-DD HH:MM:SS` in UTC; JS code
/// paths write ISO 8601. Anything else is dropped rather than guessed.
pub(crate) fn parse_timestamp(raw: &str) -> Option<DateTime<Utc>> {
    let raw = raw.trim();
    if let Ok(t) = DateTime::parse_from_rfc3339(raw) {
        return Some(t.with_timezone(&Utc));
    }
    [
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M",
    ]
    .iter()
    .find_map(|f| NaiveDateTime::parse_from_str(raw, f).ok())
    .map(|n| Utc.from_utc_datetime(&n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_timestamp_formats_in_use() {
        assert_eq!(
            parse_timestamp("2026-09-24 13:00:43").unwrap().to_rfc3339(),
            "2026-09-24T13:00:43+00:00"
        );
        assert_eq!(
            parse_timestamp("2026-09-24T13:00:43.120Z")
                .unwrap()
                .timestamp(),
            1_790_254_843
        );
        assert!(parse_timestamp("yesterday").is_none());
    }

    fn fixture() -> (tempdir::Dir, LocalHistory) {
        let dir = tempdir::Dir::new();
        let path = dir.0.join("meeting_history.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (project_id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL, description TEXT, created_at TEXT, archived_at TEXT);
             CREATE TABLE meetings (id INTEGER PRIMARY KEY, start_time DATETIME, summary TEXT, status TEXT, project_id INTEGER, name TEXT);
             CREATE TABLE transcripts (id INTEGER PRIMARY KEY, meeting_id INTEGER, speaker TEXT, text TEXT, timestamp DATETIME);
             INSERT INTO projects VALUES (1, 'Unsorted', 'GEN', NULL, '2026-09-08 08:10:37', NULL);
             INSERT INTO meetings VALUES (7, '2026-09-24 13:00:43', 'Went well', 'ended', 1, 'Standup');
             INSERT INTO transcripts (meeting_id, speaker, text, timestamp) VALUES (7, 'A', 'Hello', '2026-09-24 13:01:00'), (7, 'B', '   ', NULL);",
        )
        .unwrap();
        (dir, LocalHistory::new(path))
    }

    #[test]
    fn exports_meetings_and_tolerates_missing_tables_and_columns() {
        let (_dir, history) = fixture();
        assert_eq!(
            history.stats().unwrap(),
            LocalHistoryStats {
                meetings: 1,
                transcript_lines: 2,
                projects: 1
            }
        );
        assert_eq!(history.meeting_ids().unwrap(), vec![7]);

        let meetings = history.meetings(&[7, 999]).unwrap();
        assert_eq!(meetings.len(), 1, "unknown ids are skipped");
        let m = &meetings[0];
        assert_eq!(m["name"], "Standup");
        assert_eq!(m["project_local_id"], 1);
        assert_eq!(m["started_at"], "2026-09-24T13:00:43+00:00");
        assert!(m["ended_at"].is_null(), "missing column reads as null");
        assert_eq!(
            m["transcripts"].as_array().unwrap().len(),
            1,
            "blank lines are dropped"
        );
        assert!(
            m["chunks"].as_array().unwrap().is_empty(),
            "missing table reads as empty"
        );

        assert_eq!(history.projects().unwrap()[0]["code"], "GEN");
    }

    struct Fixed(MeetingScope);
    impl CurrentAccount for Fixed {
        fn meeting_scope(&self) -> MeetingScope {
            self.0.clone()
        }
    }

    #[test]
    fn an_account_imports_only_its_own_meetings_and_their_projects() {
        let (dir, _) = fixture();
        let path = dir.0.join("meeting_history.db");
        let conn = Connection::open(&path).unwrap();
        crate::adapters::meeting_scope::ensure_meeting_owner(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO projects VALUES (2, 'Vendor reviews', 'VR', NULL, NULL, NULL);
             UPDATE meetings SET account_id = 'admin' WHERE id = 7;
             INSERT INTO meetings (id, start_time, status, project_id, name, account_id) VALUES (8, '2026-09-25 09:00:00', 'ended', 2, 'Other', 'someone-else');
             INSERT INTO transcripts (meeting_id, speaker, text) VALUES (8, 'C', 'not yours');",
        )
        .unwrap();

        let admin =
            LocalHistory::new(&path).scoped(Arc::new(Fixed(MeetingScope::Account("admin".into()))));
        assert_eq!(
            admin.stats().unwrap(),
            LocalHistoryStats {
                meetings: 1,
                transcript_lines: 2,
                projects: 1
            }
        );
        assert_eq!(admin.meeting_ids().unwrap(), vec![7]);
        assert!(
            admin.meetings(&[8]).unwrap().is_empty(),
            "another account's meeting cannot be exported by id"
        );
        let codes: Vec<_> = admin
            .projects()
            .unwrap()
            .iter()
            .map(|p| p["code"].clone())
            .collect();
        assert_eq!(codes, vec!["GEN"]);

        let newcomer = LocalHistory::new(&path)
            .scoped(Arc::new(Fixed(MeetingScope::Account("new-user".into()))));
        assert_eq!(newcomer.stats().unwrap(), LocalHistoryStats::default());
        assert!(newcomer.projects().unwrap().is_empty());
    }

    #[test]
    fn a_missing_database_is_empty_history() {
        let history = LocalHistory::new("/nonexistent/meeting_history.db");
        assert_eq!(history.stats().unwrap(), LocalHistoryStats::default());
        assert!(history.meeting_ids().unwrap().is_empty());
    }

    /// Minimal temp dir so tests do not need another dependency.
    mod tempdir {
        pub struct Dir(pub std::path::PathBuf);
        impl Dir {
            pub fn new() -> Self {
                let p = std::env::temp_dir()
                    .join(format!("roxi-local-history-{}", uuid::Uuid::new_v4()));
                std::fs::create_dir_all(&p).unwrap();
                Dir(p)
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }
}
