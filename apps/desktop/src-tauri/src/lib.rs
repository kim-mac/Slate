pub mod app_paths;
pub mod bridge;
pub mod clips;
mod commands;
mod database;
pub mod desktop_capture;
mod launcher;
mod platform;
pub mod storage;

use storage::StorageState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let application_data_directory = app.path().app_data_dir()?;
            app.manage(StorageState::new(application_data_directory));
            app.manage(launcher::LauncherController::default());
            app.manage(desktop_capture::CaptureController::default());
            platform::initialize_launcher(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                launcher::exit(window.app_handle());
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_clips,
            commands::create_clip,
            commands::update_clip,
            commands::delete_clip,
            commands::set_clip_pinned,
            commands::copy_clip_content,
            commands::open_clip_source,
            launcher::launcher_ready,
            launcher::hide_launcher,
            launcher::get_launcher_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Clip Memory");
}
