//! `CTL1` control frames written onto the gateway's stdin.
//!
//! Frame layout mirrors the audio protocol so one deframer handles both:
//!
//!   "CTL1" | u32 payload length (LE) | UTF-8 JSON
//!
//! The writer is shared with `StreamingSink`, which is on the audio hot path,
//! so the lock is held only for the duration of a single small write and never
//! across anything that can block for long.

use crate::ports::control::ControlSender;
use anyhow::{Context, Result};
use std::io::Write;
use std::sync::{Arc, Mutex};

const MAGIC: [u8; 4] = [0x43, 0x54, 0x4C, 0x31]; // "CTL1"

/// Writer shared between the audio sink and the control channel.
pub type SharedWriter = Arc<Mutex<Box<dyn Write + Send>>>;

pub struct PipeControlChannel {
    writer: SharedWriter,
}

impl PipeControlChannel {
    pub fn new(writer: SharedWriter) -> Self {
        Self { writer }
    }
}

impl ControlSender for PipeControlChannel {
    fn send(&self, command: &serde_json::Value) -> Result<()> {
        let payload = serde_json::to_vec(command).context("Failed to serialize control command")?;

        let mut header = [0u8; 8];
        header[..4].copy_from_slice(&MAGIC);
        header[4..8].copy_from_slice(&(payload.len() as u32).to_le_bytes());

        let mut guard = self
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("Control writer mutex poisoned"))?;
        guard
            .write_all(&header)
            .context("Failed to write control header")?;
        guard
            .write_all(&payload)
            .context("Failed to write control payload")?;
        guard.flush().context("Failed to flush control frame")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Captures what the channel writes, standing in for the sidecar's stdin.
    #[derive(Clone, Default)]
    struct Recorder(Arc<Mutex<Vec<u8>>>);

    impl Write for Recorder {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn channel() -> (PipeControlChannel, Arc<Mutex<Vec<u8>>>) {
        let recorder = Recorder::default();
        let sink = recorder.0.clone();
        let writer: SharedWriter = Arc::new(Mutex::new(Box::new(recorder)));
        (PipeControlChannel::new(writer), sink)
    }

    /// Mirrored by gateway/test/control-integration.test.js, "the exact byte
    /// layout the Rust side writes is accepted". If either side changes the
    /// header format, one of the two tests fails.
    #[test]
    fn frame_layout_is_stable() {
        let (ch, sink) = channel();
        ch.send(&json!({
            "command": "renameSpeaker",
            "sttLabel": "S",
            "displayName": "N",
        }))
        .unwrap();

        let bytes = sink.lock().unwrap().clone();
        assert_eq!(&bytes[..4], b"CTL1", "magic");

        let len = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        assert_eq!(len, 60, "fixture length pinned on both sides");
        assert_eq!(bytes.len(), 8 + len, "header + payload, nothing more");

        // serde_json orders keys alphabetically (its Map is a BTreeMap without
        // the preserve_order feature), so the fixture is in that order.
        let payload = std::str::from_utf8(&bytes[8..]).unwrap();
        assert_eq!(
            payload,
            r#"{"command":"renameSpeaker","displayName":"N","sttLabel":"S"}"#
        );
    }

    #[test]
    fn each_command_is_a_self_contained_frame() {
        let (ch, sink) = channel();
        ch.send(&json!({ "command": "a" })).unwrap();
        ch.send(&json!({ "command": "b" })).unwrap();

        let bytes = sink.lock().unwrap().clone();
        // Two frames back to back, each with its own header.
        assert_eq!(&bytes[..4], b"CTL1");
        let first_len = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        assert_eq!(&bytes[8 + first_len..12 + first_len], b"CTL1");
    }
}
