//! Process configuration, read once at boot.
//!
//! Locally the values come from the repo-root `.env` (see `main.rs`); on
//! Render they come from the service's environment. Nothing else in the
//! server reads the environment.

use anyhow::{bail, Context};

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    /// `https://<project>.supabase.co`. Tokens are only accepted from its issuer.
    pub supabase_url: String,
    /// Legacy HS256 secret. Only needed for Supabase projects that have not
    /// moved to asymmetric signing keys; asymmetric tokens are verified
    /// against the project's JWKS and need no secret.
    pub supabase_jwt_secret: Option<String>,
    /// Never sent to clients. The app receives short-lived tokens instead.
    pub assemblyai_api_key: Option<String>,
    pub assemblyai_streaming_base: String,
    pub stt_token_ttl_secs: u32,
}

const DEFAULT_ASSEMBLYAI_STREAMING_BASE: &str = "https://streaming.assemblyai.com";
/// AssemblyAI accepts 1–600 seconds. The token only has to survive until the
/// app opens its WebSocket, so a short life limits the damage if one leaks.
const DEFAULT_STT_TOKEN_TTL_SECS: u32 = 60;

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Testable core of `from_env`: whitespace-only values count as unset.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let get = |key: &str| lookup(key).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());

        let port = match get("PORT") {
            Some(v) => v.parse().with_context(|| format!("PORT is not a valid port: {v}"))?,
            None => 8080,
        };
        let database_url = get("DATABASE_URL").context("DATABASE_URL is required")?;
        let supabase_url = get("SUPABASE_URL")
            .context("SUPABASE_URL is required")?
            .trim_end_matches('/')
            .to_string();
        if !supabase_url.starts_with("https://") && !supabase_url.starts_with("http://") {
            bail!("SUPABASE_URL must be an http(s) URL, got {supabase_url}");
        }
        let stt_token_ttl_secs = match get("STT_TOKEN_TTL_SECS") {
            Some(v) => {
                let ttl: u32 = v.parse().with_context(|| format!("STT_TOKEN_TTL_SECS is not a number: {v}"))?;
                if !(1..=600).contains(&ttl) {
                    bail!("STT_TOKEN_TTL_SECS must be between 1 and 600, got {ttl}");
                }
                ttl
            }
            None => DEFAULT_STT_TOKEN_TTL_SECS,
        };

        Ok(Self {
            port,
            database_url,
            supabase_url,
            supabase_jwt_secret: get("SUPABASE_JWT_SECRET"),
            assemblyai_api_key: get("ASSEMBLYAI_API_KEY"),
            assemblyai_streaming_base: get("ASSEMBLYAI_STREAMING_BASE")
                .unwrap_or_else(|| DEFAULT_ASSEMBLYAI_STREAMING_BASE.to_string())
                .trim_end_matches('/')
                .to_string(),
            stt_token_ttl_secs,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(pairs: &[(&str, &str)]) -> anyhow::Result<Config> {
        let map: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        Config::from_lookup(|k| map.get(k).cloned())
    }

    const REQUIRED: [(&str, &str); 2] =
        [("DATABASE_URL", "postgres://localhost/roxi"), ("SUPABASE_URL", "https://abc.supabase.co/")];

    #[test]
    fn applies_defaults_and_trims_trailing_slash() {
        let c = config(&REQUIRED).unwrap();
        assert_eq!(c.port, 8080);
        assert_eq!(c.supabase_url, "https://abc.supabase.co");
        assert_eq!(c.stt_token_ttl_secs, 60);
        assert!(c.assemblyai_api_key.is_none());
    }

    #[test]
    fn whitespace_only_values_are_unset() {
        let mut pairs = REQUIRED.to_vec();
        pairs.push(("ASSEMBLYAI_API_KEY", "   "));
        assert!(config(&pairs).unwrap().assemblyai_api_key.is_none());
    }

    #[test]
    fn rejects_missing_required_and_bad_values() {
        assert!(config(&[("SUPABASE_URL", "https://abc.supabase.co")]).is_err());
        let mut pairs = REQUIRED.to_vec();
        pairs.push(("STT_TOKEN_TTL_SECS", "601"));
        assert!(config(&pairs).is_err());
    }
}
