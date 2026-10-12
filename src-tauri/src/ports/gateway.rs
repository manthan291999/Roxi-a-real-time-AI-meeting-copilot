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
    /// The meeting's human-chosen name, always collected by the intake modal.
    pub name: Option<String>,
    /// What the user said the meeting is about.
    pub context: Option<String>,
    /// Who the user is in the meeting, as a human label.
    pub role: Option<String>,
    /// The resolved project. The gateway assigns `project_seq` and `display_id`
    /// from this, inside the same transaction as the meeting insert.
    pub project: Option<ProjectRef>,
    /// The signed-in account that owns the meeting. `None` in local-only
    /// mode, where meetings belong to no account and all are visible.
    pub account_id: Option<String>,
    /// Short-lived Supabase access token inherited by the gateway process and
    /// exchanged with the Roxi API for an STT provider token. It is never put
    /// on the command line, where process-list tools could expose it.
    pub access_token: Option<String>,
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
