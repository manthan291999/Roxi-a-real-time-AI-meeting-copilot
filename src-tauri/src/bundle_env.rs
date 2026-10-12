//! Environment for a packaged desktop application.
//!
//! Under `tauri dev` every runtime finds its files by walking out of the
//! repo (see `adapters::db_paths`). A downloaded installer has no repo: the
//! Node sidecars, a Node runtime, the Qdrant binary and the release `.env`
//! are shipped under `Contents/Resources/roxi/` by
//! `scripts/bundle-sidecars.sh`, and the bundle itself is read-only, so every
//! database moves to `~/Library/Application Support/<identifier>/`.
//!
//! All of it is expressed as the same environment variables the dev setup
//! already honours, set only when unset, so a variable exported by hand still
//! wins and the sidecars (which inherit this process's environment) agree
//! with Rust on every path.

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Matches `identifier` in `tauri.conf.json`.
const APP_IDENTIFIER: &str = "com.manth.roxi";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    api_url: String,
    #[serde(default)]
    supabase_url: String,
    #[serde(default)]
    supabase_anon_key: String,
    #[serde(default = "default_environment")]
    environment: String,
    #[serde(default = "default_release_channel")]
    release_channel: String,
    #[serde(default)]
    direct_provider_access: bool,
}

fn default_environment() -> String {
    "production".into()
}
fn default_release_channel() -> String {
    "stable".into()
}

/// Platform-specific resource directory containing the staged `roxi/`
/// folder. These locations mirror Tauri's desktop resource resolver.
fn bundled_resources() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let mut candidates = Vec::new();

    #[cfg(target_os = "macos")]
    candidates.push(exe_dir.parent()?.join("Resources").join("roxi"));

    #[cfg(target_os = "windows")]
    candidates.push(exe_dir.join("roxi"));

    #[cfg(target_os = "linux")]
    {
        let exe_name = exe.file_name()?.to_string_lossy();
        if let Some(appdir) = std::env::var_os("APPDIR") {
            candidates.push(
                PathBuf::from(appdir)
                    .join("usr")
                    .join("lib")
                    .join(exe_name.as_ref())
                    .join("roxi"),
            );
        }
        candidates.push(
            exe_dir
                .join("..")
                .join("lib")
                .join(exe_name.as_ref())
                .join("roxi"),
        );
        candidates.push(exe_dir.join("roxi"));
    }

    candidates
        .into_iter()
        .find(|dir| dir.join("gateway").join("sidecar.js").is_file())
}

fn set_default(var: &str, value: impl AsRef<std::ffi::OsStr>) {
    let unset = std::env::var(var)
        .map(|v| v.trim().is_empty())
        .unwrap_or(true);
    if unset {
        std::env::set_var(var, value);
    }
}

fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_IDENTIFIER)
}

fn set_path(var: &str, path: &Path) {
    set_default(var, path.as_os_str());
}

/// Call once at startup, before anything reads the environment or spawns a
/// thread. A no-op outside a packaged bundle.
pub fn configure() {
    let Some(resources) = bundled_resources() else {
        return;
    };

    load_runtime_config(&resources);

    let data = data_dir();
    if let Err(e) = std::fs::create_dir_all(&data) {
        tracing::error!("[bundle] could not create {}: {e}", data.display());
    }

    set_path("MEETING_DB_PATH", &data.join("meeting_history.db"));
    set_path("CHATBOT_MEETING_DB", &data.join("meeting_history.db"));
    set_path("LLM_USAGE_DB", &data.join("llm_usage.db"));
    set_path("CHATBOT_DOC_DB", &data.join("doc_store.db"));
    set_path("CHATBOT_INDEX_DB", &data.join("chat_index.db"));
    set_path("QDRANT_STORAGE_DIR", &data.join("qdrant_storage"));
    set_path("ROXI_TRIAL_FILE", &data.join("trial.json"));

    let node_name = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };
    let qdrant_name = if cfg!(target_os = "windows") {
        "qdrant.exe"
    } else {
        "qdrant"
    };
    set_path("ROXI_NODE_BIN", &resources.join("node").join(node_name));
    set_path(
        "GATEWAY_SIDECAR_PATH",
        &resources.join("gateway").join("sidecar.js"),
    );
    set_path(
        "CHATBOT_SIDECAR_PATH",
        &resources.join("chatbot").join("sidecar.js"),
    );
    set_path("QDRANT_BIN", &resources.join("qdrant").join(qdrant_name));

    tracing::info!(
        "[bundle] running from {}; data in {}",
        resources.display(),
        data.display()
    );
}

fn load_runtime_config(resources: &Path) {
    let path = resources.join("runtime-config.json");
    let bytes = std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "missing packaged runtime configuration {}: {e}",
            path.display()
        )
    });
    let config: RuntimeConfig = serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        panic!(
            "invalid packaged runtime configuration {}: {e}",
            path.display()
        )
    });

    if config.environment == "production" {
        let lower = config.api_url.to_ascii_lowercase();
        assert!(
            lower.starts_with("https://")
                && !lower.contains("localhost")
                && !lower.contains("127.0.0.1"),
            "production ROXI_API_URL must be a public HTTPS endpoint"
        );
        assert!(
            !config.direct_provider_access,
            "direct provider access is forbidden in production desktop builds"
        );
    }

    set_default("ROXI_API_URL", config.api_url);
    set_default("SUPABASE_URL", config.supabase_url);
    set_default("SUPABASE_ANON_KEY", config.supabase_anon_key);
    set_default("ROXI_ENVIRONMENT", config.environment);
    set_default("ROXI_RELEASE_CHANNEL", config.release_channel);
}

/// The Node executable the sidecars run under: the bundled one in a release,
/// whatever `node` is on PATH in dev.
pub fn node_bin() -> PathBuf {
    match std::env::var("ROXI_NODE_BIN") {
        Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
        _ => PathBuf::from("node"),
    }
}
