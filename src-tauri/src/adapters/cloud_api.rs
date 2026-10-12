//! Client for the Roxi cloud API (`server/`).

use std::time::Duration;

use anyhow::{anyhow, Context};
use async_trait::async_trait;
use serde::Deserialize;

use crate::domain::account::Workspace;
use crate::ports::auth::{CloudApi, ImportBatchResult};

const DEFAULT_API_URL: &str = "http://localhost:8080";

pub struct RoxiCloudClient {
    base: String,
    http: reqwest::Client,
}

#[derive(Deserialize)]
struct MeResponse {
    org_id: String,
    org_name: String,
    role: String,
    plan: String,
}

impl RoxiCloudClient {
    pub fn from_env() -> anyhow::Result<Self> {
        let base = std::env::var("ROXI_API_URL")
            .ok()
            .map(|v| v.trim().trim_end_matches('/').to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| DEFAULT_API_URL.to_string());
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()?;
        Ok(Self { base, http })
    }

    async fn error_message(res: reqwest::Response) -> anyhow::Error {
        let status = res.status();
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        let message = body["error"]["message"]
            .as_str()
            .unwrap_or("request failed");
        anyhow!("{message} ({status})")
    }
}

#[async_trait]
impl CloudApi for RoxiCloudClient {
    async fn workspace(&self, access_token: &str) -> anyhow::Result<Workspace> {
        let res = self
            .http
            .get(format!("{}/v1/me", self.base))
            .bearer_auth(access_token)
            .send()
            .await
            .with_context(|| format!("can't reach the Roxi API at {}", self.base))?;
        if !res.status().is_success() {
            return Err(Self::error_message(res).await);
        }
        let me: MeResponse = res.json().await?;
        Ok(Workspace {
            org_id: me.org_id,
            org_name: me.org_name,
            role: me.role,
            plan: me.plan,
        })
    }

    async fn import_batch(
        &self,
        access_token: &str,
        batch: &serde_json::Value,
    ) -> anyhow::Result<ImportBatchResult> {
        let res = self
            .http
            .post(format!("{}/v1/import/meetings", self.base))
            .bearer_auth(access_token)
            .json(batch)
            .send()
            .await
            .with_context(|| format!("can't reach the Roxi API at {}", self.base))?;
        if !res.status().is_success() {
            return Err(Self::error_message(res).await);
        }
        Ok(res.json().await?)
    }
}
