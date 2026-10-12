//! One error type for every handler, rendered as `{"error":{"code","message"}}`.
//!
//! Internal details are logged, never returned: a client sees a stable code
//! and a message it can show, not a SQL error or a provider's response body.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("sign in required")]
    Unauthorized,
    #[error("{0}")]
    Forbidden(&'static str),
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    ServiceUnavailable(&'static str),
    #[error("upstream provider failed: {0}")]
    Upstream(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::Internal(e.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized", self.to_string()),
            ApiError::Forbidden(msg) => (StatusCode::FORBIDDEN, "forbidden", msg.to_string()),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg.clone()),
            ApiError::ServiceUnavailable(msg) => (StatusCode::SERVICE_UNAVAILABLE, "unavailable", msg.to_string()),
            ApiError::Upstream(detail) => {
                tracing::warn!(detail = %detail, "upstream provider error");
                (StatusCode::BAD_GATEWAY, "upstream_error", "The speech provider did not respond. Try again.".into())
            }
            ApiError::Internal(err) => {
                tracing::error!(error = ?err, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal", "Something went wrong on our side.".into())
            }
        };
        (status, Json(json!({ "error": { "code": code, "message": message } }))).into_response()
    }
}
