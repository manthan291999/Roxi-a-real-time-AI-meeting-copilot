use std::sync::Arc;

use axum::extract::State;
use axum::Json;

use crate::accounts::{ensure_account, Account};
use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::AppState;

/// The signed-in user and their org. The app calls this right after login.
pub async fn get(State(state): State<Arc<AppState>>, AuthUser(claims): AuthUser) -> Result<Json<Account>, ApiError> {
    Ok(Json(ensure_account(&state.db, &claims).await?))
}
