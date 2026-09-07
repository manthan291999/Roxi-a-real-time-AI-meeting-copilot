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

use adapters::chat_client::NodeChatClient;
use adapters::gateway_client::NodeGatewayClient;
use adapters::mac_audio::MacAudioCapture;
use adapters::sqlite::SqliteDatabase;
use application::capture_usecase::CaptureUseCase;
use ports::chat_gateway::ChatGatewayClient;
use ports::db::Database;
use std::sync::Arc;
use tauri::Manager;

use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize professional tracing logger
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("tauri_app=info".parse().unwrap()))
        .with_target(false)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false)
        .init();

    // Load .env file first — critical for macOS .app bundles that don't inherit shell env vars
    let _ = dotenvy::dotenv(); // silently ignore if no .env file is present

    // 1. Initialize Adapters
    let audio_capture = Arc::new(MacAudioCapture::new());
    let gateway_client = Arc::new(NodeGatewayClient::new());
    let db: Arc<dyn Database> = Arc::new(SqliteDatabase::new());
    let chat_client: Arc<dyn ChatGatewayClient> = Arc::new(NodeChatClient::new());

    // Initialize Rust Native Agents
    let graph = crate::application::agent_registry::initialize_agent_graph();

    // 2. Initialize Use Cases
    let capture_usecase = Arc::new(CaptureUseCase::new(audio_capture, gateway_client));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
                app.set_activation_policy(tauri::ActivationPolicy::Regular);

                // Configure all windows as overlays
                for (_label, win) in app.webview_windows() {
                    // win.set_content_protected(true)?; // Removed so the window is visible in screen shares
                    win.set_always_on_top(true)?;
                    macos_overlay::make_overlay(&win)?;
                }

                app.global_shortcut().register("Option+Space")?;

                let show = tauri::menu::MenuItem::with_id(app, "show", "Show Roxi", true, None::<&str>)?;
                let hide = tauri::menu::MenuItem::with_id(app, "hide", "Hide Roxi", true, None::<&str>)?;
                let quit = tauri::menu::MenuItem::with_id(app, "quit", "Quit Roxi", true, None::<&str>)?;
                let menu = tauri::menu::Menu::with_items(app, &[&show, &hide, &quit])?;

                let mut tray_builder = tauri::tray::TrayIconBuilder::with_id("roxi-tray");
                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }
                tray_builder
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
            commands::speaker::rename_speaker,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
