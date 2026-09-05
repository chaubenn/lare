//! Lare desktop (Tauri 2). Hosts the local server the Chrome extension talks to, the OAuth
//! loopback redirect, deep links, and a handful of commands the React frontend calls.

pub mod commands;
pub mod deeplink;
pub mod recorder;
pub mod recording;
pub mod windows;
pub mod ws_server;

use std::sync::{Arc, Mutex};

use lare_core::{WS_PORT, protocol::AppToExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::sync::mpsc::UnboundedReceiver;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use crate::ws_server::{ServerContext, ServerEvent, WsHub};

/// State shared between commands and the local server.
pub struct AppState {
    /// Supabase user id of the signed-in user (mirrored into `hello.ack.userId` and `/health`).
    pub current_user: Arc<Mutex<Option<String>>>,
    pub ws: WsHub,
    /// Route from a `lare://` link the app was launched with, consumed once by the frontend.
    pub initial_deeplink: Mutex<Option<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsStatus {
    pub connected: bool,
    pub port: u16,
}

#[tauri::command]
fn set_current_user(state: State<'_, AppState>, user_id: Option<String>) {
    if let Ok(mut current) = state.current_user.lock() {
        *current = user_id;
    }
}

#[tauri::command]
fn ws_status(state: State<'_, AppState>) -> WsStatus {
    WsStatus {
        connected: state.ws.connected(),
        port: WS_PORT,
    }
}

/// Broadcast an `AppToExt` frame (as JSON) to every connected extension client.
#[tauri::command]
fn ws_send(state: State<'_, AppState>, message: serde_json::Value) -> Result<(), String> {
    let msg: AppToExt =
        serde_json::from_value(message).map_err(|e| format!("not a valid AppToExt message: {e}"))?;
    state.ws.broadcast(msg);
    Ok(())
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Route from the deep link the app was started with (if any). Cleared after the first call.
#[tauri::command]
fn take_initial_deeplink(state: State<'_, AppState>) -> Option<String> {
    state.initial_deeplink.lock().ok().and_then(|mut slot| slot.take())
}

fn init_tracing() {
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,lare_desktop_lib=debug,lare_desktop=debug"));
    let registry = tracing_subscriber::registry().with(filter);
    // Also mirror logs to a file: when the app is launched via Launch Services its stderr goes
    // to the unified log, which is awkward to read; /tmp/lare-app.log is always available.
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/lare-app.log")
        .ok();
    match file {
        Some(f) => registry
            .with(tracing_subscriber::fmt::layer())
            .with(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_writer(std::sync::Mutex::new(f)),
            )
            .init(),
        None => registry.with(tracing_subscriber::fmt::layer()).init(),
    }
}

pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn emit_deeplink(app: &AppHandle, path: &str) {
    info!(path, "deep link");
    if let Err(err) = app.emit("deeplink:navigate", path) {
        error!(%err, "failed to emit deeplink:navigate");
    }
    focus_main_window(app);
}

/// Turn server events into Tauri events for the webview.
async fn forward_server_events(app: AppHandle, mut events: UnboundedReceiver<ServerEvent>) {
    while let Some(event) = events.recv().await {
        let result = match event {
            ServerEvent::AuthCallback { code, next } => {
                focus_main_window(&app);
                app.emit_to("main", "auth:callback", serde_json::json!({ "code": code, "next": next }))
            }
            ServerEvent::AuthError { error, description } => {
                focus_main_window(&app);
                app.emit_to(
                    "main",
                    "auth:error",
                    serde_json::json!({ "error": error, "description": description }),
                )
            }
            ServerEvent::ExtMessage(value) => app.emit("ext:message", value),
            ServerEvent::ExtConnected(connected) => app.emit("ext:connected", connected),
        };
        if let Err(err) = result {
            warn!(%err, "failed to emit event to the webview");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let (hub, events) = WsHub::new();
    let current_user = Arc::new(Mutex::new(None));
    let server_ctx = ServerContext::new(hub.clone(), current_user.clone(), env!("CARGO_PKG_VERSION"));
    let backend_ctx = server_ctx.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // With the `deep-link` feature the plugin forwards `lare://` argv URLs to
            // `on_open_url`; we only need to surface the existing window.
            info!(?argv, "second instance launched; focusing the main window");
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            current_user,
            ws: hub,
            initial_deeplink: Mutex::new(None),
        })
        .manage(commands::Jobs::default())
        .invoke_handler(tauri::generate_handler![
            set_current_user,
            ws_status,
            ws_send,
            app_version,
            take_initial_deeplink,
            commands::list_devices,
            commands::check_permissions,
            commands::request_permission,
            commands::permission_settings_url,
            commands::open_permission_settings,
            commands::recorder_settings,
            commands::set_recorder_settings,
            commands::recorder_status,
            commands::recording_start,
            commands::recording_pause,
            commands::recording_resume,
            commands::recording_stop,
            commands::recording_cancel,
            commands::recordings_list,
            commands::recording_delete,
            commands::open_recorder_window,
            commands::close_recorder_window,
            commands::open_camera_window,
            commands::close_camera_window,
            commands::resize_camera_window,
            commands::focus_main,
            commands::media_info,
            commands::make_thumbnail,
            commands::studio_project_info,
            commands::export_studio,
            commands::cancel_job,
            commands::upload_to_bunny,
            commands::remember_upload,
            commands::whisper_models,
            commands::ensure_whisper_model,
            commands::transcribe_recording,
            commands::read_file_bytes,
            commands::delete_file,
            commands::path_exists,
        ])
        .setup(move |app| {
            // Track the UI thread so overlay helpers can run AppKit work safely from Tokio.
            crate::windows::mark_main_thread();

            // Recorder (Cap capture stack) shared by commands and the extension bridge.
            let recorder = recorder::Recorder::new(app.handle().clone());
            backend_ctx.set_recording_backend(Some(Arc::new(recorder::CapRecordingBackend::new(
                recorder.clone(),
            ))));
            app.manage(recorder);

            // Deep links. macOS registers the scheme via the bundle's Info.plist; Windows/Linux
            // need a runtime registration for unpackaged (dev) builds.
            #[cfg(any(windows, target_os = "linux"))]
            {
                if let Err(err) = app.deep_link().register_all() {
                    warn!(%err, "could not register deep link schemes");
                }
            }
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                if let Some(path) = urls.iter().find_map(deeplink::route_for) {
                    if let Ok(mut slot) = app.state::<AppState>().initial_deeplink.lock() {
                        *slot = Some(path);
                    }
                }
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    match deeplink::route_for(&url) {
                        Some(path) => emit_deeplink(&handle, &path),
                        None => warn!(%url, "ignoring deep link with unexpected scheme"),
                    }
                }
            });

            // Local server + event bridge.
            tauri::async_runtime::spawn(forward_server_events(app.handle().clone(), events));
            tauri::async_runtime::spawn(ws_server::run_forever(server_ctx));
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(_)) {
                crate::windows::repromote_overlays(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Lare");
}
