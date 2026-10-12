//! Roxi cloud API.
//!
//! Phase 1 surface: account bootstrap (`/v1/me`), STT token issuing
//! (`/v1/stt/token`), and meeting history (`/v1/meetings`,
//! `/v1/import/meetings`). The desktop app signs in with Supabase, sends the access
//! token as a Bearer header, and never holds a provider API key.

pub mod accounts;
pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod routes;

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;
use sqlx::PgPool;
use tower_http::trace::TraceLayer;

use auth::TokenVerifier;
use config::Config;

pub struct AppState {
    pub config: Config,
    pub db: PgPool,
    pub http: reqwest::Client,
    pub verifier: TokenVerifier,
}

impl AppState {
    pub fn new(config: Config, db: PgPool) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("roxi-server/", env!("CARGO_PKG_VERSION")))
            .build()?;
        let verifier = TokenVerifier::new(&config.supabase_url, config.supabase_jwt_secret.as_deref(), http.clone());
        Ok(Self { config, db, http, verifier })
    }
}

/// No CORS layer: the only client is the desktop app, whose requests go
/// through Rust (reqwest), not the webview, so browsers never call this API.
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(routes::health::live))
        .route("/health/ready", get(routes::health::ready))
        // Where Supabase's confirmation emails land (no auth: it is a static page).
        .route("/auth/confirmed", get(routes::auth_pages::email_confirmed))
        .route("/v1/me", get(routes::me::get))
        .route("/v1/stt/token", post(routes::stt::create_token))
        .route("/v1/meetings", get(routes::meetings::list))
        // A batch of 25 long meetings with transcripts can pass axum's 2 MB default.
        .route(
            "/v1/import/meetings",
            post(routes::import::import_meetings).layer(DefaultBodyLimit::max(16 * 1024 * 1024)),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
