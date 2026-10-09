mod error;
mod login_item;
mod rate_limit;
mod tracks;
mod tray;
mod ytdlp;

use tauri::{AppHandle, Manager, State};

use error::AppError;
use rate_limit::RateLimiter;
use tracks::{Track, TrackStore};

/// The single way to a stream URL: adding, playing, preloading and recovery
/// all come through here, so the rate limit guard covers every one of them.
#[tauri::command]
async fn resolve_audio(app: AppHandle, url: String) -> Result<ytdlp::ResolvedAudio, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or(0);
        app.state::<RateLimiter>()
            .guard(now, || ytdlp::resolve(&url))
    })
    .await
    .map_err(|e| AppError::with_detail("ytdlp_failed", e))?
}

#[tauri::command]
async fn check_connectivity() -> bool {
    tauri::async_runtime::spawn_blocking(ytdlp::can_reach_youtube)
        .await
        .unwrap_or(false)
}

#[tauri::command]
fn list_tracks(store: State<TrackStore>) -> Vec<Track> {
    store.list()
}

#[tauri::command]
fn upsert_track(
    store: State<TrackStore>,
    id: String,
    url: String,
    title: String,
    duration: f64,
) -> Result<Vec<Track>, AppError> {
    store.upsert(id, url, title, duration)
}

#[tauri::command]
fn set_track_position(store: State<TrackStore>, id: String, position: f64) -> Result<(), AppError> {
    store.set_position(&id, position)
}

#[tauri::command]
fn delete_track(store: State<TrackStore>, id: String) -> Result<Vec<Track>, AppError> {
    store.delete(&id)
}

#[tauri::command]
fn restore_track(store: State<TrackStore>, track: Track) -> Result<Vec<Track>, AppError> {
    store.restore(track)
}

/// Tells the menu bar icon whether something is playing.
#[tauri::command]
fn set_tray_state(app: AppHandle, playing: bool) {
    let _ = tray::set_playing(&app, playing);
}

/// Closes the popover from the webview (Escape).
#[tauri::command]
fn set_tray_menu(app: AppHandle, menu: tray::MenuState) {
    let _ = tray::set_menu(&app, menu);
}

#[tauri::command]
fn show_popover(app: AppHandle) {
    tray::show_popover(&app);
}

#[tauri::command]
fn hide_popover(app: AppHandle) {
    tray::hide_popover(&app);
}

/// Called by the webview once it has saved the playback position.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Mirrors webview diagnostics into the `tauri dev` terminal.
#[tauri::command]
fn frontend_log(message: String) {
    #[cfg(debug_assertions)]
    eprintln!("[webview] {message}");
    #[cfg(not(debug_assertions))]
    let _ = message;
}

pub fn run() {
    tauri::Builder::default()
        // Registered first: a second copy of the app ends here, before it adds
        // another icon or opens the library the first one is writing.
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .manage(tray::PopoverState::default())
        .manage(tray::TrayMenu::default())
        .setup(|app| {
            // Menubar-only: no dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let data_dir = app.path().app_data_dir()?;
            app.manage(TrackStore::load(&data_dir));
            app.manage(RateLimiter::load(&data_dir));

            tray::create(app.handle())?;
            Ok(())
        })
        .on_window_event(tray::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            resolve_audio,
            check_connectivity,
            list_tracks,
            upsert_track,
            set_track_position,
            delete_track,
            restore_track,
            set_tray_state,
            set_tray_menu,
            show_popover,
            hide_popover,
            quit_app,
            frontend_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
