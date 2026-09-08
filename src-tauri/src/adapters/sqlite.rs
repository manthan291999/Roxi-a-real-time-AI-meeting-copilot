use crate::domain::meeting::{
    ActionItem, Decision, Meeting, MeetingDetails, SuggestedReply, TechnicalAnalysis, TranscriptLine,
};
use crate::ports::db::Database;
use anyhow::Result;
use rusqlite::Connection;
use std::time::Duration;

pub struct SqliteDatabase;

impl SqliteDatabase {
    pub fn new() -> Self {
        Self
    }

    fn open_db(&self) -> Result<Connection> {
        let conn = Connection::open(crate::adapters::db_paths::meeting_history_db())?;
        conn.busy_timeout(Duration::from_secs(5))?;
        Ok(conn)
    }
}

impl Database for SqliteDatabase {
    fn get_meetings(&self) -> Result<Vec<Meeting>> {
        let conn = self.open_db()?;
        let count: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='meetings'",
            [],
            |row| row.get(0),
        )?;

        if count == 0 {
            return Ok(Vec::new());
        }

        let mut stmt =
            conn.prepare("SELECT id, start_time, summary FROM meetings ORDER BY start_time DESC")?;
        let meeting_iter = stmt.query_map([], |row| {
            Ok(Meeting {
                id: row.get(0)?,
                start_time: row.get(1)?,
                end_time: None,
                context: None,
                summary: row.get(2)?,
            })
        })?;

        let mut meetings = Vec::new();
        for meeting in meeting_iter {
            meetings.push(meeting?);
        }

        Ok(meetings)
    }

    fn get_meeting_details(&self, meeting_id: i64) -> Result<MeetingDetails> {
        let conn = self.open_db()?;

        let meeting = conn.query_row(
            "SELECT id, start_time, summary FROM meetings WHERE id = ?1",
            [meeting_id],
            |row| {
                Ok(Meeting {
                    id: row.get(0)?,
                    start_time: row.get(1)?,
                    end_time: None,
                    context: None,
                    summary: row.get(2)?,
                })
            },
        )?;

        let mut stmt = conn.prepare("SELECT speaker, text, timestamp FROM transcripts WHERE meeting_id = ?1 ORDER BY timestamp ASC")?;
        let transcripts: Vec<TranscriptLine> = stmt
            .query_map([meeting_id], |row| {
                Ok(TranscriptLine {
                    speaker: row.get(0)?,
                    text: row.get(1)?,
                    start_time: 0.0,
                    end_time: 0.0,
                })
            })?
            .filter_map(Result::ok)
            .collect();

        let mut stmt = conn.prepare("SELECT description FROM decisions WHERE meeting_id = ?1 ORDER BY timestamp ASC")?;
        let decisions: Vec<Decision> = stmt
            .query_map([meeting_id], |row| {
                Ok(Decision {
                    description: row.get(0)?,
                })
            })?
            .filter_map(Result::ok)
            .collect();

        let mut stmt = conn.prepare("SELECT assignee, description FROM action_items WHERE meeting_id = ?1 ORDER BY timestamp ASC")?;
        let action_items: Vec<ActionItem> = stmt
            .query_map([meeting_id], |row| {
                Ok(ActionItem {
                    assignee: row.get(0)?,
                    description: row.get(1)?,
                })
            })?
            .filter_map(Result::ok)
            .collect();

        let mut stmt = conn.prepare("SELECT description FROM technical_analyses WHERE meeting_id = ?1 ORDER BY timestamp ASC")?;
        let technical_analyses: Vec<TechnicalAnalysis> = stmt
            .query_map([meeting_id], |row| {
                Ok(TechnicalAnalysis {
                    description: row.get(0)?,
                })
            })?
            .filter_map(Result::ok)
            .collect();

        let mut stmt = conn.prepare("SELECT text FROM suggested_replies WHERE meeting_id = ?1 ORDER BY timestamp ASC")?;
        let suggested_replies: Vec<SuggestedReply> = stmt
            .query_map([meeting_id], |row| {
                Ok(SuggestedReply {
                    text: row.get(0)?,
                })
            })?
            .filter_map(Result::ok)
            .collect();

        Ok(MeetingDetails {
            meeting,
            transcripts,
            decisions,
            action_items,
            technical_analyses,
            suggested_replies,
        })
    }
}
