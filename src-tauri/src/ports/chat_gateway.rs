use anyhow::Result;

/// Port for the Ask-Roxi chatbot sidecar (Node/LangGraph process).
///
/// Lifecycle is lazy: `start_session` spawns the sidecar on first use and is
/// idempotent while running; `send` writes one protocol line; `stop_session`
/// performs a graceful shutdown (Shutdown message -> SIGTERM -> kill).
pub trait ChatGatewayClient: Send + Sync {
    /// Ensure the chat sidecar is running; bind stdout lines to `on_event`.
    fn start_session(&self, on_event: Box<dyn Fn(String) + Send + 'static>) -> Result<()>;
    /// Write one line-delimited JSON protocol message to the sidecar stdin.
    fn send(&self, line: String) -> Result<()>;
    /// Gracefully stop the sidecar process (idempotent).
    fn stop_session(&self) -> Result<()>;
}
