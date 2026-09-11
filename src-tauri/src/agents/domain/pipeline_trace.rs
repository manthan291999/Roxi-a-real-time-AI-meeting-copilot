use serde::{Deserialize, Serialize};
use super::chunk_state::Complexity;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSpan {
    pub name: String,
    pub stage: u8,
    pub latency_ms: u64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineTrace {
    pub chunk_preview: String,
    pub speaker: String,
    pub complexity: String,
    pub spans: Vec<AgentSpan>,
    pub total_ms: u64,
    pub cost_usd: f64,
}

impl PipelineTrace {
    pub fn new(chunk_text: &str, speaker: &str, complexity: &Complexity) -> Self {
        let chunk_preview = if chunk_text.len() > 80 {
            format!("{}…", &chunk_text[..80].replace('\n', " "))
        } else {
            chunk_text.replace('\n', " ")
        };

        let complexity_str = match complexity {
            Complexity::Low => "LOW",
            Complexity::Medium => "MEDIUM",
            Complexity::High => "HIGH",
        }.to_string();

        Self {
            chunk_preview,
            speaker: speaker.to_string(),
            complexity: complexity_str,
            spans: Vec::new(),
            total_ms: 0,
            cost_usd: 0.0, // We could hook this to UsageStore later, but for now 0.0 or a rough estimate
        }
    }

    pub fn add_span(&mut self, name: &str, stage: u8, latency_ms: u64, status: &str) {
        self.spans.push(AgentSpan {
            name: name.to_string(),
            stage,
            latency_ms,
            status: status.to_string(),
        });
    }

    pub fn log_summary(&self) {
        let agents_run = self.spans.iter().filter(|s| s.status == "OK").count();

        // One-line summary, always visible at INFO.
        tracing::info!(
            "chunk → {agents_run} agents  complexity={}  total={}ms",
            self.complexity,
            self.total_ms
        );

        // Full per-stage breakdown, only built and printed when RUST_LOG=debug
        // — same information as before, just no longer competing with every
        // other line's format by default.
        if tracing::enabled!(tracing::Level::DEBUG) {
            let mut out = String::new();
            out.push_str(&format!("┌─ CHUNK  speaker={}  complexity={} ──────────────────────────┐\n", self.speaker, self.complexity));

            for span in &self.spans {
                let parallel = if span.stage == 2 && span.status == "OK" { " [parallel]" } else { "" };
                let line = format!("│  Stage {}  {:<15} → {:<5} ({:3}ms){}\n",
                    span.stage, span.name, span.status, span.latency_ms, parallel);
                out.push_str(&line);
            }

            out.push_str(&format!("└─ DONE  {agents_run} agents  {}ms ─────────────────────────────────────┘", self.total_ms));

            tracing::debug!("\n{}", out);
        }
    }
}
