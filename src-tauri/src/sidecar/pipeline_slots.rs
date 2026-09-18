//! Concurrency policy for the per-chunk agent pipeline, extracted out of
//! `event_router.rs` so that file is a pure event→emit dispatcher and this
//! one owns admission control. Two independent lanes, two independent
//! semaphores — see each one's doc comment for why they behave differently.

use std::sync::{Arc, OnceLock};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Caps concurrent LLM pipeline work at 3, which is ~15-24s of LLM budget in
/// parallel — enough for real-time meetings without saturating the OpenAI rate
/// limit.
///
/// The permit is acquired INSIDE the spawned task, not before it. That is
/// deliberate: `route_sidecar_event` runs on the gateway's stdout reader thread
/// (adapters/gateway_client.rs), and blocking there would stall
/// transcript_partial delivery and visibly freeze the live caption UI.
/// Concurrent API calls are therefore capped, but the task queue itself is
/// unbounded. Accepted: one speaker produces a final turn every ~3-8s and three
/// pipelines drain at ~5-8s each, so the queue does not grow in practice.
static PIPELINE_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();

fn pipeline_semaphore() -> Arc<Semaphore> {
    PIPELINE_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(3)))
        .clone()
}

/// Separate budget for the detached slow lane (risk / analyst). These run off the
/// reply path, so they must not hold a reply-path permit — but they still call the
/// API and still need a ceiling.
///
/// Unlike the reply path this lane SHEDS rather than queues: risks and decisions are
/// ambient enrichments, and a stale one arriving two minutes late is worth less than
/// not spending the call. `try_acquire_owned` drops the work when the lane is full.
static DETACHED_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();

fn detached_semaphore() -> Arc<Semaphore> {
    DETACHED_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(4)))
        .clone()
}

/// Waits for a reply-path pipeline slot (queues if all 3 are busy). Returns
/// `None` only if the semaphore has been closed — nothing in this codebase
/// ever calls `close()`, so in practice this is unreachable, but the caller
/// still has to decide what "closed" means and it isn't this module's call.
pub async fn acquire_reply_slot() -> Option<OwnedSemaphorePermit> {
    pipeline_semaphore().acquire_owned().await.ok()
}

/// Tries to take a detached-lane slot without waiting. Returns `None` when
/// the lane is full, which the caller should treat as "shed this work," not
/// "retry" — see `DETACHED_SEMAPHORE`'s doc comment for why queuing here
/// would be the wrong policy.
pub fn try_acquire_detached_slot() -> Option<OwnedSemaphorePermit> {
    detached_semaphore().try_acquire_owned().ok()
}
