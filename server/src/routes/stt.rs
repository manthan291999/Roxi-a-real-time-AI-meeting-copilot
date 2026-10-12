//! Short-lived speech-to-text tokens.
//!
//! The desktop app streams audio straight to AssemblyAI so audio never passes
//! through this server. It authenticates that stream with a temporary token
//! minted here, so the real API key never leaves the server.

use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::accounts::ensure_account;
use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct SttToken {
    pub provider: &'static str,
    pub token: String,
    pub expires_in_seconds: u32,
    /// Where the app opens its WebSocket, passing `token` as a query param.
    pub websocket_url: String,
}

#[derive(Deserialize)]
struct AssemblyAiTokenResponse {
    token: String,
}

pub async fn create_token(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
) -> Result<Json<SttToken>, ApiError> {
    let api_key = state
        .config
        .assemblyai_api_key
        .as_deref()
        .ok_or(ApiError::ServiceUnavailable("Speech to text is not configured on this server."))?;

    // Resolving the account here (not just verifying the token) is where plan
    // limits will be enforced once billing lands.
    let account = ensure_account(&state.db, &claims).await?;

    let base = &state.config.assemblyai_streaming_base;
    let ttl = state.config.stt_token_ttl_secs;
    let response = state
        .http
        .get(format!("{base}/v3/token"))
        .query(&[("expires_in_seconds", ttl)])
        .header("Authorization", api_key)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| ApiError::Upstream(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(ApiError::Upstream(format!("assemblyai token request returned {status}: {body}")));
    }
    let AssemblyAiTokenResponse { token } =
        response.json().await.map_err(|e| ApiError::Upstream(e.to_string()))?;

    tracing::info!(org_id = %account.org_id, user_id = %account.user_id, ttl, "issued stt token");
    let ws_base = base.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    Ok(Json(SttToken {
        provider: "assemblyai",
        token,
        expires_in_seconds: ttl,
        websocket_url: format!("{ws_base}/v3/ws"),
    }))
}
