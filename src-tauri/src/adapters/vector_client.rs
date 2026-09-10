use crate::adapters::db_paths;
use crate::ports::vector_store::VectorStore;
use anyhow::{anyhow, Result};
use reqwest::Client;
use serde_json::json;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use tracing::{debug, error, info, warn};

const QDRANT_BASE_URL: &str = "http://127.0.0.1:6333";
const EPISODIC_COLLECTION: &str = "roxi_episodic_memory";
const SEMANTIC_COLLECTION: &str = "roxi_semantic_memory";

pub struct QdrantVectorStore {
    is_running: Arc<AtomicBool>,
    child_tx: Mutex<Option<Child>>,
}

impl QdrantVectorStore {
    pub fn new() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            child_tx: Mutex::new(None),
        }
    }

    /// Locates the qdrant binary to spawn. `cargo tauri dev` runs with `src-
    /// tauri/` as the working directory (mirroring `db_paths::repo_root()`'s
    /// same observation for the other adapters), so a plain
    /// `current_dir.join("qdrant")` never resolved to anything real.
    ///
    /// The repo-root `./qdrant` copy is checked FIRST, ahead of the
    /// target-triple-named sidecar under `src-tauri/bin/` — verified the hard
    /// way: `src-tauri/bin/qdrant-<arch>-apple-darwin` is a materially older
    /// Qdrant build (dated Jan 2024) than the repo-root copy (1.19.1), and
    /// pointed at the same storage directory it panics on startup trying to
    /// parse a collection config the newer engine wrote (`invalid type: null,
    /// expected usize` — a field that became optional in a later schema
    /// version). Whichever binary WRITES a collection has to be the one that
    /// reads it back; until `src-tauri/bin/` is refreshed to match (or the
    /// packaging plan's `externalBin` wiring replaces this manual resolution
    /// entirely, §11), the repo-root copy is the one that must win.
    fn resolve_qdrant_binary(current_dir: &std::path::Path) -> Option<std::path::PathBuf> {
        let repo_root = if current_dir.ends_with("src-tauri") {
            current_dir
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| current_dir.to_path_buf())
        } else {
            current_dir.to_path_buf()
        };

        let target_suffix = format!("{}-apple-darwin", std::env::consts::ARCH);
        let candidates = [
            repo_root.join("qdrant"),
            current_dir.join("qdrant"),
            repo_root
                .join("src-tauri")
                .join("bin")
                .join(format!("qdrant-{target_suffix}")),
        ];

        candidates.into_iter().find(|p| p.is_file())
    }

    async fn wait_for_healthy(&self) -> Result<()> {
        let client = Client::builder().timeout(Duration::from_secs(2)).build()?;
        let mut retries = 0;
        let max_retries = 15;

        while retries < max_retries {
            if !self.is_running.load(Ordering::SeqCst) {
                return Err(anyhow!("Qdrant process terminated during startup"));
            }

            match client.get("http://127.0.0.1:6333/readyz").send().await {
                Ok(resp) if resp.status().is_success() => {
                    debug!("Qdrant sidecar is healthy");
                    return Ok(());
                }
                _ => {
                    retries += 1;
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        }

        Err(anyhow!("Qdrant sidecar failed to become healthy within 7.5 seconds"))
    }

    /// Idempotent collection + payload-index bootstrap (Meeting Semantic
    /// Memory plan §01/§10, rollout Phase 1: "verified with a raw HTTP call,
    /// no chatbot changes yet"). Rust owns process supervision, so it also
    /// owns making sure both collections exist before anything downstream —
    /// the chatbot's own `QdrantVectorIndex.ensureCollection()` is a defensive
    /// duplicate used by the manual backfill script, not the source of truth.
    async fn ensure_collections(&self) -> Result<()> {
        let client = Client::builder().timeout(Duration::from_secs(10)).build()?;

        self.ensure_collection(
            &client,
            EPISODIC_COLLECTION,
            &[
                ("meeting_id", "integer"),
                ("project_id", "integer"),
                ("speaker", "keyword"),
                ("significance", "keyword"),
                ("meeting_start_time", "datetime"),
                ("created_at", "datetime"),
            ],
        )
        .await?;

        self.ensure_collection(
            &client,
            SEMANTIC_COLLECTION,
            &[("source_table", "keyword"), ("project_id", "integer")],
        )
        .await?;

        Ok(())
    }

    async fn ensure_collection(
        &self,
        client: &Client,
        name: &str,
        indexes: &[(&str, &str)],
    ) -> Result<()> {
        let exists = client
            .get(format!("{QDRANT_BASE_URL}/collections/{name}"))
            .send()
            .await
            .map(|resp| resp.status().is_success())
            .unwrap_or(false);

        if exists {
            debug!("Qdrant collection '{name}' already exists");
            return Ok(());
        }

        info!("Creating Qdrant collection '{name}'");
        let create_res = client
            .put(format!("{QDRANT_BASE_URL}/collections/{name}"))
            .json(&json!({
                "vectors": { "size": 1536, "distance": "Cosine" },
                "hnsw_config": { "m": 16, "ef_construct": 128 }
            }))
            .send()
            .await
            .map_err(|e| anyhow!("Failed to create Qdrant collection '{name}': {e}"))?;

        if !create_res.status().is_success() {
            let status = create_res.status();
            let text = create_res.text().await.unwrap_or_default();
            return Err(anyhow!(
                "Failed to create Qdrant collection '{name}': {status} {text}"
            ));
        }

        for (field_name, field_schema) in indexes {
            let index_res = client
                .put(format!("{QDRANT_BASE_URL}/collections/{name}/index"))
                .json(&json!({ "field_name": field_name, "field_schema": field_schema }))
                .send()
                .await;
            if let Err(e) = index_res {
                // A missing payload index degrades query performance, not
                // correctness (Qdrant falls back to a full scan) — worth a
                // warning, not a failed startup.
                warn!("Failed to create index '{field_name}' on '{name}': {e}");
            }
        }

        Ok(())
    }
}

#[async_trait::async_trait]
impl VectorStore for QdrantVectorStore {
    async fn start(&self) -> Result<()> {
        if self.is_running.load(Ordering::SeqCst) {
            debug!("Qdrant sidecar is already running.");
            return Ok(());
        }

        let qdrant_storage_dir = db_paths::qdrant_storage_dir();

        if let Err(e) = std::fs::create_dir_all(&qdrant_storage_dir) {
            error!("Failed to create Qdrant storage directory: {}", e);
        }

        info!(
            "Starting Qdrant sidecar. Storage dir: {}",
            qdrant_storage_dir.display()
        );

        let current_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let qdrant_path = Self::resolve_qdrant_binary(&current_dir).ok_or_else(|| {
            anyhow!(
                "Could not locate a qdrant binary (checked src-tauri/bin/qdrant-{}-apple-darwin and the repo root)",
                std::env::consts::ARCH
            )
        })?;

        // NOTE: this binary has no `--storage-dir` CLI flag (confirmed
        // against `qdrant --help` — it only knows --config-path/--snapshot/
        // etc). The storage location is configured the same way HOST/PORT
        // already are: a `QDRANT__<section>__<key>` env var override,
        // matching config-rs's nesting convention for config/config.yaml's
        // `storage.storage_path`. Passing a nonexistent CLI flag used to make
        // the process exit immediately with a parse error — spawn() itself
        // doesn't fail on that (only wait_for_healthy() timing out revealed
        // it), so this previously ran with NO vector store at all, silently.
        let child = Command::new(&qdrant_path)
            .env("QDRANT__SERVICE__HOST", "127.0.0.1")
            .env("QDRANT__SERVICE__PORT", "6333")
            .env("QDRANT__STORAGE__STORAGE_PATH", &qdrant_storage_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| anyhow!("Failed to spawn Qdrant sidecar at {}: {}", qdrant_path.display(), e))?;

        self.is_running.store(true, Ordering::SeqCst);
        
        if let Ok(mut child_guard) = self.child_tx.lock() {
            *child_guard = Some(child);
        }

        self.wait_for_healthy().await?;
        self.ensure_collections().await?;

        Ok(())
    }

    fn stop(&self) -> Result<()> {
        if !self.is_running.load(Ordering::SeqCst) {
            return Ok(());
        }

        if let Ok(mut child_guard) = self.child_tx.try_lock() {
            if let Some(mut child) = child_guard.take() {
                let _ = child.kill();
            }
        }
        
        self.is_running.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }
}
