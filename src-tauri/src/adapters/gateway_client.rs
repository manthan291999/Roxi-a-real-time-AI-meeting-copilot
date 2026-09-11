use crate::ports::gateway::{GatewayClient, SessionRequest};
use anyhow::{anyhow, Result};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub struct NodeGatewayClient {
    sidecar: Arc<Mutex<Option<Child>>>,
    /// Set before signaling the sidecar in `stop_session`, so the stdout
    /// reader thread can tell an intentional stop from the process dying on
    /// its own — only the latter should synthesize an error event.
    stopping: Arc<AtomicBool>,
}

impl NodeGatewayClient {
    pub fn new() -> Self {
        Self {
            sidecar: Arc::new(Mutex::new(None)),
            stopping: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl GatewayClient for NodeGatewayClient {
    fn start_session(
        &self,
        request: SessionRequest,
        on_event: Box<dyn Fn(String) + Send + 'static>,
    ) -> Result<Box<dyn Write + Send>> {
        let mut sidecar_lock = self.sidecar.lock().unwrap();
        if sidecar_lock.is_some() {
            return Err(anyhow!("Gateway sidecar is already running"));
        }

        let current_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let sidecar_path = current_dir.join("../gateway/sidecar.js");

        let mut cmd = Command::new("node");
        cmd.arg(&sidecar_path);

        if let Some(n) = request.name {
            if !n.trim().is_empty() {
                cmd.arg("--meeting-name").arg(n);
            }
        }

        if let Some(ctx) = request.context {
            if !ctx.trim().is_empty() {
                cmd.arg("--context").arg(ctx);
            }
        }

        if let Some(r) = request.role {
            if !r.trim().is_empty() {
                cmd.arg("--role").arg(r);
            }
        }

        // The project is resolved on this side, so the gateway receives an id
        // it can trust and never has to create a taxonomy row mid-capture. The
        // code comes along so `display_id` can be built without a second query.
        if let Some(project) = request.project {
            cmd.arg("--project-id").arg(project.id.value().to_string());
            cmd.arg("--project-code").arg(project.code);
        }

        let mut sidecar_process = cmd
            .current_dir(current_dir.join("../gateway"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| anyhow!("Failed to start Node.js sidecar: {}", e))?;

        let sidecar_stdin = sidecar_process
            .stdin
            .take()
            .ok_or_else(|| anyhow!("Failed to open sidecar stdin"))?;
        let sidecar_stdout = sidecar_process
            .stdout
            .take()
            .ok_or_else(|| anyhow!("Failed to open sidecar stdout"))?;
        let sidecar_stderr = sidecar_process
            .stderr
            .take()
            .ok_or_else(|| anyhow!("Failed to open sidecar stderr"))?;

        *sidecar_lock = Some(sidecar_process);
        self.stopping.store(false, Ordering::SeqCst);

        // Start stdout listener thread
        let stopping = self.stopping.clone();
        thread::spawn(move || {
            let reader = BufReader::new(sidecar_stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => on_event(text),
                    Err(_) => break,
                }
            }

            // The loop above only ends when stdout closes — the sidecar
            // process exited. If that wasn't triggered by our own
            // stop_session (which sets `stopping` first), the process died
            // on its own and never got a chance to report why over its
            // normal Error/ProviderStatus protocol lines: without this, the
            // frontend has no signal at all and the UI just freezes on
            // whatever status it last showed.
            if !stopping.load(Ordering::SeqCst) {
                tracing::warn!("[sidecar] Stdout closed unexpectedly — sidecar process likely died.");
                let synthetic = serde_json::json!({
                    "type": "Error",
                    "message": "Transcription process ended unexpectedly"
                })
                .to_string();
                on_event(synthetic);
            } else {
                tracing::info!("[sidecar] Stdout closed.");
            }
        });

        // stderr carries the gateway's own structured log lines (see
        // gateway/infrastructure/logger.js) — parsed and re-emitted through
        // this process's own formatter (crate::logging) instead of being
        // inherited raw into the terminal.
        thread::spawn(move || {
            let reader = BufReader::new(sidecar_stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => crate::logging::relay_sidecar_log("gateway", &text),
                    Err(_) => break,
                }
            }
        });

        Ok(Box::new(sidecar_stdin))
    }

    fn stop_session(&self) -> Result<()> {
        // Set before signaling: the stdout reader thread checks this the
        // moment the pipe closes, which can race the kill signal below.
        self.stopping.store(true, Ordering::SeqCst);
        let mut sidecar_lock = self.sidecar.lock().unwrap();
        if let Some(mut child) = sidecar_lock.take() {
            let pid = child.id();
            let signaled = signal_term(pid);

            if signaled {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
                while std::time::Instant::now() < deadline {
                    match child.try_wait() {
                        Ok(Some(_status)) => return Ok(()),
                        Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
                        Err(_) => break,
                    }
                }
                tracing::warn!("[sidecar] Graceful shutdown timed out; force killing.");
                let _ = child.kill();
            }
            let _ = child.wait();
        }
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.sidecar.lock().unwrap().is_some()
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
