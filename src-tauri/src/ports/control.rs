//! Outbound control channel to the gateway sidecar.
//!
//! The audio pipe carries `PCM1` frames one way. This port adds the reverse
//! direction over the same pipe as `CTL1` frames, so the host can ask the
//! gateway to do things — persist an analyzed chunk, rename a speaker.
//!
//! Persistence goes through here rather than being written directly by this
//! process because the gateway owns `meeting_history.db` (Rust and the chatbot
//! read it, the latter read-only, to avoid WAL write contention) and because
//! only the gateway knows the current meeting id.

use anyhow::Result;

pub trait ControlSender: Send + Sync {
    /// Send one command. Fire-and-forget: failures are reported but never
    /// propagate into the audio path.
    fn send(&self, command: &serde_json::Value) -> Result<()>;
}
