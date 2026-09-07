use crate::adapters::control_channel::{PipeControlChannel, SharedWriter};
use crate::ports::audio_capture::AudioCapture;
use crate::ports::control::ControlSender;
use crate::ports::gateway::GatewayClient;
use crate::streaming::StreamingSink;
use anyhow::{anyhow, Result};
use std::sync::{Arc, Mutex};

pub struct CaptureUseCase {
    audio_capture: Arc<dyn AudioCapture>,
    gateway_client: Arc<dyn GatewayClient>,
    /// Live only while a session is running. The sidecar's stdin is shared
    /// between the audio sink and this channel, so control commands travel the
    /// same pipe as audio rather than needing a second transport.
    control: Mutex<Option<Arc<dyn ControlSender>>>,
}

impl CaptureUseCase {
    pub fn new(
        audio_capture: Arc<dyn AudioCapture>,
        gateway_client: Arc<dyn GatewayClient>,
    ) -> Self {
        Self {
            audio_capture,
            gateway_client,
            control: Mutex::new(None),
        }
    }

    pub fn start(&self, context: Option<String>, role: Option<String>, on_event: Box<dyn Fn(String) + Send + 'static>) -> Result<()> {
        if self.gateway_client.is_running() {
            return Err(anyhow!("Capture session is already running"));
        }

        // 1. Start node sidecar
        let writer = self.gateway_client.start_session(context, role, on_event)?;

        // 2. Share the pipe between the audio sink and the control channel
        let shared: SharedWriter = Arc::new(Mutex::new(writer));
        let control: Arc<dyn ControlSender> = Arc::new(PipeControlChannel::new(shared.clone()));
        *self
            .control
            .lock()
            .map_err(|_| anyhow!("Control channel mutex poisoned"))? = Some(control);

        // 3. Wrap it in a StreamingSink
        let sink = StreamingSink::new(shared);

        // 4. Start audio capture, pushing samples to sink
        self.audio_capture.start_capture(Box::new(sink))?;

        Ok(())
    }

    pub fn stop(&self) -> Result<()> {
        // Drop the control channel first: the sidecar is about to exit, and a
        // command written into a closing pipe is a guaranteed broken-pipe error.
        if let Ok(mut guard) = self.control.lock() {
            *guard = None;
        }
        // Stop audio capture
        self.audio_capture.stop_capture()?;
        // Stop sidecar process
        self.gateway_client.stop_session()?;
        Ok(())
    }

    /// The live control channel, or None when no session is running.
    pub fn control(&self) -> Option<Arc<dyn ControlSender>> {
        self.control.lock().ok().and_then(|g| g.clone())
    }

    /// Send a control command, ignoring the case where no session is running.
    /// Never propagates a failure: control traffic is best-effort enrichment and
    /// must not disturb capture.
    pub fn send_control(&self, command: &serde_json::Value) {
        let Some(channel) = self.control() else { return };
        if let Err(err) = channel.send(command) {
            tracing::warn!("[control] failed to send command: {}", err);
        }
    }
}
