//! One shared terminal log format for Roxi's three cooperating processes.
//!
//! This Rust core logs through `tracing` directly. The gateway and chatbot
//! Node sidecars each already print structured JSON log lines of their own
//! (see `gateway/infrastructure/logger.js` and
//! `chatbot/src/infrastructure/logging/JsonLineLogger.js`) to their own
//! stderr — [`relay_sidecar_log`] is how those get parsed and re-emitted
//! through this same formatter, tagged by source, instead of the terminal
//! showing four unrelated formats interleaved at random.
//!
//! Nothing here changes *what* gets logged or filtered — `RUST_LOG` /
//! `LOG_LEVEL` / `CHATBOT_LOG_LEVEL` still gate verbosity exactly as before.
//! This only changes how a line, once it's going to be printed, looks.

use serde_json::Value;
use std::fmt;
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::registry::LookupSpan;

const RESET: &str = "\x1b[0m";
const DIM: &str = "\x1b[2m";

fn level_label(level: &Level) -> &'static str {
    match *level {
        Level::ERROR => "ERROR",
        Level::WARN => "WARN ",
        Level::INFO => "INFO ",
        Level::DEBUG => "DEBUG",
        Level::TRACE => "TRACE",
    }
}

fn level_color(level: &Level) -> &'static str {
    match *level {
        Level::ERROR => "\x1b[38;5;210m",
        Level::WARN => "\x1b[38;5;222m",
        Level::INFO => "\x1b[38;5;110m",
        Level::DEBUG | Level::TRACE => "\x1b[38;5;244m",
    }
}

/// Source tag shown in the fixed-width column between level and message.
/// Anything not explicitly the gateway or chatbot sidecar is this process
/// itself — labeled `app`, matching every one of our own `tracing::*!` call
/// sites, which never set an explicit `target`.
fn tag_and_color(target: &str) -> (&'static str, &'static str) {
    match target {
        "gateway" => ("gateway", "\x1b[38;5;114m"),
        "chatbot" => ("chatbot", "\x1b[38;5;176m"),
        _ => ("app", "\x1b[38;5;111m"),
    }
}

/// Collects a tracing event's `message` field separately from its other
/// structured fields, so the formatter can print `message  key=value ...`
/// instead of an unordered field dump. This is the same minimal-visitor
/// pattern most `tracing` formatting crates use.
#[derive(Default)]
struct FieldCollector {
    message: String,
    fields: Vec<(&'static str, String)>,
}

impl tracing::field::Visit for FieldCollector {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn fmt::Debug) {
        let rendered = format!("{value:?}");
        if field.name() == "message" {
            self.message = rendered;
        } else {
            self.fields.push((field.name(), rendered));
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else {
            self.fields.push((field.name(), value.to_string()));
        }
    }
}

/// The formatter itself: `HH:MM:SS.mmm  LEVEL  tag      message  k=v k2=v2`.
pub struct RoxiFormatter;

impl<S, N> FormatEvent<S, N> for RoxiFormatter
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        _ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        let meta = event.metadata();
        let (tag, tag_color) = tag_and_color(meta.target());

        let mut collector = FieldCollector::default();
        event.record(&mut collector);

        let ts = chrono::Local::now().format("%H:%M:%S%.3f");

        write!(
            writer,
            "{DIM}{ts}{RESET}  {}{:<5}{RESET}  {tag_color}{:<7}{RESET}  {}",
            level_color(meta.level()),
            level_label(meta.level()),
            tag,
            collector.message,
        )?;

        for (key, value) in &collector.fields {
            write!(writer, "  {DIM}{key}={value}{RESET}")?;
        }

        writeln!(writer)
    }
}

/// Prints the boxed startup summary once, right after `.env` is loaded — the
/// first thing a developer sees instead of scattered boot noise. Reads only
/// environment variables already available at that point; it doesn't probe
/// any adapter or change when/whether anything starts.
pub fn print_startup_banner() {
    let openai_configured = std::env::var("OPENAI_API_KEY")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);

    // Mirrors the gateway's own provider precedence (STT_PROVIDER override,
    // then AssemblyAI, then Speechmatics) purely for display — the gateway
    // sidecar still makes the real decision independently.
    let stt_provider = std::env::var("STT_PROVIDER")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .or_else(|| {
            std::env::var("ASSEMBLYAI_API_KEY")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .map(|_| "assemblyai".to_string())
        })
        .or_else(|| {
            std::env::var("SPEECHMATICS_API_KEY")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .map(|_| "speechmatics".to_string())
        });

    let ok = "\x1b[38;5;114m";
    let bad = "\x1b[38;5;210m";
    let accent = "\x1b[38;5;111m";
    let dim = DIM;
    let reset = RESET;

    println!("{accent}┌─ Roxi · dev ──────────────────────────────────────────────{reset}");
    if openai_configured {
        println!("{accent}│{reset}  {ok}✓{reset} openai         configured");
    } else {
        println!(
            "{accent}│{reset}  {bad}✗{reset} openai         not set — agents will fail with 401"
        );
    }
    match stt_provider {
        Some(provider) => println!("{accent}│{reset}  {ok}✓{reset} stt provider   {provider}"),
        None => println!("{accent}│{reset}  {bad}✗{reset} stt provider   no ASSEMBLYAI_API_KEY / SPEECHMATICS_API_KEY set"),
    }
    println!("{accent}└───────────────────────────────────────────────────────────{dim} (RUST_LOG=debug for full detail){reset}");
}

/// Parses one line from a sidecar's structured stderr log and re-emits it
/// through this same formatter, tagged `source` ("gateway" or "chatbot").
/// A line that isn't valid JSON — an uncaught Node stack trace, an npm
/// warning — is never dropped, only printed as-is at WARN under the same
/// tag, since it's still worth seeing, just not a log line we can parse.
pub fn relay_sidecar_log(source: &'static str, line: &str) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }

    let Some(parsed) = serde_json::from_str::<Value>(line)
        .ok()
        .and_then(|v| v.as_object().cloned())
    else {
        emit(source, "warn", line);
        return;
    };

    let level = parsed
        .get("level")
        .and_then(Value::as_str)
        .unwrap_or("info");
    let event = parsed.get("event").and_then(Value::as_str).unwrap_or("log");

    // Gateway's logger flattens extra fields onto the top-level object;
    // chatbot's nests them under `meta`. Either shape is accepted so this
    // relay keeps working even if one sidecar's schema drifts from the
    // other's — see gateway/infrastructure/logger.js vs
    // chatbot/src/infrastructure/logging/JsonLineLogger.js.
    let extra = parsed
        .get("meta")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(|| {
            let mut rest = parsed.clone();
            for known in ["ts", "level", "component", "scope", "event"] {
                rest.remove(known);
            }
            rest
        });

    let kv = extra
        .iter()
        .map(|(k, v)| format!("{k}={}", render_json_value(v)))
        .collect::<Vec<_>>()
        .join(" ");

    let message = if kv.is_empty() {
        event.to_string()
    } else {
        format!("{event}  {kv}")
    };
    emit(source, level, &message);
}

fn render_json_value(value: &Value) -> String {
    match value {
        Value::String(s) if s.contains(char::is_whitespace) => format!("{s:?}"),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn emit(source: &'static str, level: &str, message: &str) {
    match (source, level) {
        ("gateway", "error") => tracing::error!(target: "gateway", "{message}"),
        ("gateway", "warn") => tracing::warn!(target: "gateway", "{message}"),
        ("gateway", "debug") => tracing::debug!(target: "gateway", "{message}"),
        ("gateway", _) => tracing::info!(target: "gateway", "{message}"),
        ("chatbot", "error") => tracing::error!(target: "chatbot", "{message}"),
        ("chatbot", "warn") => tracing::warn!(target: "chatbot", "{message}"),
        ("chatbot", "debug") => tracing::debug!(target: "chatbot", "{message}"),
        (_, _) => tracing::info!(target: "chatbot", "{message}"),
    }
}
