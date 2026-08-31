use crate::ports::audio_capture::AudioCapture;
use crate::ports::gateway::GatewayClient;
use crate::streaming::StreamingSink;
use anyhow::{anyhow, Result};
use std::sync::Arc;

pub struct CaptureUseCase {
    audio_capture: Arc<dyn AudioCapture>,
    gateway_client: Arc<dyn GatewayClient>,
}

impl CaptureUseCase {
    pub fn new(
        audio_capture: Arc<dyn AudioCapture>,
        gateway_client: Arc<dyn GatewayClient>,
    ) -> Self {
        Self {
            audio_capture,
            gateway_client,
        }
    }

    pub fn start(&self, context: Option<String>, role: Option<String>, on_event: Box<dyn Fn(String) + Send + 'static>) -> Result<()> {
        if self.gateway_client.is_running() {
            return Err(anyhow!("Capture session is already running"));
        }

        // 1. Start node sidecar
        let writer = self.gateway_client.start_session(context, role, on_event)?;

        // 2. Wrap it in a StreamingSink
        let sink = StreamingSink::new(writer);

        // 3. Start audio capture, pushing samples to sink
        self.audio_capture.start_capture(Box::new(sink))?;

        Ok(())
    }

    pub fn stop(&self) -> Result<()> {
        // Stop audio capture
        self.audio_capture.stop_capture()?;
        // Stop sidecar process
        self.gateway_client.stop_session()?;
        Ok(())
    }
}
