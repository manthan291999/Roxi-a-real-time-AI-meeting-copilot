//! Ports for browser-based sign-in (Microsoft, Google, company SSO).
//!
//! Kept apart from `ports::auth` so password-only providers and their fakes
//! never have to implement any of this.

use async_trait::async_trait;

use crate::domain::account::{AuthError, AuthSession};
use crate::domain::federated::FederatedMethod;

/// The identity service's half of an authorization-code + PKCE sign-in.
#[async_trait]
pub trait FederatedAuthProvider: Send + Sync {
    /// Where to send the browser. `redirect_to` is where the identity service
    /// returns it, carrying `?code=…`.
    async fn authorization_url(
        &self,
        method: &FederatedMethod,
        redirect_to: &str,
        code_challenge: &str,
    ) -> Result<String, AuthError>;

    /// Trades the returned code for a session.
    async fn exchange_code(
        &self,
        auth_code: &str,
        code_verifier: &str,
    ) -> Result<AuthSession, AuthError>;
}

/// Opens a URL in the user's default browser.
pub trait BrowserLauncher: Send + Sync {
    fn open(&self, url: &str) -> Result<(), AuthError>;
}

/// What the identity service appended to the redirect.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RedirectParams {
    pub code: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

/// A one-time endpoint the browser is sent back to.
#[async_trait]
pub trait RedirectListener: Send + Sync {
    /// Starts listening. Only a request for exactly `path` completes it, so an
    /// unguessable path doubles as the OAuth `state` check.
    async fn listen(&self, path: &str) -> Result<Box<dyn PendingRedirect>, AuthError>;
}

#[async_trait]
pub trait PendingRedirect: Send {
    fn redirect_url(&self) -> &str;
    /// Resolves when the browser arrives. Dropping it stops listening.
    async fn wait(self: Box<Self>) -> Result<RedirectParams, AuthError>;
}
