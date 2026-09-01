mod adapters;
mod agents;
mod application;
#[cfg(target_os = "macos")]
mod macos_overlay;
mod commands;
mod domain;
mod ports;
mod resample;
mod sidecar;
mod streaming;
mod wav_sink;

use adapters::chat_client::NodeChatClient;
use adapters::gateway_client::NodeGatewayClient;
use adapters::mac_audio::MacAudioCapture;
use adapters::sqlite::SqliteDatabase;
use application::capture_usecase::CaptureUseCase;
use ports::chat_gateway::ChatGatewayClient;
use ports::db::Database;
use std::sync::Arc;
use tauri::Manager;
use agents::ports::agent_port::Agent;
use agents::ports::llm_port::LlmClient;

use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. Initialize Adapters
    let audio_capture = Arc::new(MacAudioCapture::new());
    let gateway_client = Arc::new(NodeGatewayClient::new());
    let db: Arc<dyn Database> = Arc::new(SqliteDatabase::new());
    let chat_client: Arc<dyn ChatGatewayClient> = Arc::new(NodeChatClient::new());

    // Initialize Rust Native Agents
    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
    let llm: Arc<dyn LlmClient> = Arc::new(agents::adapters::openai_adapter::OpenAiAdapter::new(
        &api_key, 
        "gpt-4o-mini"
    ));

    let context_mgr: Arc<dyn Agent> = Arc::new(agents::agents::context_manager::ContextManagerAgent::new(Arc::clone(&llm)));
    let explanation: Arc<dyn Agent> = Arc::new(agents::agents::explanation::ExplanationAgent::new(Arc::clone(&llm)));
    let technical: Arc<dyn Agent> = Arc::new(agents::agents::technical::TechnicalAgent::new(Arc::clone(&llm)));
    let analyst: Arc<dyn Agent> = Arc::new(agents::agents::analyst::AnalystAgent::new(Arc::clone(&llm)));
    let risk: Arc<dyn Agent> = Arc::new(agents::agents::risk_detector::RiskDetectorAgent::new(Arc::clone(&llm)));
    let response: Arc<dyn Agent> = Arc::new(agents::agents::response_agent::ResponseAgent::new(Arc::clone(&llm)));

    let graph = Arc::new(agents::orchestrator::chunk_graph::ChunkGraph::new(
        context_mgr,
        vec![explanation, technical, analyst, risk],
        response,
    ));

    // 2. Initialize Use Cases
    let capture_usecase = Arc::new(CaptureUseCase::new(audio_capture, gateway_client));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(),
        )
        .manage(capture_usecase)
        .manage(db)
        .manage(chat_client)
        .manage(graph)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                // No Dock icon, no Cmd+Tab entry, no Force Quit listing
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);

                let win = app.get_webview_window("main").expect("main window missing");

                // THE SHIELD — invisible to screenshots, screen recording, screen share
                win.set_content_protected(true)?;

                // Float above all normal windows
                win.set_always_on_top(true)?;

                // No native vibrancy here — the window is fully transparent so
                // the desktop shows through pixel-sharp. The faint card tints
                // in the web layer provide just enough contrast to read text.

                // Stay visible over fullscreen meeting windows (Zoom / Meet / Teams)
                macos_overlay::make_overlay(&win)?;

                // Global hotkey: Option+Space toggles the window
                app.global_shortcut().register("Option+Space")?;

                // Menu-bar lifeline: tray icon with Show/Hide/Quit
                let show = tauri::menu::MenuItem::with_id(app, "show", "Show Roxi", true, None::<&str>)?;
                let hide = tauri::menu::MenuItem::with_id(app, "hide", "Hide Roxi", true, None::<&str>)?;
                let quit = tauri::menu::MenuItem::with_id(app, "quit", "Quit Roxi", true, None::<&str>)?;
                let menu = tauri::menu::Menu::with_items(app, &[&show, &hide, &quit])?;

                tauri::tray::TrayIconBuilder::with_id("roxi-tray")
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.hide();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture::start_capture,
            commands::capture::stop_capture,
            commands::audio_devices::check_blackhole_installed,
            commands::db::get_meetings,
            commands::db::get_meeting_details,
            commands::chat::ask_chat,
            commands::chat::close_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
