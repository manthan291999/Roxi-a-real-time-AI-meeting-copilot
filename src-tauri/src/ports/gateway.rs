use crate::domain::project::ProjectRef;
use anyhow::Result;
use std::io::Write;

/// What the gateway sidecar needs to open a meeting.
///
/// A struct rather than four positional `Option<String>` arguments: the call
/// site already read `start_session(ctx, role, cb)` ambiguously, and adding a
/// project to that would make two of the three arguments interchangeable
/// strings at every call and every fake.
#[derive(Clone, Debug, Default)]
pub struct SessionRequest {
    /// What the user said the meeting is about.
    pub context: Option<String>,
    /// Who the user is in the meeting, as a human label.
    pub role: Option<String>,
    /// The resolved project. The gateway assigns `project_seq` and `display_id`
    /// from this, inside the same transaction as the meeting insert.
    pub project: Option<ProjectRef>,
}

pub trait GatewayClient: Send + Sync {
    fn start_session(
        &self,
        request: SessionRequest,
        on_event: Box<dyn Fn(String) + Send + 'static>,
    ) -> Result<Box<dyn Write + Send>>;
    fn stop_session(&self) -> Result<()>;
    fn is_running(&self) -> bool;
}
