//! Where the three SQLite databases live.
//!
//! One module because the resolution rule is identical for all of them and was
//! previously copy-pasted per adapter: walk out of `src-tauri` if that is the
//! working directory (which it is under `tauri dev`), then descend into the
//! runtime that owns the file. Three copies of that rule meant three places to
//! fix when packaging moved the working directory.
//!
//! Each path is overridable by the same environment variable the owning runtime
//! reads, so a test or a packaged bundle points every process at one file:
//!
//! | Database            | Env var             | Owner                       |
//! |---------------------|---------------------|------------------------------|
//! | `meeting_history.db`| `MEETING_DB_PATH`   | gateway (sole writer)       |
//! | `llm_usage.db`      | `LLM_USAGE_DB`      | Rust (`usage_store`)        |
//! | `doc_store.db`      | `CHATBOT_DOC_DB`    | chatbot (Rust reads only)   |
//! | Qdrant storage dir  | `QDRANT_STORAGE_DIR`| Qdrant sidecar (Rust-spawned, chatbot-consumed) |

use std::path::PathBuf;

/// The repository root, whether the process started there or in `src-tauri`.
fn repo_root() -> PathBuf {
    let mut path = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if path.ends_with("src-tauri") {
        path.pop();
    }
    path
}

fn from_env_or(var: &str, fallback: impl FnOnce() -> PathBuf) -> PathBuf {
    match std::env::var(var) {
        Ok(value) if !value.trim().is_empty() => PathBuf::from(value),
        _ => fallback(),
    }
}

/// Meetings, transcripts, chunks, decisions, glossary, speakers.
pub fn meeting_history_db() -> PathBuf {
    from_env_or("MEETING_DB_PATH", || {
        repo_root().join("gateway").join("meeting_history.db")
    })
}

/// One row per LLM call, read by `dashboard/`.
pub fn llm_usage_db() -> PathBuf {
    from_env_or("LLM_USAGE_DB", || {
        repo_root().join("gateway").join("llm_usage.db")
    })
}

/// Uploaded documents and their embedded chunks. Owned by the chatbot; Rust
/// opens it read-only for the brief's one-shot pre-retrieval.
pub fn doc_store_db() -> PathBuf {
    from_env_or("CHATBOT_DOC_DB", || {
        repo_root()
            .join("chatbot")
            .join("data")
            .join("doc_store.db")
    })
}

/// Where the Qdrant sidecar persists its collections (episodic + semantic
/// memory, per the Meeting Semantic Memory plan). Co-located with
/// `meeting_history.db`/`llm_usage.db` rather than under `chatbot/`: Qdrant
/// is shared infrastructure Rust spawns and the chatbot alone talks vectors
/// to — the same "not exclusively owned by one runtime" situation
/// `llm_usage.db` is already in.
pub fn qdrant_storage_dir() -> PathBuf {
    from_env_or("QDRANT_STORAGE_DIR", || {
        repo_root().join("gateway").join("qdrant_storage")
    })
}

/// Seconds of free-trial capture this Mac has used. A small JSON file rather
/// than a table: nothing else reads it, and it has to exist before any
/// database has been created.
pub fn trial_ledger() -> PathBuf {
    from_env_or("ROXI_TRIAL_FILE", || {
        repo_root().join("gateway").join("trial.json")
    })
}
