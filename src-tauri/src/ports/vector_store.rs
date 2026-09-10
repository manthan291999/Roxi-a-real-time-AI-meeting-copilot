//! Vector-store lifecycle port — Qdrant, spawned by Rust, talked to by the
//! chatbot sidecar directly over HTTP (`QDRANT_URL`) once it is up.
//!
//! Rust's only responsibility is process supervision and one-time collection
//! bootstrap, mirroring `GatewayClient`: that port also just supervises a
//! child process rather than proxying its protocol. No search/upsert methods
//! live here — per the Meeting Semantic Memory plan's architecture, the
//! chatbot's `EpisodicSyncService`/`SemanticSyncService`/evidence sources are
//! the only consumers that ever talk vectors to Qdrant. Adding that surface
//! to this port would duplicate a client for a caller that does not exist on
//! the Rust side.

use anyhow::Result;

#[async_trait::async_trait]
pub trait VectorStore: Send + Sync {
    /// Idempotent: spawn the sidecar if it is not already running, wait for
    /// it to become healthy, and ensure every collection this app needs
    /// exists with its payload indexes. Safe to call more than once — a
    /// second call while already running is a no-op that returns `Ok`.
    async fn start(&self) -> Result<()>;

    /// Graceful shutdown: SIGTERM, wait, then force-kill. Safe to call when
    /// not running.
    fn stop(&self) -> Result<()>;

    fn is_running(&self) -> bool;
}
