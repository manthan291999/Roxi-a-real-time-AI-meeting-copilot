use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{bail, Result};

use crate::ports::audio_capture::{AudioCapture, PcmSink};

/// Compile-safe boundary for platforms whose native loopback backend is not
/// implemented yet. It deliberately returns an actionable error instead of
/// pretending capture started and leaving the UI waiting forever.
pub struct UnsupportedAudioCapture {
    running: AtomicBool,
}

impl UnsupportedAudioCapture {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
        }
    }
}

impl AudioCapture for UnsupportedAudioCapture {
    fn start_capture(
        &self,
        _sink: Box<dyn PcmSink>,
        _on_failure: Box<dyn Fn(String) + Send + Sync + 'static>,
    ) -> Result<()> {
        self.running.store(false, Ordering::SeqCst);
        bail!(
            "System-audio capture is not available in this Roxi build for {} yet",
            std::env::consts::OS
        )
    }

    fn stop_capture(&self) -> Result<()> {
        self.running.store(false, Ordering::SeqCst);
        Ok(())
    }
}
