use tauri::{AppHandle, Emitter, Manager};
use super::events::{SidecarEvent, TranscriptPayload, ExplanationPayload, ResponsePayload};
use crate::agents::orchestrator::chunk_graph::ChunkGraph;
use std::sync::Arc;

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
                    // 1. Emit the final transcript instantly to the UI
                    let _ = app.emit("transcript_final", TranscriptPayload { text: t.clone(), speaker: s.clone(), stt_label: event.stt_label });
                    
                    // 2. Intercept and run the Rust Native ChunkGraph
                    let app_clone = app.clone();
                    
                    tauri::async_runtime::spawn(async move {
                        match app_clone.try_state::<Arc<ChunkGraph>>() {
                            Some(graph) => {
                                let (state, trace) = graph.run(&t, &s).await;
                                
                                // Emit the trace for observability
                                let _ = app_clone.emit("agent_trace", trace);

                                // Emit the results of the Rust agents
                                if let Some(expl) = state.explanation {
                                    let _ = app_clone.emit("context_explanation", ExplanationPayload { text: expl, speaker: s.clone() });
                                }
                                if let Some(tech) = state.technical_explanation {
                                    let _ = app_clone.emit("technical_explanation", ExplanationPayload { text: tech, speaker: s.clone() });
                                }
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
                                    let _ = app_clone.emit("suggested_response", ResponsePayload { 
                                        text: resp, 
                                        speaker: s.clone(), 
                                        reply_type: state.suggested_response_type 
                                    });
                                }
                            }
                            None => {
                                tracing::error!("[event_router] CRITICAL: ChunkGraph not found in Tauri state — LLM agents will not run. Was .manage(graph) called in lib.rs?");
                            }
                        }
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
                    let _ = app.emit("suggested_response", ResponsePayload { text: t, speaker: s, reply_type: event.reply_type });
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
