//! Import of desktop meeting history into the signed-in user's org.
//!
//! The desktop app reads its local SQLite database and sends it here in
//! batches. Each row keeps `(device_id, local_id)`, so sending the same batch
//! twice (a retry, or the user pressing Import again) skips what already
//! landed instead of duplicating it.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::accounts::ensure_account;
use crate::auth::AuthUser;
use crate::db::begin_scoped;
use crate::error::ApiError;
use crate::AppState;

/// Keeps one request inside the body limit and one transaction short.
pub const MAX_MEETINGS_PER_BATCH: usize = 25;

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub device_id: String,
    #[serde(default)]
    pub projects: Vec<ImportProject>,
    #[serde(default)]
    pub meetings: Vec<ImportMeeting>,
}

#[derive(Debug, Deserialize)]
pub struct ImportProject {
    pub local_id: i64,
    pub name: String,
    pub code: String,
    pub description: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub archived_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct ImportMeeting {
    pub local_id: i64,
    pub project_local_id: Option<i64>,
    pub name: Option<String>,
    pub display_id: Option<String>,
    pub role: Option<String>,
    pub context: Option<String>,
    pub summary: Option<String>,
    /// Desktop values: `ended` or `running`.
    pub status: Option<String>,
    pub provider: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub transcripts: Vec<ImportTranscript>,
    #[serde(default)]
    pub chunks: Vec<ImportChunk>,
    #[serde(default)]
    pub decisions: Vec<ImportDecision>,
    #[serde(default)]
    pub action_items: Vec<ImportActionItem>,
    #[serde(default)]
    pub risks: Vec<ImportRisk>,
    #[serde(default)]
    pub summaries: Vec<ImportSummary>,
    #[serde(default)]
    pub glossary: Vec<ImportGlossaryTerm>,
}

#[derive(Debug, Deserialize)]
pub struct ImportTranscript {
    pub speaker: Option<String>,
    pub text: String,
    pub spoken_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct ImportChunk {
    pub seq: i32,
    pub speaker: Option<String>,
    pub text: String,
    pub significance: Option<String>,
    pub topic: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct ImportDecision {
    pub description: String,
    pub confidence: Option<f32>,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct ImportActionItem {
    pub assignee: Option<String>,
    pub description: String,
    pub deadline: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct ImportRisk {
    pub text: String,
    pub category: Option<String>,
    pub severity: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct ImportSummary {
    pub kind: Option<String>,
    pub text: String,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct ImportGlossaryTerm {
    pub term: String,
    pub definition: Option<String>,
    pub first_seen: Option<DateTime<Utc>>,
}

#[derive(Debug, Default, Serialize)]
pub struct ImportResult {
    pub projects_imported: usize,
    pub meetings_imported: usize,
    pub meetings_skipped: usize,
}

pub async fn import_meetings(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Json(req): Json<ImportRequest>,
) -> Result<Json<ImportResult>, ApiError> {
    let device = req.device_id.trim();
    if device.is_empty() || device.len() > 100 {
        return Err(ApiError::BadRequest("device_id must be 1 to 100 characters.".into()));
    }
    if req.meetings.len() > MAX_MEETINGS_PER_BATCH {
        return Err(ApiError::BadRequest(format!(
            "Send at most {MAX_MEETINGS_PER_BATCH} meetings per request."
        )));
    }

    let account = ensure_account(&state.db, &claims).await?;
    if account.role != "owner" && account.role != "admin" {
        return Err(ApiError::Forbidden("Only workspace owners and admins can import meeting history."));
    }

    let mut tx = begin_scoped(&state.db, account.org_id).await?;
    let mut result = ImportResult::default();

    let mut project_ids: HashMap<i64, Uuid> = HashMap::new();
    for project in &req.projects {
        let (id, created) = upsert_project(&mut tx, account.org_id, device, project).await?;
        project_ids.insert(project.local_id, id);
        result.projects_imported += usize::from(created);
    }

    for meeting in &req.meetings {
        let project_id = match meeting.project_local_id {
            Some(local) => match project_ids.get(&local) {
                Some(id) => Some(*id),
                None => find_project(&mut tx, account.org_id, device, local).await?,
            },
            None => None,
        };
        if insert_meeting(&mut tx, account.org_id, account.user_id, device, project_id, meeting).await? {
            result.meetings_imported += 1;
        } else {
            result.meetings_skipped += 1;
        }
    }

    tx.commit().await?;
    tracing::info!(
        org_id = %account.org_id,
        imported = result.meetings_imported,
        skipped = result.meetings_skipped,
        "meeting history import batch"
    );
    Ok(Json(result))
}

async fn find_project(
    tx: &mut Transaction<'static, Postgres>,
    org_id: Uuid,
    device: &str,
    local_id: i64,
) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar("SELECT id FROM projects WHERE org_id = $1 AND source_device = $2 AND source_local_id = $3")
        .bind(org_id)
        .bind(device)
        .bind(local_id)
        .fetch_optional(&mut **tx)
        .await
}

/// Returns the project's cloud id and whether it was newly created.
///
/// A project with the same name already in the org is reused rather than
/// duplicated: "Unsorted" on two Macs is one project to the user.
async fn upsert_project(
    tx: &mut Transaction<'static, Postgres>,
    org_id: Uuid,
    device: &str,
    p: &ImportProject,
) -> Result<(Uuid, bool), ApiError> {
    if let Some(id) = find_project(tx, org_id, device, p.local_id).await? {
        return Ok((id, false));
    }
    let name = p.name.trim();
    if name.is_empty() {
        return Err(ApiError::BadRequest("A project has an empty name.".into()));
    }
    let same_name: Option<Uuid> = sqlx::query_scalar("SELECT id FROM projects WHERE org_id = $1 AND lower(name) = lower($2)")
        .bind(org_id)
        .bind(name)
        .fetch_optional(&mut **tx)
        .await?;
    if let Some(id) = same_name {
        return Ok((id, false));
    }

    let code_taken: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM projects WHERE org_id = $1 AND code = $2)")
        .bind(org_id)
        .bind(&p.code)
        .fetch_one(&mut **tx)
        .await?;
    let code = if code_taken { format!("{}-{}", p.code, p.local_id) } else { p.code.clone() };

    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO projects (org_id, name, code, description, created_at, archived_at, source_device, source_local_id)
         VALUES ($1, $2, $3, $4, coalesce($5, now()), $6, $7, $8)
         RETURNING id",
    )
    .bind(org_id)
    .bind(name)
    .bind(code)
    .bind(&p.description)
    .bind(p.created_at)
    .bind(p.archived_at)
    .bind(device)
    .bind(p.local_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok((id, true))
}

fn cloud_status(local: Option<&str>) -> &'static str {
    match local {
        Some("running") => "interrupted",
        Some("failed") => "failed",
        _ => "completed",
    }
}

/// Returns false when this meeting was already imported from this device.
async fn insert_meeting(
    tx: &mut Transaction<'static, Postgres>,
    org_id: Uuid,
    user_id: Uuid,
    device: &str,
    project_id: Option<Uuid>,
    m: &ImportMeeting,
) -> sqlx::Result<bool> {
    let meeting_id: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO meetings (org_id, user_id, project_id, title, display_id, role, context, summary, status,
                               stt_provider, started_at, ended_at, source_device, source_local_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, now()), $12, $13, $14)
         ON CONFLICT (org_id, source_device, source_local_id) DO NOTHING
         RETURNING id",
    )
    .bind(org_id)
    .bind(user_id)
    .bind(project_id)
    .bind(&m.name)
    .bind(&m.display_id)
    .bind(&m.role)
    .bind(&m.context)
    .bind(&m.summary)
    .bind(cloud_status(m.status.as_deref()))
    .bind(&m.provider)
    .bind(m.started_at)
    .bind(m.ended_at)
    .bind(device)
    .bind(m.local_id)
    .fetch_optional(&mut **tx)
    .await?;

    let Some(meeting_id) = meeting_id else { return Ok(false) };

    // One statement per child table, rows passed as parallel arrays.
    if !m.transcripts.is_empty() {
        let (speakers, texts, times): (Vec<_>, Vec<_>, Vec<_>) =
            unzip3(m.transcripts.iter().map(|t| (t.speaker.clone(), t.text.clone(), t.spoken_at)));
        sqlx::query(
            "INSERT INTO transcripts (org_id, meeting_id, speaker, text, spoken_at)
             SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::timestamptz[])",
        )
        .bind(org_id)
        .bind(meeting_id)
        .bind(speakers)
        .bind(texts)
        .bind(times)
        .execute(&mut **tx)
        .await?;
    }

    if !m.chunks.is_empty() {
        let mut seqs = Vec::new();
        let mut speakers = Vec::new();
        let mut texts = Vec::new();
        let mut significance = Vec::new();
        let mut topics = Vec::new();
        let mut times = Vec::new();
        for c in &m.chunks {
            seqs.push(c.seq);
            speakers.push(c.speaker.clone());
            texts.push(c.text.clone());
            significance.push(c.significance.clone());
            topics.push(c.topic.clone());
            times.push(c.created_at);
        }
        sqlx::query(
            "INSERT INTO chunks (org_id, meeting_id, seq, speaker, text, significance, topic, created_at)
             SELECT $1, $2, s, sp, tx, sg, tp, coalesce(ts, now())
               FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[])
                    AS u(s, sp, tx, sg, tp, ts)
             ON CONFLICT (meeting_id, seq) DO NOTHING",
        )
        .bind(org_id)
        .bind(meeting_id)
        .bind(seqs)
        .bind(speakers)
        .bind(texts)
        .bind(significance)
        .bind(topics)
        .bind(times)
        .execute(&mut **tx)
        .await?;
    }

    for d in &m.decisions {
        sqlx::query(
            "INSERT INTO decisions (org_id, meeting_id, description, confidence, created_at)
             VALUES ($1, $2, $3, $4, coalesce($5, now()))",
        )
        .bind(org_id)
        .bind(meeting_id)
        .bind(&d.description)
        .bind(d.confidence)
        .bind(d.created_at)
        .execute(&mut **tx)
        .await?;
    }

    for a in &m.action_items {
        sqlx::query(
            "INSERT INTO action_items (org_id, meeting_id, assignee, description, deadline, created_at)
             VALUES ($1, $2, $3, $4, $5, coalesce($6, now()))",
        )
        .bind(org_id)
        .bind(meeting_id)
        .bind(&a.assignee)
        .bind(&a.description)
        .bind(&a.deadline)
        .bind(a.created_at)
        .execute(&mut **tx)
        .await?;
    }

    for r in &m.risks {
        sqlx::query(
            "INSERT INTO risks (org_id, meeting_id, text, category, severity, created_at)
             VALUES ($1, $2, $3, $4, $5, coalesce($6, now()))",
        )
        .bind(org_id)
        .bind(meeting_id)
        .bind(&r.text)
        .bind(&r.category)
        .bind(&r.severity)
        .bind(r.created_at)
        .execute(&mut **tx)
        .await?;
    }

    for s in &m.summaries {
        sqlx::query(
            "INSERT INTO summaries (org_id, meeting_id, kind, text, created_at)
             VALUES ($1, $2, coalesce($3, 'executive'), $4, coalesce($5, now()))",
        )
        .bind(org_id)
        .bind(meeting_id)
        .bind(&s.kind)
        .bind(&s.text)
        .bind(s.created_at)
        .execute(&mut **tx)
        .await?;
    }

    for g in &m.glossary {
        sqlx::query(
            "INSERT INTO glossary_terms (org_id, meeting_id, term, definition, first_seen)
             VALUES ($1, $2, $3, $4, coalesce($5, now()))
             ON CONFLICT (meeting_id, term) DO NOTHING",
        )
        .bind(org_id)
        .bind(meeting_id)
        .bind(&g.term)
        .bind(&g.definition)
        .bind(g.first_seen)
        .execute(&mut **tx)
        .await?;
    }

    Ok(true)
}

fn unzip3<A, B, C>(iter: impl Iterator<Item = (A, B, C)>) -> (Vec<A>, Vec<B>, Vec<C>) {
    let mut a = Vec::new();
    let mut b = Vec::new();
    let mut c = Vec::new();
    for (x, y, z) in iter {
        a.push(x);
        b.push(y);
        c.push(z);
    }
    (a, b, c)
}

#[cfg(test)]
mod tests {
    use super::cloud_status;

    #[test]
    fn maps_desktop_statuses() {
        assert_eq!(cloud_status(Some("ended")), "completed");
        assert_eq!(cloud_status(Some("running")), "interrupted");
        assert_eq!(cloud_status(None), "completed");
    }
}
