//! Supabase access-token verification.
//!
//! Supabase signs access tokens one of two ways: asymmetric signing keys
//! (ES256/RS256, public keys at `/auth/v1/.well-known/jwks.json`) or the
//! legacy shared HS256 secret. Both are accepted, but each algorithm is bound
//! to its own key source: an HS256 token is only ever checked against the
//! configured secret and an asymmetric token only against the JWKS. That
//! binding is what prevents algorithm-confusion attacks, where a token signed
//! with a public key as an HMAC secret would otherwise verify.

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::ApiError;
use crate::AppState;

/// Supabase puts every signed-in user's token in this audience.
const AUDIENCE: &str = "authenticated";
/// Keys rotate rarely; an unknown `kid` forces an early refresh anyway.
const JWKS_TTL: Duration = Duration::from_secs(600);
/// Refreshing on every unknown `kid` would let junk tokens hammer Supabase.
const JWKS_MIN_REFRESH_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Deserialize)]
pub struct Claims {
    /// The Supabase user id. Used directly as `users.id`.
    pub sub: Uuid,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("malformed or invalid token: {0}")]
    Invalid(#[from] jsonwebtoken::errors::Error),
    #[error("token algorithm {0:?} is not accepted")]
    UnsupportedAlgorithm(Algorithm),
    #[error("no signing key matches this token")]
    UnknownKey,
    #[error("could not fetch signing keys: {0}")]
    Jwks(String),
}

struct CachedJwks {
    set: JwkSet,
    fetched_at: Instant,
}

pub struct TokenVerifier {
    issuer: String,
    jwks_url: String,
    hs256_key: Option<DecodingKey>,
    http: reqwest::Client,
    jwks: RwLock<Option<CachedJwks>>,
}

impl TokenVerifier {
    pub fn new(supabase_url: &str, jwt_secret: Option<&str>, http: reqwest::Client) -> Self {
        Self {
            issuer: format!("{supabase_url}/auth/v1"),
            jwks_url: format!("{supabase_url}/auth/v1/.well-known/jwks.json"),
            hs256_key: jwt_secret.map(|s| DecodingKey::from_secret(s.as_bytes())),
            http,
            jwks: RwLock::new(None),
        }
    }

    pub async fn verify(&self, token: &str) -> Result<Claims, AuthError> {
        let header = decode_header(token)?;
        let key = match header.alg {
            Algorithm::HS256 => self
                .hs256_key
                .clone()
                .ok_or(AuthError::UnsupportedAlgorithm(Algorithm::HS256))?,
            Algorithm::ES256 | Algorithm::RS256 => self.jwks_key(header.kid.as_deref()).await?,
            other => return Err(AuthError::UnsupportedAlgorithm(other)),
        };

        let mut validation = Validation::new(header.alg);
        validation.set_audience(&[AUDIENCE]);
        validation.set_issuer(&[&self.issuer]);
        validation.set_required_spec_claims(&["exp", "sub", "aud", "iss"]);
        validation.leeway = 30;
        Ok(decode::<Claims>(token, &key, &validation)?.claims)
    }

    async fn jwks_key(&self, kid: Option<&str>) -> Result<DecodingKey, AuthError> {
        let kid = kid.ok_or(AuthError::UnknownKey)?;

        {
            let cache = self.jwks.read().await;
            if let Some(cached) = cache.as_ref() {
                if let Some(jwk) = cached.set.find(kid) {
                    if cached.fetched_at.elapsed() < JWKS_TTL {
                        return Ok(DecodingKey::from_jwk(jwk)?);
                    }
                } else if cached.fetched_at.elapsed() < JWKS_MIN_REFRESH_INTERVAL {
                    return Err(AuthError::UnknownKey);
                }
            }
        }

        let mut cache = self.jwks.write().await;
        // Another request may have refreshed while this one waited for the lock.
        let fresh = cache.as_ref().is_some_and(|c| c.fetched_at.elapsed() < JWKS_MIN_REFRESH_INTERVAL);
        if !fresh {
            let set = self.fetch_jwks().await?;
            *cache = Some(CachedJwks { set, fetched_at: Instant::now() });
        }
        let jwk = cache.as_ref().and_then(|c| c.set.find(kid)).ok_or(AuthError::UnknownKey)?;
        Ok(DecodingKey::from_jwk(jwk)?)
    }

    async fn fetch_jwks(&self) -> Result<JwkSet, AuthError> {
        self.http
            .get(&self.jwks_url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| AuthError::Jwks(e.to_string()))?
            .json::<JwkSet>()
            .await
            .map_err(|e| AuthError::Jwks(e.to_string()))
    }
}

/// Extractor for handlers that require a signed-in user.
pub struct AuthUser(pub Claims);

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or(ApiError::Unauthorized)?;

        match state.verifier.verify(token).await {
            Ok(claims) => Ok(AuthUser(claims)),
            Err(e) => {
                tracing::debug!(error = %e, "rejected access token");
                Err(ApiError::Unauthorized)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde_json::json;

    const URL: &str = "https://proj.supabase.co";
    const SECRET: &str = "test-secret-at-least-32-bytes-long!!";

    fn verifier(secret: Option<&str>) -> TokenVerifier {
        TokenVerifier::new(URL, secret, reqwest::Client::new())
    }

    fn token(claims: serde_json::Value, secret: &str) -> String {
        encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(secret.as_bytes())).unwrap()
    }

    fn valid_claims() -> serde_json::Value {
        json!({
            "sub": "7b0b7f8e-3c2a-4a55-9d1e-2f3c4b5a6d7e",
            "email": "ana@example.com",
            "aud": "authenticated",
            "iss": format!("{URL}/auth/v1"),
            "exp": chrono::Utc::now().timestamp() + 3600,
        })
    }

    #[tokio::test]
    async fn accepts_a_valid_hs256_token() {
        let claims = verifier(Some(SECRET)).verify(&token(valid_claims(), SECRET)).await.unwrap();
        assert_eq!(claims.email.as_deref(), Some("ana@example.com"));
    }

    #[tokio::test]
    async fn rejects_wrong_secret_issuer_audience_and_expiry() {
        let v = verifier(Some(SECRET));
        assert!(v.verify(&token(valid_claims(), "some-other-secret-that-is-long-enough")).await.is_err());

        for (field, value) in [
            ("iss", json!("https://evil.supabase.co/auth/v1")),
            ("aud", json!("anon")),
            ("exp", json!(chrono::Utc::now().timestamp() - 3600)),
        ] {
            let mut c = valid_claims();
            c[field] = value;
            assert!(v.verify(&token(c, SECRET)).await.is_err(), "{field} should be rejected");
        }
    }

    #[tokio::test]
    async fn hs256_is_refused_when_no_secret_is_configured() {
        let err = verifier(None).verify(&token(valid_claims(), SECRET)).await.unwrap_err();
        assert!(matches!(err, AuthError::UnsupportedAlgorithm(Algorithm::HS256)));
    }

    #[tokio::test]
    async fn rejects_garbage() {
        assert!(verifier(Some(SECRET)).verify("not.a.jwt").await.is_err());
    }
}
