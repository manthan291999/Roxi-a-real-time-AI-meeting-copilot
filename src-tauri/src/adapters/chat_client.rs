use crate::ports::chat_gateway::ChatGatewayClient;
use anyhow::{anyhow, Result};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

struct ChatSession {
    child: Child,
    stdin: ChildStdin,
}

/// Spawns and talks to `chatbot/sidecar.js` (LangGraph chatbot) over stdio.
/// Mirrors NodeGatewayClient's process-management conventions.
pub struct NodeChatClient {
    session: Arc<Mutex<Option<ChatSession>>>,
}

impl NodeChatClient {
    pub fn new() -> Self {
        Self {
            session: Arc::new(Mutex::new(None)),
        }
    }
}

impl ChatGatewayClient for NodeChatClient {
    fn start_session(&self, on_event: Box<dyn Fn(String) + Send + 'static>) -> Result<()> {
        let mut session_lock = self.session.lock().map_err(|e| anyhow::anyhow!("Mutex poisoned: {}", e))?;
        if session_lock.is_some() {
            return Ok(()); // already running; existing listener stays bound
        }

        let current_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let sidecar_path = std::env::var("CHATBOT_SIDECAR_PATH")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| current_dir.join("../chatbot/sidecar.js"));
            
        let sidecar_dir = sidecar_path.parent().unwrap_or_else(|| std::path::Path::new("."));

        let mut cmd = Command::new("node");
        cmd.arg(&sidecar_path);

        let mut child = cmd
            .current_dir(sidecar_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| anyhow!("Failed to start chat sidecar: {}", e))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("Failed to open chat sidecar stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("Failed to open chat sidecar stdout"))?;

        *session_lock = Some(ChatSession { child, stdin });

        // stdout listener thread -> protocol router callback
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => on_event(text),
                    Err(_) => {
                        tracing::warn!("[chat sidecar] Stdout closed.");
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    fn send(&self, line: String) -> Result<()> {
        let mut session_lock = self.session.lock().map_err(|e| anyhow::anyhow!("Mutex poisoned: {}", e))?;
        let session = session_lock
            .as_mut()
            .ok_or_else(|| anyhow!("Chat sidecar is not running"))?;
        session
            .stdin
            .write_all(line.as_bytes())
            .map_err(|e| anyhow!("Failed to write to chat sidecar: {}", e))?;
        session
            .stdin
            .write_all(b"\n")
            .map_err(|e| anyhow!("Failed to terminate chat message: {}", e))?;
        session
            .stdin
            .flush()
            .map_err(|e| anyhow!("Failed to flush chat message: {}", e))
    }

    fn stop_session(&self) -> Result<()> {
        let mut session_lock = self.session.lock().map_err(|e| anyhow::anyhow!("Mutex poisoned: {}", e))?;
        if let Some(mut session) = session_lock.take() {
            // Graceful: ask the sidecar to shut itself down first.
            let _ = session.stdin.write_all(b"{\"type\":\"Shutdown\"}\n");
            let _ = session.stdin.flush();

            let pid = session.child.id();
            let signaled = signal_term(pid);

            if signaled {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
                while std::time::Instant::now() < deadline {
                    match session.child.try_wait() {
                        Ok(Some(_status)) => return Ok(()),
                        Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
                        Err(_) => break,
                    }
                }
                tracing::warn!("[chat sidecar] Graceful shutdown timed out; force killing.");
            }
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
        Ok(())
    }
}

#[cfg(unix)]
fn signal_term(pid: u32) -> bool {
    unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) == 0 }
}

#[cfg(not(unix))]
fn signal_term(_pid: u32) -> bool {
    false
}
