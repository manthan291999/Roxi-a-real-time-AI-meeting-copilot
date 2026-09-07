use tauri::{AppHandle, Emitter, Manager};
use super::events::{SidecarEvent, TranscriptPayload, ExplanationPayload, ResponsePayload};
use super::persistence;
use crate::agents::orchestrator::chunk_graph::ChunkGraph;
use crate::application::capture_usecase::CaptureUseCase;
use std::sync::Arc;
use tokio::sync::Semaphore;

/// Ask the gateway to persist something. Best-effort: if no session is running,
/// or the pipe rejects the write, the UI is unaffected.
fn send_control(app: &AppHandle, command: &serde_json::Value) {
    if let Some(use_case) = app.try_state::<Arc<CaptureUseCase>>() {
        use_case.send_control(command);
    }
}

/// PERF FIX #2: Cap the number of concurrent in-flight LLM pipeline tasks.
/// Without this, a fast speaker produces Final events faster than the LLM can
/// process them (~5-8s/chunk), causing unbounded task accumulation → API 429
/// rate-limit errors → stale, out-of-order responses in the UI.
///
/// 3 concurrent tasks = ~15-24s of LLM budget in parallel, which is enough
/// for real-time meetings without saturating the OpenAI rate limit.
static PIPELINE_SEMAPHORE: std::sync::OnceLock<Arc<Semaphore>> = std::sync::OnceLock::new();

fn get_semaphore() -> Arc<Semaphore> {
    PIPELINE_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(3)))
        .clone()
}

/// Separate budget for the detached slow lane (risk / analyst). These run off the
/// reply path, so they must not hold a reply-path permit — but they still call the
/// API and still need a ceiling.
///
/// Unlike the reply path this lane SHEDS rather than queues: risks and decisions are
/// ambient enrichments, and a stale one arriving two minutes late is worth less than
/// not spending the call. `try_acquire_owned` drops the work when the lane is full.
static DETACHED_SEMAPHORE: std::sync::OnceLock<Arc<Semaphore>> = std::sync::OnceLock::new();

fn get_detached_semaphore() -> Arc<Semaphore> {
    DETACHED_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(4)))
        .clone()
}

pub fn route_sidecar_event(app: &AppHandle, text: &str) {
    if let Ok(event) = serde_json::from_str::<SidecarEvent>(text) {
        match event.event_type.as_str() {
            "Partial" => {
                if let Some(t) = event.text {
                    let s = event.speaker.unwrap_or_else(|| "Speaker A".to_string());
                    let _ = app.emit("transcript_partial", TranscriptPayload { text: t, speaker: s, stt_label: event.stt_label });
                }
            }
            "Final" => {
                if let Some(t) = event.text {
                    let s = event.speaker.unwrap_or_else(|| "Speaker A".to_string());
                    // 1. Emit the final transcript instantly to the UI — never blocked by LLM
                    let _ = app.emit("transcript_final", TranscriptPayload { text: t.clone(), speaker: s.clone(), stt_label: event.stt_label });
                    
                    // 2. Run the Rust Native ChunkGraph under backpressure semaphore
                    //    PERF FIX #2: acquire permit before spawning to cap concurrency at 3.
                    //    If 3 tasks are already in-flight, this blocks until one completes.
                    let app_clone = app.clone();
                    let sem = get_semaphore();
                    
                    tauri::async_runtime::spawn(async move {
                        // Acquire permit — auto-released when `_permit` is dropped at end of scope
                        let _permit = match sem.acquire_owned().await {
                            Ok(p) => p,
                            Err(_) => {
                                tracing::warn!("[event_router] Semaphore closed — dropping chunk for speaker {}", s);
                                return;
                            }
                        };
                        tracing::debug!("[event_router] Pipeline slot acquired for speaker={}", s);

                        match app_clone.try_state::<Arc<ChunkGraph>>() {
                            Some(graph) => {
                                let (state, trace, detached) = graph.run(&t, &s).await;

                                // Identifies this chunk to the gateway so the detached
                                // lane's artifacts can be attached to the same row.
                                //
                                // Sent BEFORE the detached lane is spawned: that lane's
                                // `persistArtifacts` references this chunkRef, so the row
                                // must already exist by the time it can arrive.
                                let chunk_ref = persistence::next_chunk_ref();
                                send_control(
                                    &app_clone,
                                    &persistence::persist_chunk_command(&chunk_ref, &t, &s, &state),
                                );

                                // Slow lane: risk / analyst run off the reply path. Hand them
                                // their own task and their own permit so the reply-path permit
                                // is released as soon as the suggestion is out.
                                if let Some(work) = detached {
                                    let app_detached = app_clone.clone();
                                    let speaker_detached = s.clone();
                                    let chunk_ref_detached = chunk_ref.clone();
                                    tauri::async_runtime::spawn(async move {
                                        let Ok(_slot) = get_detached_semaphore().try_acquire_owned() else {
                                            tracing::warn!(
                                                "[event_router] Detached lane saturated — shedding risk/analyst for speaker {}",
                                                speaker_detached
                                            );
                                            return;
                                        };
                                        let outcome = work.await;
                                        for span in &outcome.spans {
                                            tracing::info!(
                                                "[chunk_graph] detached {} → {} ({}ms)",
                                                span.name, span.status, span.latency_ms
                                            );
                                        }
                                        // Persist first: the emits below move these vectors
                                        // out of `outcome.state`.
                                        send_control(
                                            &app_detached,
                                            &persistence::persist_artifacts_command(
                                                &chunk_ref_detached,
                                                &outcome.state,
                                            ),
                                        );

                                        if !outcome.state.decisions.is_empty() {
                                            let _ = app_detached.emit("meeting_decisions", outcome.state.decisions);
                                        }
                                        if !outcome.state.action_items.is_empty() {
                                            let _ = app_detached.emit("meeting_action_items", outcome.state.action_items);
                                        }
                                        if !outcome.state.risks.is_empty() {
                                            let _ = app_detached.emit("meeting_risks", outcome.state.risks);
                                        }
                                    });
                                }

                                // Emit the trace for observability
                                let _ = app_clone.emit("agent_trace", trace);

                                // Emit the results of the Rust agents
                                if let Some(expl) = state.explanation {
                                    let _ = app_clone.emit("context_explanation", ExplanationPayload { text: expl, speaker: s.clone() });
                                }
                                if let Some(tech) = state.technical_explanation {
                                    let _ = app_clone.emit("technical_explanation", ExplanationPayload { text: tech, speaker: s.clone() });
                                }
                                // Kept as a safety net: today only the detached lane produces
                                // these, so on the reply path they are always empty. If an agent
                                // that emits them is ever moved back onto the fast lane, this
                                // stops the signal vanishing. The two lanes can never both carry
                                // items for one chunk, so there is no double-emit.
                                if !state.decisions.is_empty() {
                                    let _ = app_clone.emit("meeting_decisions", state.decisions);
                                }
                                if !state.action_items.is_empty() {
                                    let _ = app_clone.emit("meeting_action_items", state.action_items);
                                }
                                if !state.risks.is_empty() {
                                    let _ = app_clone.emit("meeting_risks", state.risks);
                                }
                                if let Some(resp) = state.suggested_response {
                                    let payload = ResponsePayload { 
                                        text: resp, 
                                        speaker: s.clone(), 
                                        reply_type: state.suggested_response_type,
                                        context_items: state.context_items
                                    };
                                    // PERF FIX: Emit ONLY 'suggest_answer' — do NOT also emit
                                    // 'suggested_response'. TauriEventBus subscribes to both and
                                    // deduplicates, but emitting both causes 2x deduplication work
                                    // and 2x state update attempts per suggestion card.
                                    let _ = app_clone.emit("suggest_answer", payload);
                                }
                            }
                            None => {
                                tracing::error!("[event_router] CRITICAL: ChunkGraph not found in Tauri state — LLM agents will not run. Was .manage(graph) called in lib.rs?");
                            }
                        }
                        tracing::debug!("[event_router] Pipeline slot released for speaker={}", s);
                    });
                }
            }
            "Explanation" => {
                if let Some(t) = event.text {
                    let s = event.speaker.unwrap_or_else(|| "Unknown".to_string());
                    let _ = app.emit("context_explanation", ExplanationPayload { text: t, speaker: s });
                }
            }
            "TechnicalExplanation" => {
                if let Some(t) = event.text {
                    let s = event.speaker.unwrap_or_else(|| "Unknown".to_string());
                    let _ = app.emit("technical_explanation", ExplanationPayload { text: t, speaker: s });
                }
            }
            "Significance" => {
                if let Some(l) = event.level {
                    let _ = app.emit("chunk_significance", l);
                }
            }
            "Decisions" => {
                if let Some(items) = event.items {
                    let _ = app.emit("meeting_decisions", items);
                }
            }
            "ActionItems" => {
                if let Some(items) = event.items {
                    let _ = app.emit("meeting_action_items", items);
                }
            }
            "Risks" => {
                if let Some(items) = event.items {
                    let _ = app.emit("meeting_risks", items);
                }
            }
            "Response" => {
                if let Some(t) = event.text {
                    let s = event.speaker.unwrap_or_else(|| "Unknown".to_string());
                    let _ = app.emit("suggested_response", ResponsePayload { 
                        text: t, 
                        speaker: s, 
                        reply_type: event.reply_type,
                        context_items: vec![] 
                    });
                }
            }
            "CircuitBreaker" => {
                let _ = app.emit("circuit_breaker", event.items);
            }
            "ApiHealth" => {
                let _ = app.emit("api_health", event.items);
            }
            "Billing" => {
                let _ = app.emit("billing", event.items);
            }
            "SpeakerRevision" => {
                let _ = app.emit("speaker_revision", event.revision);
            }
            "MeetingSummary" => {
                if let Some(t) = event.text {
                    let _ = app.emit("meeting_summary", t);
                }
            }
            "ProviderStatus" => {
                let payload = serde_json::json!({
                    "provider": event.provider,
                    "state": event.state,
                });
                let _ = app.emit("provider_status", payload);
            }
            "Error" => {
                let msg = event.message.unwrap_or_else(|| "Unknown".into());
                let _ = app.emit("capture_error", msg);
            }
            _ => {}
        }
    } else {
        tracing::warn!("[sidecar log] {}", text);
    }
}
