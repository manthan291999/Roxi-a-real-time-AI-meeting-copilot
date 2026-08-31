mod adapters;
mod application;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. Initialize Adapters
    let audio_capture = Arc::new(MacAudioCapture::new());
    let gateway_client = Arc::new(NodeGatewayClient::new());
    let db: Arc<dyn Database> = Arc::new(SqliteDatabase::new());
    let chat_client: Arc<dyn ChatGatewayClient> = Arc::new(NodeChatClient::new());

    // 2. Initialize Use Cases
    let capture_usecase = Arc::new(CaptureUseCase::new(audio_capture, gateway_client));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(capture_usecase)
        .manage(db)
        .manage(chat_client)
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

