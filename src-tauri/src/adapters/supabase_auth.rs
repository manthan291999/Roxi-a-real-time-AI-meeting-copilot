//! Supabase Auth over its REST API (GoTrue).
//!
//! Calls go from Rust rather than the webview so the webview's CSP can stay
//! `connect-src 'self'` and tokens never touch JavaScript. The project's
//! publishable (anon) key is safe to ship: it only identifies the project.

use std::time::Duration;

use async_trait::async_trait;
use reqwest::{StatusCode, Url};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::domain::account::{AccountUser, AuthError, AuthErrorCode, AuthSession};
use crate::domain::federated::{FederatedMethod, OAuthProvider, SignInMethods};
use crate::ports::auth::{AuthProvider, SignUpOutcome};
use crate::ports::federated_auth::FederatedAuthProvider;

pub struct SupabaseAuth {
    base: String,
    anon_key: String,
    http: reqwest::Client,
    /// Where links in sign-up emails send the browser. `None` falls back to
    /// the project's Site URL.
    email_redirect: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: Option<i64>,
    expires_at: Option<i64>,
    user: UserResponse,
}

#[derive(Deserialize)]
struct UserResponse {
    id: String,
    email: Option<String>,
    #[serde(default)]
    user_metadata: Value,
}

impl From<TokenResponse> for AuthSession {
    fn from(t: TokenResponse) -> Self {
        let expires_at = t
            .expires_at
            .unwrap_or_else(|| chrono::Utc::now().timestamp() + t.expires_in.unwrap_or(3600));
        let full_name = t
            .user
            .user_metadata
            .get("full_name")
            .and_then(Value::as_str)
            .map(str::to_string);
        AuthSession {
            access_token: t.access_token,
            refresh_token: t.refresh_token,
            expires_at,
            user: AccountUser {
                id: t.user.id,
                email: t.user.email,
                full_name,
            },
        }
    }
}

impl SupabaseAuth {
    /// `None` when either setting is missing, which puts the app in local mode.
    pub fn from_env() -> Option<Self> {
        let get = |k: &str| {
            std::env::var(k)
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let base = get("SUPABASE_URL")?.trim_end_matches('/').to_string();
        let anon_key = get("SUPABASE_ANON_KEY")?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .ok()?;
        let email_redirect =
            email_redirect_from(get("ROXI_EMAIL_REDIRECT_URL"), get("ROXI_API_URL"));
        Some(Self {
            base,
            anon_key,
            http,
            email_redirect,
        })
    }

    /// `path` plus `redirect_to` for the email-confirmed page, when one is set.
    /// Supabase honours it only if it is in the project's Redirect URLs list.
    fn with_email_redirect(&self, path: &str) -> String {
        match &self.email_redirect {
            Some(url) => {
                let query: String =
                    reqwest::Url::parse_with_params("http://x/", &[("redirect_to", url)])
                        .map(|u| u.query().unwrap_or_default().to_string())
                        .unwrap_or_default();
                format!("{path}?{query}")
            }
            None => path.to_string(),
        }
    }

    /// Federated options this build offers, from the root `.env`:
    /// `SUPABASE_OAUTH_PROVIDERS=azure,google` and `SUPABASE_SSO=true`. Each
    /// must also be enabled in the Supabase project, or its button fails.
    pub fn sign_in_methods_from_env() -> SignInMethods {
        let mut providers: Vec<OAuthProvider> = std::env::var("SUPABASE_OAUTH_PROVIDERS")
            .unwrap_or_default()
            .split(',')
            .filter(|id| !id.trim().is_empty())
            .filter_map(|id| {
                let parsed = OAuthProvider::parse(id);
                if parsed.is_none() {
                    tracing::warn!(
                        "[auth] ignoring unknown SUPABASE_OAUTH_PROVIDERS entry {:?}",
                        id.trim()
                    );
                }
                parsed
            })
            .collect();
        let mut seen = Vec::new();
        providers.retain(|p| {
            if seen.contains(p) {
                false
            } else {
                seen.push(*p);
                true
            }
        });
        let company_sso = matches!(
            std::env::var("SUPABASE_SSO")
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "1" | "true" | "yes"
        );
        SignInMethods {
            providers,
            company_sso,
        }
    }

    async fn post(
        &self,
        path: &str,
        bearer: Option<&str>,
        body: Value,
    ) -> Result<(StatusCode, Value), AuthError> {
        let mut req = self
            .http
            .post(format!("{}/auth/v1/{path}", self.base))
            .header("apikey", &self.anon_key)
            .json(&body);
        if let Some(token) = bearer {
            req = req.bearer_auth(token);
        }
        let res = req.send().await.map_err(|e| {
            tracing::warn!("[auth] request to {path} failed: {e}");
            AuthError::new(
                AuthErrorCode::Network,
                "Can't reach the sign-in service. Check your connection and try again.",
            )
        })?;
        let status = res.status();
        let value = res.json::<Value>().await.unwrap_or(Value::Null);
        if status.is_success() {
            Ok((status, value))
        } else {
            Err(map_error(status, &value))
        }
    }

    fn session(value: Value) -> Result<AuthSession, AuthError> {
        serde_json::from_value::<TokenResponse>(value)
            .map(AuthSession::from)
            .map_err(|e| {
                AuthError::new(
                    AuthErrorCode::Unknown,
                    format!("Unexpected sign-in response: {e}"),
                )
            })
    }
}

#[async_trait]
impl AuthProvider for SupabaseAuth {
    async fn sign_up(
        &self,
        email: &str,
        password: &str,
        full_name: Option<&str>,
    ) -> Result<SignUpOutcome, AuthError> {
        let (_, value) = self
            .post(
                &self.with_email_redirect("signup"),
                None,
                json!({ "email": email, "password": password, "data": { "full_name": full_name } }),
            )
            .await?;
        // With email confirmation on, the response is a bare user object.
        if value.get("access_token").is_some() {
            Ok(SignUpOutcome::SignedIn(Self::session(value)?))
        } else {
            Ok(SignUpOutcome::ConfirmEmail)
        }
    }

    async fn sign_in(&self, email: &str, password: &str) -> Result<AuthSession, AuthError> {
        let (_, value) = self
            .post(
                "token?grant_type=password",
                None,
                json!({ "email": email, "password": password }),
            )
            .await?;
        Self::session(value)
    }

    async fn refresh(&self, refresh_token: &str) -> Result<AuthSession, AuthError> {
        let (_, value) = self
            .post(
                "token?grant_type=refresh_token",
                None,
                json!({ "refresh_token": refresh_token }),
            )
            .await
            .map_err(|e| {
                if e.code == AuthErrorCode::Network {
                    e
                } else {
                    AuthError::session_expired()
                }
            })?;
        Self::session(value)
    }

    async fn sign_out(&self, access_token: &str) -> Result<(), AuthError> {
        self.post("logout?scope=local", Some(access_token), json!({}))
            .await
            .map(|_| ())
    }

    async fn send_password_reset(&self, email: &str) -> Result<(), AuthError> {
        self.post("recover", None, json!({ "email": email }))
            .await
            .map(|_| ())
    }

    async fn resend_confirmation(&self, email: &str) -> Result<(), AuthError> {
        self.post(
            &self.with_email_redirect("resend"),
            None,
            json!({ "type": "signup", "email": email }),
        )
        .await
        .map(|_| ())
    }
}

#[async_trait]
impl FederatedAuthProvider for SupabaseAuth {
    async fn authorization_url(
        &self,
        method: &FederatedMethod,
        redirect_to: &str,
        code_challenge: &str,
    ) -> Result<String, AuthError> {
        match method {
            FederatedMethod::OAuth(provider) => {
                let mut params = vec![
                    ("provider", provider.id()),
                    ("redirect_to", redirect_to),
                    ("code_challenge", code_challenge),
                    ("code_challenge_method", "s256"),
                ];
                if let Some(scopes) = provider.extra_scopes() {
                    params.push(("scopes", scopes));
                }
                Url::parse_with_params(&format!("{}/auth/v1/authorize", self.base), &params)
                    .map(String::from)
                    .map_err(|e| {
                        AuthError::new(
                            AuthErrorCode::NotConfigured,
                            format!("SUPABASE_URL is not a valid address: {e}"),
                        )
                    })
            }
            FederatedMethod::CompanySso { domain } => {
                let (_, value) = self
                    .post(
                        "sso",
                        None,
                        json!({
                            "domain": domain,
                            "redirect_to": redirect_to,
                            "code_challenge": code_challenge,
                            "code_challenge_method": "s256",
                            "skip_http_redirect": true,
                        }),
                    )
                    .await?;
                value
                    .get("url")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .ok_or_else(|| {
                        AuthError::new(
                            AuthErrorCode::Unknown,
                            "The SSO service didn't say where to sign in.",
                        )
                    })
            }
        }
    }

    async fn exchange_code(
        &self,
        auth_code: &str,
        code_verifier: &str,
    ) -> Result<AuthSession, AuthError> {
        let (_, value) = self
            .post(
                "token?grant_type=pkce",
                None,
                json!({ "auth_code": auth_code, "code_verifier": code_verifier }),
            )
            .await?;
        Self::session(value)
    }
}

/// The page confirmation links open: `ROXI_EMAIL_REDIRECT_URL` if set, else
/// the Roxi API's `/auth/confirmed` page (server/src/routes/auth_pages.rs).
fn email_redirect_from(explicit: Option<String>, api_url: Option<String>) -> Option<String> {
    explicit.or_else(|| api_url.map(|api| format!("{}/auth/confirmed", api.trim_end_matches('/'))))
}

/// Supabase has two error shapes: `{error_code, msg}` (current) and
/// `{error, error_description}` (older endpoints). Both are read.
pub(crate) fn map_error(status: StatusCode, body: &Value) -> AuthError {
    let text = |k: &str| {
        body.get(k)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let error_code = match text("error_code") {
        c if !c.is_empty() => c,
        _ => text("error"),
    };
    let detail = [text("msg"), text("error_description"), text("message")]
        .into_iter()
        .find(|s| !s.is_empty())
        .unwrap_or_default();

    use AuthErrorCode::*;
    let (code, message) = match error_code.as_str() {
        "invalid_credentials" | "invalid_grant" => (InvalidCredentials, "That email and password don't match. Try again or reset your password.".to_string()),
        "email_not_confirmed" => (EmailNotConfirmed, "Confirm your email first. Check your inbox for the link we sent.".to_string()),
        "user_already_exists" | "email_exists" => (UserExists, "An account with this email already exists. Sign in instead.".to_string()),
        "weak_password" => (WeakPassword, format!("Choose a stronger password. {detail}").trim().to_string()),
        "sso_provider_not_found" => (InvalidInput, "No company sign-in is set up for that email domain. Use your email and password, or ask your admin.".to_string()),
        "provider_disabled" | "saml_provider_disabled" => (NotConfigured, "That sign-in option isn't turned on yet. Use your email and password instead.".to_string()),
        "flow_state_expired" | "flow_state_not_found" | "bad_code_verifier" => (SessionExpired, "That sign-in took too long to finish. Start again.".to_string()),
        "validation_failed" | "email_address_invalid" => (InvalidInput, "Check the email address and try again.".to_string()),
        c if c.starts_with("over_") || status == StatusCode::TOO_MANY_REQUESTS => {
            (RateLimited, "Too many attempts. Wait a minute, then try again.".to_string())
        }
        _ if status.is_server_error() => (Network, "The sign-in service is having trouble. Try again shortly.".to_string()),
        _ => (Unknown, if detail.is_empty() { format!("Sign-in failed ({status}).") } else { detail }),
    };
    AuthError::new(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_current_and_legacy_error_shapes() {
        let current = map_error(
            StatusCode::BAD_REQUEST,
            &json!({ "code": 400, "error_code": "invalid_credentials", "msg": "Invalid login credentials" }),
        );
        assert_eq!(current.code, AuthErrorCode::InvalidCredentials);

        let legacy = map_error(
            StatusCode::BAD_REQUEST,
            &json!({ "error": "invalid_grant", "error_description": "Invalid login credentials" }),
        );
        assert_eq!(legacy.code, AuthErrorCode::InvalidCredentials);

        let limited = map_error(
            StatusCode::TOO_MANY_REQUESTS,
            &json!({ "error_code": "over_email_send_rate_limit" }),
        );
        assert_eq!(limited.code, AuthErrorCode::RateLimited);

        let weak = map_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            &json!({ "error_code": "weak_password", "msg": "Password should be at least 8 characters." }),
        );
        assert_eq!(weak.code, AuthErrorCode::WeakPassword);
        assert!(weak.message.contains("at least 8"));

        let no_sso = map_error(
            StatusCode::NOT_FOUND,
            &json!({ "error_code": "sso_provider_not_found", "msg": "No SSO provider assigned for this domain" }),
        );
        assert_eq!(no_sso.code, AuthErrorCode::InvalidInput);

        let stale = map_error(
            StatusCode::NOT_FOUND,
            &json!({ "error_code": "flow_state_not_found" }),
        );
        assert_eq!(stale.code, AuthErrorCode::SessionExpired);

        let unknown = map_error(StatusCode::BAD_REQUEST, &Value::Null);
        assert_eq!(unknown.code, AuthErrorCode::Unknown);
    }

    fn test_client() -> SupabaseAuth {
        SupabaseAuth {
            base: "https://acme.supabase.co".into(),
            anon_key: "anon".into(),
            http: reqwest::Client::new(),
            email_redirect: None,
        }
    }

    #[test]
    fn sends_email_links_to_the_confirmed_page() {
        assert_eq!(
            email_redirect_from(None, Some("http://localhost:8080/".into())).as_deref(),
            Some("http://localhost:8080/auth/confirmed")
        );
        assert_eq!(
            email_redirect_from(Some("https://roxi.app/ok".into()), Some("http://x".into()))
                .as_deref(),
            Some("https://roxi.app/ok")
        );
        assert_eq!(email_redirect_from(None, None), None);

        let mut client = test_client();
        assert_eq!(client.with_email_redirect("signup"), "signup");
        client.email_redirect = Some("http://localhost:8080/auth/confirmed".into());
        assert_eq!(
            client.with_email_redirect("signup"),
            "signup?redirect_to=http%3A%2F%2Flocalhost%3A8080%2Fauth%2Fconfirmed"
        );
    }

    #[tokio::test]
    async fn builds_a_pkce_authorize_url_for_oauth_providers() {
        let url = test_client()
            .authorization_url(
                &FederatedMethod::OAuth(OAuthProvider::Azure),
                "http://127.0.0.1:5555/auth/callback/s",
                "chal",
            )
            .await
            .unwrap();
        let parsed = Url::parse(&url).unwrap();
        assert_eq!(parsed.path(), "/auth/v1/authorize");
        let q: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(q["provider"], "azure");
        assert_eq!(q["redirect_to"], "http://127.0.0.1:5555/auth/callback/s");
        assert_eq!(q["code_challenge"], "chal");
        assert_eq!(q["code_challenge_method"], "s256");
        assert_eq!(q["scopes"], "email");

        let google = test_client()
            .authorization_url(
                &FederatedMethod::OAuth(OAuthProvider::Google),
                "http://127.0.0.1:1/x",
                "c",
            )
            .await
            .unwrap();
        assert!(!google.contains("scopes="));
    }

    #[test]
    fn builds_a_session_from_a_token_response() {
        let session = SupabaseAuth::session(json!({
            "access_token": "a", "refresh_token": "r", "expires_in": 3600, "expires_at": 1_900_000_000,
            "user": { "id": "u1", "email": "ana@example.com", "user_metadata": { "full_name": "Ana" } }
        }))
        .unwrap();
        assert_eq!(session.expires_at, 1_900_000_000);
        assert_eq!(session.user.full_name.as_deref(), Some("Ana"));
    }
}
