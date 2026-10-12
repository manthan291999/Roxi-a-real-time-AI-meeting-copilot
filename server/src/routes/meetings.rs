use std::sync::Arc;

use axum::extract::{Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::accounts::ensure_account;
use crate::auth::AuthUser;
use crate::db::begin_scoped;
use crate::error::ApiError;
use crate::AppState;

#[derive(Deserialize)]
pub struct ListParams {
    limit: Option<i64>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct MeetingSummary {
    pub id: Uuid,
    pub title: Option<String>,
    pub display_id: Option<String>,
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub imported: bool,
    pub transcript_lines: i64,
}

#[derive(Serialize)]
pub struct MeetingList {
    pub total: i64,
    pub meetings: Vec<MeetingSummary>,
}

/// The org's meetings, newest first.
pub async fn list(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Query(params): Query<ListParams>,
) -> Result<Json<MeetingList>, ApiError> {
    let account = ensure_account(&state.db, &claims).await?;
    let limit = params.limit.unwrap_or(50).clamp(1, 200);

    let mut tx = begin_scoped(&state.db, account.org_id).await?;
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM meetings").fetch_one(&mut *tx).await?;
    let meetings = sqlx::query_as::<_, MeetingSummary>(
        "SELECT m.id, m.title, m.display_id, m.status, m.started_at, m.ended_at,
                m.source_device IS NOT NULL AS imported,
                (SELECT count(*) FROM transcripts t WHERE t.meeting_id = m.id) AS transcript_lines
           FROM meetings m
          ORDER BY m.started_at DESC
          LIMIT $1",
    )
    .bind(limit)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(MeetingList { total, meetings }))
}
