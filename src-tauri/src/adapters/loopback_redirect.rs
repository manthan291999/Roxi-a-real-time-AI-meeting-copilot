//! The browser's way back into Roxi after a federated sign-in: a one-shot
//! HTTP listener on 127.0.0.1 at a random port (RFC 8252 §7.3).
//!
//! Loopback rather than a custom `roxi://` scheme: it needs no URL-scheme
//! registration in the bundle and no extra plugin, and only this Mac can
//! reach it. It answers exactly one request for its secret path, then closes.

use std::time::Duration;

use async_trait::async_trait;
use reqwest::Url;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::domain::account::{AuthError, AuthErrorCode};
use crate::ports::federated_auth::{PendingRedirect, RedirectListener, RedirectParams};

/// A request line plus headers never needs more than this.
const MAX_REQUEST_BYTES: usize = 8 * 1024;
/// A client that connects and then says nothing is dropped after this.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

pub struct LoopbackRedirectListener;

struct PendingLoopback {
    listener: TcpListener,
    path: String,
    url: String,
}

fn listener_error(e: std::io::Error) -> AuthError {
    tracing::warn!("[auth] loopback redirect listener failed: {e}");
    AuthError::new(
        AuthErrorCode::Unknown,
        "Couldn't start browser sign-in on this Mac. Try again.",
    )
}

#[async_trait]
impl RedirectListener for LoopbackRedirectListener {
    async fn listen(&self, path: &str) -> Result<Box<dyn PendingRedirect>, AuthError> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(listener_error)?;
        let port = listener.local_addr().map_err(listener_error)?.port();
        Ok(Box::new(PendingLoopback {
            listener,
            path: path.to_string(),
            url: format!("http://127.0.0.1:{port}{path}"),
        }))
    }
}

#[async_trait]
impl PendingRedirect for PendingLoopback {
    fn redirect_url(&self) -> &str {
        &self.url
    }

    async fn wait(self: Box<Self>) -> Result<RedirectParams, AuthError> {
        loop {
            let (mut stream, _) = self.listener.accept().await.map_err(listener_error)?;
            let Some(target) = read_request_target(&mut stream).await else {
                continue;
            };
            match parse_callback(&target, &self.path) {
                Some(params) => {
                    let page = if params.code.is_some() {
                        SIGNED_IN_PAGE
                    } else {
                        FAILED_PAGE
                    };
                    respond(&mut stream, "200 OK", page).await;
                    return Ok(params);
                }
                // Anything else (a favicon, a guessed path) is refused and ignored.
                None => respond(&mut stream, "404 Not Found", "").await,
            }
        }
    }
}

/// The target of a `GET` request (`/auth/callback/…?code=…`), or `None`.
async fn read_request_target(stream: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let read = async {
        while !buf.windows(4).any(|w| w == b"\r\n\r\n") && buf.len() < MAX_REQUEST_BYTES {
            let n = stream.read(&mut chunk).await.ok()?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        Some(())
    };
    tokio::time::timeout(READ_TIMEOUT, read).await.ok()??;
    let head = String::from_utf8_lossy(&buf);
    let mut parts = head.lines().next()?.split_whitespace();
    match (parts.next(), parts.next()) {
        (Some("GET"), Some(target)) => Some(target.to_string()),
        _ => None,
    }
}

/// The redirect's parameters, if `target` is the expected path.
pub(crate) fn parse_callback(target: &str, expected_path: &str) -> Option<RedirectParams> {
    let url = Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != expected_path {
        return None;
    }
    let mut params = RedirectParams::default();
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => params.code = Some(value.into_owned()),
            "error" => params.error = Some(value.into_owned()),
            "error_description" => params.error_description = Some(value.into_owned()),
            _ => {}
        }
    }
    Some(params)
}

async fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// Static on purpose: nothing from the query string is echoed into the page.
const SIGNED_IN_PAGE: &str = r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signed in to Roxi</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#15133B;color:#fff;font:16px -apple-system,system-ui,sans-serif}main{max-width:420px;padding:32px;text-align:center}h1{font:500 32px "New York",Georgia,serif;margin:0 0 12px}p{margin:0;color:rgba(255,255,255,.74);line-height:1.5}</style></head><body><main><h1>You're signed in</h1><p>You can close this tab and go back to Roxi.</p></main></body></html>"#;

const FAILED_PAGE: &str = r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Roxi sign-in</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#15133B;color:#fff;font:16px -apple-system,system-ui,sans-serif}main{max-width:420px;padding:32px;text-align:center}h1{font:500 32px "New York",Georgia,serif;margin:0 0 12px}p{margin:0;color:rgba(255,255,255,.74);line-height:1.5}</style></head><body><main><h1>Sign-in didn't finish</h1><p>Close this tab and go back to Roxi to try again.</p></main></body></html>"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_code_and_errors_from_the_expected_path_only() {
        let ok = parse_callback(
            "/auth/callback/abc?code=xyz&state=ignored",
            "/auth/callback/abc",
        )
        .unwrap();
        assert_eq!(ok.code.as_deref(), Some("xyz"));

        let denied = parse_callback(
            "/auth/callback/abc?error=access_denied&error_description=User%20cancelled",
            "/auth/callback/abc",
        )
        .unwrap();
        assert_eq!(denied.error.as_deref(), Some("access_denied"));
        assert_eq!(denied.error_description.as_deref(), Some("User cancelled"));

        assert!(parse_callback("/auth/callback/guess?code=xyz", "/auth/callback/abc").is_none());
        assert!(parse_callback("/favicon.ico", "/auth/callback/abc").is_none());
    }

    #[tokio::test]
    async fn completes_on_the_callback_and_ignores_other_requests() {
        let pending = LoopbackRedirectListener
            .listen("/auth/callback/s3cret")
            .await
            .unwrap();
        let base = pending
            .redirect_url()
            .trim_end_matches("/auth/callback/s3cret")
            .to_string();
        assert!(base.starts_with("http://127.0.0.1:"));

        let waiter = tokio::spawn(pending.wait());
        let client = reqwest::Client::new();
        let stray = client
            .get(format!("{base}/favicon.ico"))
            .send()
            .await
            .unwrap();
        assert_eq!(stray.status(), 404);
        let hit = client
            .get(format!("{base}/auth/callback/s3cret?code=abc"))
            .send()
            .await
            .unwrap();
        assert_eq!(hit.status(), 200);

        let params = waiter.await.unwrap().unwrap();
        assert_eq!(params.code.as_deref(), Some("abc"));
    }
}
