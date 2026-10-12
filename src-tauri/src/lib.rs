mod adapters;
mod agents;
mod application;
mod bundle_env;
mod commands;
mod domain;
mod logging;
mod ports;
mod resample;
mod sidecar;
mod streaming;
mod window_material;

use adapters::chat_client::NodeChatClient;
use adapters::cloud_api::RoxiCloudClient;
use adapters::gateway_client::NodeGatewayClient;
use adapters::keychain_session_store::KeychainSessionStore;
use adapters::local_history::LocalHistory;
use adapters::loopback_redirect::LoopbackRedirectListener;
use adapters::sqlite::SqliteDatabase;
use adapters::sqlite_brief_source::SqliteBriefSource;
use adapters::sqlite_document_source::SqliteDocumentSource;
use adapters::sqlite_projects::SqliteProjectRepository;
use adapters::sqlite_usage::SqliteUsageRepository;
use adapters::supabase_auth::SupabaseAuth;
use adapters::system_browser::SystemBrowser;
use adapters::vector_client::QdrantVectorStore;
use agents::adapters::openai_embedding_adapter::OpenAiEmbeddingAdapter;
use agents::brief::store::BriefStore;
use application::account_scope::AccountScopeCell;
use application::account_usecase::AccountUseCase;
use application::brief_usecase::BriefUseCase;
use application::capture_usecase::CaptureUseCase;
use application::federated_sign_in::FederatedSignIn;
use application::session_registry::SessionRegistry;
use application::trial_usecase::TrialUseCase;
use ports::account_scope::CurrentAccount;
use ports::auth::AuthProvider;
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
    // Initialize professional tracing logger — one shared column/color format
    // (see src/logging.rs) across this process AND the gateway/chatbot
    // sidecars, whose stderr gets parsed and relayed through the same
    // formatter (adapters/gateway_client.rs, adapters/chat_client.rs).
    // RUST_LOG still gates verbosity exactly as before; only the rendering
    // of a line, once it's going to print, changed.
    //
    // Every target we own is named explicitly, rather than setting a bare
    // default level that would also switch on every dependency's logging
    // (tauri, hyper, rustls, ...). `gateway` and `chatbot` are the targets
    // relay_sidecar_log() re-emits the two Node sidecars' stderr under.
    //
    // Naming those two is load-bearing: a target no directive matches falls
    // back to EnvFilter's own default of ERROR, so every sidecar line below
    // error level was being dropped on the floor — including the WARN that an
    // unparseable line (a Node stack trace, an npm warning) gets relayed as.
    // A sidecar could crash mid-meeting and the terminal would show nothing
    // but this process noticing its stdout had closed, with no reason.
    let filter = tracing_subscriber::EnvFilter::from_default_env()
        .add_directive("tauri_app=info".parse().unwrap())
        .add_directive("gateway=info".parse().unwrap())
        .add_directive("chatbot=info".parse().unwrap());

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .event_format(logging::RoxiFormatter)
        .init();

    // A packaged .app points every runtime at its bundled sidecars, its baked-in
    // keys and a writable data folder. A no-op under `tauri dev`.
    bundle_env::configure();

    // Load .env file first — critical for macOS .app bundles that don't inherit shell env vars
    let _ = dotenvy::dotenv(); // silently ignore if no .env file is present

    logging::print_startup_banner();

    // 0. Accounts come first: local history is read per signed-in account,
    //    so every history reader below needs to know who that is. Without
    //    SUPABASE_URL + SUPABASE_ANON_KEY the app runs in local-only mode: no
    //    login screen, and every meeting on this Mac is visible as before.
    //    One Supabase client serves both password and browser sign-in.
    let supabase = SupabaseAuth::from_env().map(Arc::new);
    if supabase.is_none() {
        tracing::info!(
            "[auth] SUPABASE_URL / SUPABASE_ANON_KEY not set; running in local-only mode"
        );
    }
    let account_scope = Arc::new(AccountScopeCell::new(supabase.is_some()));
    let current_account: Arc<dyn CurrentAccount> = account_scope.clone();
    if let Err(e) = rusqlite::Connection::open(adapters::db_paths::meeting_history_db())
        .map_err(anyhow::Error::from)
        .and_then(|conn| adapters::meeting_scope::ensure_meeting_owner(&conn))
    {
        tracing::warn!("[history] could not add the meeting owner column: {e:#}");
    }

    // 1. Initialize Adapters
    let audio_capture = adapters::audio::create_audio_capture();
    let gateway_client = Arc::new(NodeGatewayClient::new());
    let db: Arc<dyn Database> = Arc::new(SqliteDatabase::new(current_account.clone()));
    let usage: Arc<dyn UsageRepository> = Arc::new(SqliteUsageRepository::new());
    let chat_client: Arc<dyn ChatGatewayClient> = Arc::new(NodeChatClient::new());
    let projects: Arc<dyn ProjectRepository> =
        Arc::new(SqliteProjectRepository::new(current_account.clone()));
    let brief_source: Arc<dyn BriefSource> =
        Arc::new(SqliteBriefSource::new(current_account.clone()));
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
    let mut account_usecase = AccountUseCase::new(
        supabase.clone().map(|a| a as Arc<dyn AuthProvider>),
        Arc::new(KeychainSessionStore),
        Arc::new(RoxiCloudClient::from_env().expect("HTTP client for the Roxi API")),
        LocalHistory::default_location().scoped(current_account.clone()),
    )
    .with_scope(account_scope)
    .with_unowned_history_claim(Arc::new(
        adapters::meeting_scope::UnownedHistoryOwner::from_env(),
    ));
    if let Some(supabase) = supabase {
        // Browser sign-in (Microsoft, Google, company SSO): each option is
        // opt-in via SUPABASE_OAUTH_PROVIDERS / SUPABASE_SSO in the root .env.
        account_usecase = account_usecase.with_federated(FederatedSignIn::new(
            supabase,
            Arc::new(SystemBrowser),
            Arc::new(LoopbackRedirectListener),
            SupabaseAuth::sign_in_methods_from_env(),
        ));
    }
    let account_usecase = Arc::new(account_usecase);
    let capture_usecase = Arc::new(CaptureUseCase::new(
        audio_capture,
        gateway_client,
        projects.clone(),
        brief_usecase,
        sessions.clone(),
        current_account.clone(),
        account_usecase.clone(),
    ));
    let trial_usecase = Arc::new(TrialUseCase::from_env(adapters::db_paths::trial_ledger()));

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
        .manage(account_usecase)
        .manage(current_account)
        .manage(trial_usecase)
        .setup(move |app| {
            // Started once here, not per capture, per the plan. Spawned onto
            // the async runtime rather than awaited: a slow or missing Qdrant
            // binary must not delay window setup, and every existing feature
            // (capture, chat, history) works with no vector store at all —
            // this is additive infrastructure nothing else depends on yet.
            let vector_store_for_setup = vector_store.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = vector_store_for_setup.start().await {
                    tracing::warn!("[qdrant] not available, continuing without it: {e:#}");
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

                // The window is declared transparent in tauri.conf.json, which
                // on its own would put the UI straight onto the desktop. The
                // material installed here is what makes it readable; see
                // window_material.rs for why CSS cannot do this job.
                for (label, win) in app.webview_windows() {
                    if let Err(e) = crate::window_material::apply(&win) {
                        // Logged, never fatal. A window without its material is
                        // degraded but still usable, and the tray still offers
                        // Quit — crashing here would be the worse outcome.
                        tracing::error!("[window] no translucent material on '{label}': {e:#}");
                    }
                }

                app.global_shortcut().register("Option+Space")?;

                let show =
                    tauri::menu::MenuItem::with_id(app, "show", "Show Roxi", true, None::<&str>)?;
                let hide =
                    tauri::menu::MenuItem::with_id(app, "hide", "Hide Roxi", true, None::<&str>)?;
                let quit =
                    tauri::menu::MenuItem::with_id(app, "quit", "Quit Roxi", true, None::<&str>)?;
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
            commands::trial::get_trial_status,
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
            commands::account::auth_get_state,
            commands::account::auth_sign_in,
            commands::account::auth_sign_up,
            commands::account::auth_sign_in_methods,
            commands::account::auth_sign_in_oauth,
            commands::account::auth_sign_in_sso,
            commands::account::auth_cancel_federated,
            commands::account::auth_sign_out,
            commands::account::auth_send_password_reset,
            commands::account::auth_resend_confirmation,
            commands::account::get_local_history_stats,
            commands::account::import_local_history,
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
