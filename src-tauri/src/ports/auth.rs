//! Ports for sign-in: the identity provider, where the session is kept, and
//! the Roxi cloud API.

use async_trait::async_trait;

use crate::domain::account::{AuthError, AuthSession, Workspace};

pub enum SignUpOutcome {
    /// Email confirmation is off for the project: the user is signed in.
    SignedIn(AuthSession),
    /// A confirmation email was sent. Supabase also answers this way for an
    /// email that already has an account, so the UI must not claim either.
    ConfirmEmail,
}

#[async_trait]
pub trait AuthProvider: Send + Sync {
    async fn sign_up(
        &self,
        email: &str,
        password: &str,
        full_name: Option<&str>,
    ) -> Result<SignUpOutcome, AuthError>;
    async fn sign_in(&self, email: &str, password: &str) -> Result<AuthSession, AuthError>;
    async fn refresh(&self, refresh_token: &str) -> Result<AuthSession, AuthError>;
    async fn sign_out(&self, access_token: &str) -> Result<(), AuthError>;
    async fn send_password_reset(&self, email: &str) -> Result<(), AuthError>;
    async fn resend_confirmation(&self, email: &str) -> Result<(), AuthError>;
}

/// Durable, secret storage for the session (the macOS Keychain in production).
pub trait SessionStore: Send + Sync {
    fn load(&self) -> anyhow::Result<Option<AuthSession>>;
    fn save(&self, session: &AuthSession) -> anyhow::Result<()>;
    fn clear(&self) -> anyhow::Result<()>;
    /// A stable id for this install, created on first use. Tags imported rows
    /// so a repeated import is recognised and skipped.
    fn device_id(&self) -> anyhow::Result<String>;
}

#[async_trait]
pub trait CloudApi: Send + Sync {
    async fn workspace(&self, access_token: &str) -> anyhow::Result<Workspace>;
    /// Posts one import batch; returns the server's JSON result as is.
    async fn import_batch(
        &self,
        access_token: &str,
        batch: &serde_json::Value,
    ) -> anyhow::Result<ImportBatchResult>;
}

#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
pub struct ImportBatchResult {
    pub projects_imported: usize,
    pub meetings_imported: usize,
    pub meetings_skipped: usize,
}
