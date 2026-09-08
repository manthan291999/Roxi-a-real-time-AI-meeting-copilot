use crate::adapters::control_channel::{PipeControlChannel, SharedWriter};
use crate::application::brief_usecase::{BriefUseCase, CaptureContext};
use crate::application::session_registry::SessionRegistry;
use crate::domain::project::{ProjectRef, ProjectSelection};
use crate::domain::session::SessionId;
use crate::ports::audio_capture::AudioCapture;
use crate::ports::control::ControlSender;
use crate::ports::gateway::{GatewayClient, SessionRequest};
use crate::ports::project_repository::ProjectRepository;
use crate::streaming::StreamingSink;
use anyhow::{anyhow, Result};
use std::sync::{Arc, Mutex};

pub struct CaptureUseCase {
    audio_capture: Arc<dyn AudioCapture>,
    gateway_client: Arc<dyn GatewayClient>,
    projects: Arc<dyn ProjectRepository>,
    briefs: Arc<BriefUseCase>,
    sessions: Arc<SessionRegistry>,
    /// Live only while a session is running. The sidecar's stdin is shared
    /// between the audio sink and this channel, so control commands travel the
    /// same pipe as audio rather than needing a second transport.
    control: Mutex<Option<Arc<dyn ControlSender>>>,
}

impl CaptureUseCase {
    pub fn new(
        audio_capture: Arc<dyn AudioCapture>,
        gateway_client: Arc<dyn GatewayClient>,
        projects: Arc<dyn ProjectRepository>,
        briefs: Arc<BriefUseCase>,
        sessions: Arc<SessionRegistry>,
    ) -> Self {
        Self {
            audio_capture,
            gateway_client,
            projects,
            briefs,
            sessions,
            control: Mutex::new(None),
        }
    }

    /// Start a capture.
    ///
    /// Ordering is load-bearing:
    ///   1. Resolve the project — the gateway needs a real id to write into
    ///      `meetings.project_id` from the insert, not after it.
    ///   2. Compile the briefs — so they are warm before the first transcript
    ///      arrives, and so a gathering failure is visible at the moment the
    ///      user pressed Start rather than as vaguer answers ten minutes in.
    ///   3. Spawn the sidecar, then start the audio.
    ///
    /// Async because step 2 makes one embedding call. It runs before the
    /// sidecar exists, so it delays the start of capture by that call — a few
    /// hundred milliseconds, once, against a meeting.
    pub async fn start(
        &self,
        selection: ProjectSelection,
        context: Option<String>,
        role: Option<String>,
        doc_ids: Option<Vec<String>>,
        on_event: Box<dyn Fn(String) + Send + 'static>,
    ) -> Result<SessionId> {
        if self.gateway_client.is_running() {
            return Err(anyhow!("Capture session is already running"));
        }

        // 1. Resolve the project. Never fatal: `resolve` falls back to the
        //    Unsorted bucket, and even a total failure only costs grounding.
        let project: Option<ProjectRef> = match self.projects.resolve(&selection) {
            Ok(project) => {
                tracing::info!(
                    project = %project.id,
                    code = %project.code,
                    "[capture] filing this meeting under '{}'",
                    project.name
                );
                Some(project)
            }
            Err(e) => {
                tracing::error!("[capture] project resolution failed, continuing unscoped: {e:#}");
                None
            }
        };

        // 2. Mint the session identity and compile the briefs against it.
        let session = self.sessions.open(project.clone());
        self.briefs
            .build_for_capture(
                session,
                project.as_ref(),
                &CaptureContext {
                    context_text: context.clone(),
                    role: role.clone(),
                    doc_ids,
                },
            )
            .await;

        // 3. Start the node sidecar.
        let writer = match self.gateway_client.start_session(
            SessionRequest {
                context,
                role,
                project,
            },
            on_event,
        ) {
            Ok(writer) => writer,
            Err(e) => {
                // The session was opened above; leaving it open would leak its
                // briefs and make the next capture look already-running.
                self.end_session();
                return Err(e);
            }
        };

        // 4. Share the pipe between the audio sink and the control channel
        let shared: SharedWriter = Arc::new(Mutex::new(writer));
        let control: Arc<dyn ControlSender> = Arc::new(PipeControlChannel::new(shared.clone()));
        *self
            .control
            .lock()
            .map_err(|_| anyhow!("Control channel mutex poisoned"))? = Some(control);

        // 5. Wrap it in a StreamingSink
        let sink = StreamingSink::new(shared);

        // 6. Start audio capture, pushing samples to sink
        if let Err(e) = self.audio_capture.start_capture(Box::new(sink)) {
            // Audio is the last thing to start and the most likely to fail (no
            // BlackHole, device in use). Unwind the sidecar and the session so a
            // failed start leaves nothing running.
            let _ = self.gateway_client.stop_session();
            self.end_session();
            return Err(e);
        }

        Ok(session)
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
        // Release the session and its briefs. Last, so a failure above cannot
        // leave the pipeline running against briefs that have been freed.
        self.end_session();
        Ok(())
    }

    /// Close the session and release its briefs. Idempotent.
    fn end_session(&self) {
        if let Some(session) = self.sessions.close() {
            self.briefs.release(session);
            tracing::info!(session = %session, "[capture] session closed, briefs released");
        }
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
