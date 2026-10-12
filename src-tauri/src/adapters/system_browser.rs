//! Opens sign-in pages in the user's default browser.
//!
//! The system browser, not a webview: the user sees the real address bar and
//! their existing Microsoft / Google / SSO session, and Roxi never sees the
//! password they type there.

use std::process::Command;

use reqwest::Url;

use crate::domain::account::{AuthError, AuthErrorCode};
use crate::ports::federated_auth::BrowserLauncher;

pub struct SystemBrowser;

/// Only `https:` leaves the app, plus plain `http:` to a local Supabase
/// (`supabase start`) during development.
pub(crate) fn is_allowed_sign_in_url(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    match parsed.scheme() {
        "https" => true,
        "http" => matches!(parsed.host_str(), Some("localhost" | "127.0.0.1")),
        _ => false,
    }
}

impl BrowserLauncher for SystemBrowser {
    fn open(&self, url: &str) -> Result<(), AuthError> {
        if !is_allowed_sign_in_url(url) {
            tracing::warn!("[auth] refused to open a non-https sign-in URL");
            return Err(AuthError::new(
                AuthErrorCode::Unknown,
                "The sign-in page address looks wrong, so Roxi didn't open it.",
            ));
        }
        browser_command(url).spawn().map(|_| ()).map_err(|e| {
            tracing::warn!("[auth] could not open the browser: {e}");
            AuthError::new(
                AuthErrorCode::Unknown,
                "Couldn't open your browser. Check that a default browser is set, then try again.",
            )
        })
    }
}

#[cfg(target_os = "macos")]
fn browser_command(url: &str) -> Command {
    let mut cmd = Command::new("/usr/bin/open");
    cmd.arg(url);
    cmd
}

#[cfg(target_os = "windows")]
fn browser_command(url: &str) -> Command {
    let mut cmd = Command::new("rundll32");
    cmd.args(["url.dll,FileProtocolHandler", url]);
    cmd
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn browser_command(url: &str) -> Command {
    let mut cmd = Command::new("xdg-open");
    cmd.arg(url);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_https_and_local_development_only() {
        assert!(is_allowed_sign_in_url(
            "https://acme.supabase.co/auth/v1/authorize?provider=azure"
        ));
        assert!(is_allowed_sign_in_url(
            "http://127.0.0.1:54321/auth/v1/authorize"
        ));
        assert!(is_allowed_sign_in_url(
            "http://localhost:54321/auth/v1/authorize"
        ));
        assert!(!is_allowed_sign_in_url("http://evil.example/auth"));
        assert!(!is_allowed_sign_in_url("file:///etc/passwd"));
        assert!(!is_allowed_sign_in_url("javascript:alert(1)"));
        assert!(!is_allowed_sign_in_url("not a url"));
    }
}
