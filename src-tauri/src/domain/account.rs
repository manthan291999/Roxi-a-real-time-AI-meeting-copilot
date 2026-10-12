//! Signed-in account state.
//!
//! `AuthSession` holds tokens and never crosses into the webview. The
//! frontend only ever sees `AccountState`, which has no secrets in it.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountUser {
    pub id: String,
    pub email: Option<String>,
    pub full_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: i64,
    pub user: AccountUser,
}

impl AuthSession {
    /// Refresh a minute early so a token never expires mid-request.
    pub fn needs_refresh(&self, now_unix: i64) -> bool {
        self.expires_at - now_unix < 60
    }
}

/// The workspace the cloud API resolved for this user.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub org_id: String,
    pub org_name: String,
    pub role: String,
    pub plan: String,
}

/// What the frontend renders. `configured == false` means this build has no
/// Supabase settings, so the app runs in local-only mode with no login.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountState {
    pub configured: bool,
    pub user: Option<AccountUser>,
    pub workspace: Option<Workspace>,
}

/// Why an auth action failed. `code` is stable for the UI to branch on;
/// `message` is ready to show as is.
#[derive(Debug, Clone, Serialize, PartialEq, thiserror::Error)]
#[error("{message}")]
pub struct AuthError {
    pub code: AuthErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthErrorCode {
    InvalidCredentials,
    EmailNotConfirmed,
    UserExists,
    WeakPassword,
    InvalidInput,
    RateLimited,
    Network,
    NotConfigured,
    SessionExpired,
    /// The user closed or abandoned a browser sign-in. Not shown as an error.
    Cancelled,
    Unknown,
}

impl AuthError {
    pub fn new(code: AuthErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn not_configured() -> Self {
        Self::new(
            AuthErrorCode::NotConfigured,
            "Sign-in is not set up in this build of Roxi.",
        )
    }

    pub fn session_expired() -> Self {
        Self::new(
            AuthErrorCode::SessionExpired,
            "Your session has ended. Sign in again.",
        )
    }

    pub fn cancelled() -> Self {
        Self::new(AuthErrorCode::Cancelled, "Sign-in was cancelled.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refreshes_a_minute_before_expiry() {
        let session = AuthSession {
            access_token: "a".into(),
            refresh_token: "r".into(),
            expires_at: 1_000,
            user: AccountUser {
                id: "u".into(),
                email: None,
                full_name: None,
            },
        };
        assert!(!session.needs_refresh(900));
        assert!(session.needs_refresh(941));
    }

    #[test]
    fn error_codes_serialize_for_the_frontend() {
        let json = serde_json::to_value(AuthError::new(AuthErrorCode::UserExists, "x")).unwrap();
        assert_eq!(json["code"], "user_exists");
    }
}
