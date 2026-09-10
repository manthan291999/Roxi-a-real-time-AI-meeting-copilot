mod adapters;
mod agents;
mod application;
#[cfg(target_os = "macos")]
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
use adapters::sqlite_brief_source::SqliteBriefSource;
use adapters::sqlite_document_source::SqliteDocumentSource;
use adapters::sqlite_projects::SqliteProjectRepository;
use adapters::sqlite_usage::SqliteUsageRepository;
use adapters::vector_client::QdrantVectorStore;
use agents::adapters::openai_embedding_adapter::OpenAiEmbeddingAdapter;
use agents::brief::store::BriefStore;
use application::brief_usecase::BriefUseCase;
use application::capture_usecase::CaptureUseCase;
use application::session_registry::SessionRegistry;
use ports::brief_source::BriefSource;
use ports::chat_gateway::ChatGatewayClient;
use ports::db::Database;
use ports::document_source::DocumentSource;
use ports::embedding::EmbeddingGateway;
use ports::project_repository::ProjectRepository;
use ports::usage::UsageRepository;
use ports::vector_store::VectorStore;
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
    let usage: Arc<dyn UsageRepository> = Arc::new(SqliteUsageRepository::new());
    let chat_client: Arc<dyn ChatGatewayClient> = Arc::new(NodeChatClient::new());
    let projects: Arc<dyn ProjectRepository> = Arc::new(SqliteProjectRepository::new());
    let brief_source: Arc<dyn BriefSource> = Arc::new(SqliteBriefSource::new());
    let documents: Arc<dyn DocumentSource> = Arc::new(SqliteDocumentSource::new());
    let embeddings: Arc<dyn EmbeddingGateway> = Arc::new(OpenAiEmbeddingAdapter::new(
        &std::env::var("OPENAI_API_KEY").unwrap_or_default(),
    ));
    // Meeting Semantic Memory, Phase 1: process supervision + collection
    // bootstrap only. Nothing reads from this yet — see ports::vector_store.
    let vector_store: Arc<dyn VectorStore> = Arc::new(QdrantVectorStore::new());

    // 2. The brain. One store, shared by the use case that fills it at
    //    start_capture and the graph that reads it per chunk.
    let briefs = Arc::new(BriefStore::new());
    let brief_usecase = Arc::new(BriefUseCase::new(
        projects.clone(),
        brief_source,
        documents,
        embeddings,
        briefs.clone(),
    ));

    // Initialize Rust Native Agents
    let graph = crate::application::agent_registry::initialize_agent_graph(briefs);

    // 3. Initialize Use Cases
    let sessions = Arc::new(SessionRegistry::new());
    let capture_usecase = Arc::new(CaptureUseCase::new(
        audio_capture,
        gateway_client,
        projects.clone(),
        brief_usecase,
        sessions.clone(),
    ));

    let vector_store_for_exit = vector_store.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
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
        .manage(usage)
        .manage(chat_client.clone())
        .manage(graph)
        .manage(projects)
        .manage(sessions)
        .setup(move |app| {
            // Started once here, not per capture, per the plan. Spawned onto
            // the async runtime rather than awaited: a slow or missing Qdrant
            // binary must not delay window setup, and every existing feature
            // (capture, chat, history) works with no vector store at all —
            // this is additive infrastructure nothing else depends on yet.
            let vector_store_for_setup = vector_store.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = vector_store_for_setup.start().await {
                    tracing::warn!(
                        "[qdrant] not available, continuing without it: {e:#}"
                    );
                }
            });

            // Phase 7: Start Chatbot sidecar immediately at launch, so it's
            // always-on and can receive push events (SyncVectors) from the
            // live meeting pipeline, rather than only booting on first Ask.
            let app_handle_for_chat = app.handle().clone();
            if let Err(e) = chat_client.start_session(Box::new(move |text| {
                crate::sidecar::chat_events::route_chat_event(&app_handle_for_chat, &text);
            })) {
                tracing::warn!("[chatbot] failed to boot sidecar at launch: {e:#}");
            }

            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Regular);

                for (_label, _win) in app.webview_windows() {
                    // Normal window setup, no overlay needed
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
        // Removed custom on_window_event to allow standard close button behavior
        .invoke_handler(tauri::generate_handler![
            commands::capture::start_capture,
            commands::capture::stop_capture,
            commands::audio_devices::check_blackhole_installed,
            commands::db::get_meetings,
            commands::db::get_meeting_details,
            commands::usage::get_session_usage,
            commands::chat::ask_chat,
            commands::chat::close_chat,
            commands::speaker::rename_speaker,
            commands::projects::list_projects,
            commands::projects::create_project,
            commands::documents::pick_document,
            commands::documents::upload_document,
            commands::documents::list_documents,
            commands::documents::delete_document,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(move |_app_handle, event| {
            // Qdrant has no other natural stop trigger — unlike the gateway/
            // chatbot sidecars, which are tied to a capture/chat session and
            // stopped by explicit user action, it runs for the app's whole
            // lifetime. Without this it would be orphaned on quit.
            if let tauri::RunEvent::Exit = event {
                if let Err(e) = vector_store_for_exit.stop() {
                    tracing::warn!("[qdrant] shutdown error: {e:#}");
                }
            }
        });
}
