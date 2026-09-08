//! `BriefSource` over `meeting_history.db` — read-only.
//!
//! Every query is project-scoped through `meetings.project_id`, and every one of
//! them carries a deterministic `ORDER BY`: the order these rows come back in is
//! part of the frozen prefix, so "whatever SQLite felt like" would change the
//! prefix between runs and silently cost the cache.
//!
//! On a database the gateway has not yet migrated to M008 there is no
//! `project_id` column and therefore no project-scoped history. Every method
//! then returns empty rather than failing: a brief with a role contract and the
//! user's own context is still worth having, and the first capture applies the
//! migration.

use crate::adapters::db_paths;
use crate::adapters::sqlite_schema::{has_table, meetings_are_project_scoped};
use crate::agents::brief::model::{GlossaryTerm, MeetingDigest, OpenItem, OpenItemKind, Participant};
use crate::domain::project::ProjectId;
use crate::ports::brief_source::BriefSource;
use anyhow::Result;
use rusqlite::Connection;
use std::time::Duration;

/// Decisions quoted per prior meeting. The digest is a reminder, not a record —
/// the full history is a query away in Ask Roxi.
const DECISIONS_PER_DIGEST: usize = 3;

pub struct SqliteBriefSource;

impl SqliteBriefSource {
    pub fn new() -> Self {
        Self
    }

    fn open(&self) -> Result<Connection> {
        let conn = Connection::open(db_paths::meeting_history_db())?;
        conn.busy_timeout(Duration::from_secs(5))?;
        Ok(conn)
    }

    /// A connection only when project scoping is actually available.
    fn open_scoped(&self) -> Result<Option<Connection>> {
        let conn = self.open()?;
        if !meetings_are_project_scoped(&conn) {
            tracing::debug!(
                "[brief_source] meeting_history.db is not project-scoped yet — no prior context"
            );
            return Ok(None);
        }
        Ok(Some(conn))
    }
}

impl BriefSource for SqliteBriefSource {
    fn glossary_for_project(&self, project: ProjectId, limit: usize) -> Result<Vec<GlossaryTerm>> {
        let Some(conn) = self.open_scoped()? else {
            return Ok(Vec::new());
        };
        if !has_table(&conn, "glossary_terms") {
            return Ok(Vec::new());
        }

        // Newest-first so the `limit` keeps the terms this project is currently
        // using; the compiler re-sorts alphabetically for the prefix.
        let mut stmt = conn.prepare(
            "SELECT g.term, g.definition
             FROM glossary_terms g
             JOIN meetings m ON m.id = g.meeting_id
             WHERE m.project_id = ?1
               AND g.definition IS NOT NULL AND TRIM(g.definition) <> ''
             GROUP BY g.term
             ORDER BY MAX(g.first_seen) DESC, g.term ASC
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(rusqlite::params![project.value(), limit as i64], |row| {
            Ok(GlossaryTerm {
                term: row.get(0)?,
                definition: row.get(1)?,
            })
        })?;

        Ok(rows.filter_map(Result::ok).collect())
    }

    fn roster_for_project(&self, project: ProjectId) -> Result<Vec<Participant>> {
        let Some(conn) = self.open_scoped()? else {
            return Ok(Vec::new());
        };
        if !has_table(&conn, "speaker_profiles") {
            return Ok(Vec::new());
        }

        // Speakers still carrying a raw STT label ("Speaker A") are dropped:
        // they name nobody, and a roster of placeholders spends prefix budget
        // teaching the model that it does not know who is in the room.
        let mut stmt = conn.prepare(
            "SELECT s.speaker, SUM(s.chunk_count) AS turns
             FROM speaker_profiles s
             JOIN meetings m ON m.id = s.meeting_id
             WHERE m.project_id = ?1
               AND s.speaker IS NOT NULL
               AND TRIM(s.speaker) <> ''
               AND s.speaker NOT LIKE 'Speaker %'
             GROUP BY s.speaker
             ORDER BY turns DESC, s.speaker ASC",
        )?;

        let rows = stmt.query_map([project.value()], |row| {
            Ok(Participant {
                name: row.get(0)?,
                // No role is recorded anywhere in the schema today. Left absent
                // rather than guessed from topics — the compiler renders
                // "participant", which is true, where a guess would not be.
                role: None,
            })
        })?;

        Ok(rows.filter_map(Result::ok).collect())
    }

    fn recent_digests(&self, project: ProjectId, limit: usize) -> Result<Vec<MeetingDigest>> {
        let Some(conn) = self.open_scoped()? else {
            return Ok(Vec::new());
        };

        let mut stmt = conn.prepare(
            "SELECT m.id,
                    COALESCE(m.display_id, 'MEETING-' || m.id) AS display_id,
                    DATE(m.start_time)                          AS day,
                    COALESCE(
                      (SELECT s.text FROM summaries s
                        WHERE s.meeting_id = m.id AND s.kind = 'executive'
                        ORDER BY s.created_at DESC LIMIT 1),
                      m.summary
                    ) AS summary
             FROM meetings m
             WHERE m.project_id = ?1
             ORDER BY m.start_time DESC, m.id DESC
             LIMIT ?2",
        )?;

        let partial: Vec<(i64, MeetingDigest)> = stmt
            .query_map(rusqlite::params![project.value(), limit as i64], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    MeetingDigest {
                        display_id: row.get(1)?,
                        date: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        summary: row.get(3)?,
                        decisions: Vec::new(),
                    },
                ))
            })?
            .filter_map(Result::ok)
            .collect();

        // Decisions in a second pass rather than a group_concat: the text can
        // contain any separator, so joining in SQL would make the split
        // ambiguous.
        let mut decisions_stmt = conn.prepare(
            "SELECT description FROM decisions
             WHERE meeting_id = ?1 AND description IS NOT NULL AND TRIM(description) <> ''
             ORDER BY timestamp DESC, id DESC
             LIMIT ?2",
        )?;

        let mut digests = Vec::with_capacity(partial.len());
        for (meeting_id, mut digest) in partial {
            let rows = decisions_stmt.query_map(
                rusqlite::params![meeting_id, DECISIONS_PER_DIGEST as i64],
                |row| row.get::<_, String>(0),
            )?;
            digest.decisions = rows.filter_map(Result::ok).collect();
            digests.push(digest);
        }

        Ok(digests)
    }

    fn open_items(&self, project: ProjectId, limit: usize) -> Result<Vec<OpenItem>> {
        let Some(conn) = self.open_scoped()? else {
            return Ok(Vec::new());
        };

        let mut items = Vec::new();

        // NOTE: neither table has a resolution column, so "open" currently
        // means "recent, and nothing in the schema says otherwise". When a
        // `resolved_at` lands, this is the one place that has to learn about it.
        if has_table(&conn, "action_items") {
            let mut stmt = conn.prepare(
                "SELECT a.description, a.assignee
                 FROM action_items a
                 JOIN meetings m ON m.id = a.meeting_id
                 WHERE m.project_id = ?1
                   AND a.description IS NOT NULL AND TRIM(a.description) <> ''
                 ORDER BY a.timestamp DESC, a.id DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(rusqlite::params![project.value(), limit as i64], |row| {
                Ok(OpenItem {
                    kind: OpenItemKind::Action,
                    text: row.get(0)?,
                    owner: row.get(1)?,
                })
            })?;
            items.extend(rows.filter_map(Result::ok));
        }

        if has_table(&conn, "risks") {
            let mut stmt = conn.prepare(
                "SELECT r.text, r.severity
                 FROM risks r
                 JOIN meetings m ON m.id = r.meeting_id
                 WHERE m.project_id = ?1
                   AND r.text IS NOT NULL AND TRIM(r.text) <> ''
                 ORDER BY r.created_at DESC, r.id DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(rusqlite::params![project.value(), limit as i64], |row| {
                Ok(OpenItem {
                    kind: OpenItemKind::Risk,
                    text: row.get(0)?,
                    owner: row.get::<_, Option<String>>(1)?,
                })
            })?;
            items.extend(rows.filter_map(Result::ok));
        }

        Ok(items)
    }
}
