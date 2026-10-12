//! Selects the native audio backend at compile time.
//!
//! Keeping the selection behind the `AudioCapture` port prevents platform
//! APIs from leaking into application code and, importantly, lets Windows and
//! Linux builds compile before their native loopback implementations land.

use std::sync::Arc;

use crate::ports::audio_capture::AudioCapture;

#[cfg(target_os = "macos")]
pub fn create_audio_capture() -> Arc<dyn AudioCapture> {
    Arc::new(super::mac_audio::MacAudioCapture::new())
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
mod unsupported;

#[cfg(any(target_os = "windows", target_os = "linux"))]
pub fn create_audio_capture() -> Arc<dyn AudioCapture> {
    Arc::new(unsupported::UnsupportedAudioCapture::new())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
compile_error!("Roxi desktop supports macOS, Windows, and Linux only");
