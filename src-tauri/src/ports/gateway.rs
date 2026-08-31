use anyhow::Result;
use std::io::Write;

pub trait GatewayClient: Send + Sync {
    fn start_session(&self, context: Option<String>, role: Option<String>, on_event: Box<dyn Fn(String) + Send + 'static>) -> Result<Box<dyn Write + Send>>;
    fn stop_session(&self) -> Result<()>;
    fn is_running(&self) -> bool;
}
