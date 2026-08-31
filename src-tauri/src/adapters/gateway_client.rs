use crate::ports::gateway::GatewayClient;
use anyhow::{anyhow, Result};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

pub struct NodeGatewayClient {
    sidecar: Arc<Mutex<Option<Child>>>,
}

impl NodeGatewayClient {
    pub fn new() -> Self {
        Self {
            sidecar: Arc::new(Mutex::new(None)),
        }
    }
}

impl GatewayClient for NodeGatewayClient {
    fn start_session(
        &self,
        context: Option<String>,
        role: Option<String>,
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

        if let Some(ctx) = context {
            if !ctx.trim().is_empty() {
                cmd.arg("--context").arg(ctx);
            }
        }
        
        if let Some(r) = role {
            if !r.trim().is_empty() {
                cmd.arg("--role").arg(r);
            }
        }

        let mut sidecar_process = cmd
            .current_dir(current_dir.join("../gateway"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
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

        *sidecar_lock = Some(sidecar_process);

        // Start stdout listener thread
        thread::spawn(move || {
            let reader = BufReader::new(sidecar_stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => on_event(text),
                    Err(_) => break, // Pipe closed
                }
            }
            eprintln!("[sidecar] Stdout closed.");
        });

        Ok(Box::new(sidecar_stdin))
    }

    fn stop_session(&self) -> Result<()> {
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
                eprintln!("[sidecar] Graceful shutdown timed out; force killing.");
            }
            let _ = child.kill();
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
