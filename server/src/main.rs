use std::sync::Arc;

use anyhow::Context;
use roxi_server::config::Config;
use roxi_server::{db, router, AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Searches the working directory and its parents, so running from
    // `server/` picks up the one repo-root `.env`. On Render there is no file
    // and the service environment is used as is.
    let _ = dotenvy::dotenv();

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=info"));
    if std::env::var("LOG_FORMAT").as_deref() == Ok("json") {
        tracing_subscriber::fmt().json().with_env_filter(filter).init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }

    let config = Config::from_env()?;
    let pool = db::pool(&config.database_url)?;
    db::MIGRATOR.run(&pool).await.context("running database migrations")?;

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], config.port));
    let state = Arc::new(AppState::new(config, pool)?);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "roxi-server listening");

    axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}
