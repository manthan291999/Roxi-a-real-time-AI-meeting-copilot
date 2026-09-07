use chrono::Utc;
use rusqlite::{params, Connection};
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;

const REQUEST_MESSAGES_MAX: usize = 16000;
const RESPONSE_PREVIEW_MAX: usize = 2000;
const ERROR_MESSAGE_MAX: usize = 500;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS llm_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  source TEXT NOT NULL,
  tag TEXT,
  provider TEXT NOT NULL DEFAULT 'openai',
  endpoint TEXT,
  model TEXT,
  expect_json INTEGER NOT NULL DEFAULT 0,
  max_tokens INTEGER,
  timeout_ms INTEGER,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  request_messages TEXT,
  response_preview TEXT,
  pid INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_requests_ts ON llm_requests (ts);
CREATE INDEX IF NOT EXISTS idx_llm_requests_tag ON llm_requests (tag);
CREATE INDEX IF NOT EXISTS idx_llm_requests_status ON llm_requests (status);
";

#[derive(Debug, Clone)]
pub struct UsageEntry {
    pub tag: Option<String>,
    pub model: String,
    pub expect_json: bool,
    pub status: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub latency_ms: i64,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub system_prompt: String,
    pub user_prompt: String,
    pub response_text: Option<String>,
}

pub struct UsageStore;

impl UsageStore {
    fn resolve_db_path() -> PathBuf {
        if let Ok(custom) = std::env::var("LLM_USAGE_DB") {
            if !custom.is_empty() {
                return PathBuf::from(custom);
            }
        }

        let mut path = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        if path.ends_with("src-tauri") {
            path.pop();
        }
        path.push("gateway");
        path.push("llm_usage.db");
        path
    }

    fn calculate_cost(model: &str, prompt_tokens: i64, completion_tokens: i64) -> f64 {
        let (input_rate, output_rate) = match model {
            "gpt-5.6-luna" => (0.15, 0.60),
            "openai/gpt-oss-20b" => (0.20, 0.60),
            "openai/gpt-oss-120b" => (0.90, 0.90),
            "llama-3.3-70b-versatile" => (0.59, 0.79),
            "gemma2-9b-it" => (0.20, 0.20),
            "gpt-4o-mini" => (0.15, 0.60),
            "gpt-4o" => (2.50, 10.00),
            _ => (0.50, 0.50), // default fallback per 1M tokens
        };

        ((prompt_tokens as f64) / 1_000_000.0) * input_rate
            + ((completion_tokens as f64) / 1_000_000.0) * output_rate
    }

    fn truncate(s: &str, max: usize) -> String {
        if s.len() <= max {
            s.to_string()
        } else {
            // Byte-slicing a str panics if `max` lands inside a multi-byte
            // character, which LLM output (em dashes, curly quotes) routinely
            // produces. Walk back to the nearest boundary at or below `max`.
            let mut end = max;
            while end > 0 && !s.is_char_boundary(end) {
                end -= 1;
            }
            let mut truncated = s[..end].to_string();
            truncated.push_str("…[truncated]");
            truncated
        }
    }

    /// Records an LLM call to SQLite. Best effort — never panics or bubbles errors to caller.
    pub fn record(entry: UsageEntry) {
        if std::env::var("LLM_USAGE_TRACKING").map(|v| v == "0").unwrap_or(false) {
            return;
        }

        let db_path = Self::resolve_db_path();

        let res = (|| -> Result<(), rusqlite::Error> {
            let conn = Connection::open(&db_path)?;
            let _ = conn.pragma_update(None, "journal_mode", "WAL");
            let _ = conn.busy_timeout(Duration::from_millis(3000));
            conn.execute_batch(SCHEMA)?;

            let ts = Utc::now().to_rfc3339();
            let source = "rust".to_string();
            let provider = "openai".to_string();
            let endpoint = Some("https://api.openai.com/v1/chat/completions".to_string());
            let pid = std::process::id() as i64;

            // Estimate tokens if not provided: ~4 chars per token
            let prompt_tokens = entry.prompt_tokens.unwrap_or_else(|| {
                let total_chars = entry.system_prompt.len() + entry.user_prompt.len();
                ((total_chars / 4).max(1)) as i64
            });

            let completion_tokens = entry.completion_tokens.unwrap_or_else(|| {
                if let Some(ref text) = entry.response_text {
                    ((text.len() / 4).max(1)) as i64
                } else {
                    0
                }
            });

            let total_tokens = prompt_tokens + completion_tokens;

            let cost_usd = if entry.status == "ok" {
                Self::calculate_cost(&entry.model, prompt_tokens, completion_tokens)
            } else {
                0.0
            };

            let track_payloads = std::env::var("LLM_TRACK_PAYLOADS").map(|v| v != "0").unwrap_or(true);

            let request_messages = if track_payloads {
                let msgs = json!([
                    { "role": "system", "content": entry.system_prompt },
                    { "role": "user", "content": entry.user_prompt }
                ]);
                let serialized = msgs.to_string();
                Some(Self::truncate(&serialized, REQUEST_MESSAGES_MAX))
            } else {
                None
            };

            let response_preview = if track_payloads {
                entry.response_text.as_ref().map(|text| Self::truncate(text, RESPONSE_PREVIEW_MAX))
            } else {
                None
            };

            let error_message = entry.error_message.as_ref().map(|msg| Self::truncate(msg, ERROR_MESSAGE_MAX));

            conn.execute(
                "INSERT INTO llm_requests (
                    ts, source, tag, provider, endpoint, model, expect_json, max_tokens, timeout_ms,
                    status, error_code, error_message, attempts, latency_ms,
                    prompt_tokens, completion_tokens, total_tokens, cost_usd,
                    request_messages, response_preview, pid
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
                params![
                    ts,
                    source,
                    entry.tag,
                    provider,
                    endpoint,
                    entry.model,
                    if entry.expect_json { 1 } else { 0 },
                    None::<i64>, // max_tokens
                    None::<i64>, // timeout_ms
                    entry.status,
                    entry.error_code,
                    error_message,
                    1, // attempts
                    entry.latency_ms,
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                    cost_usd,
                    request_messages,
                    response_preview,
                    pid
                ],
            )?;

            Ok(())
        })();

        if let Err(e) = res {
            tracing::error!("[UsageStore] Failed to write LLM usage record: {:?}", e);
        }
    }
}
