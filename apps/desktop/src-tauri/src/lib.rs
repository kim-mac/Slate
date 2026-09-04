pub mod app_paths;
pub mod bridge;
pub mod clips;
mod commands;
mod database;
mod launcher;
mod platform;

use std::fs;

use app_paths::clip_database_path_from_app_data_dir;
use clips::ClipService;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let application_data_directory = app.path().app_data_dir()?;
            fs::create_dir_all(&application_data_directory)?;
            let database_path = clip_database_path_from_app_data_dir(&application_data_directory);
            let clip_service = ClipService::open(database_path)?;
            app.manage(clip_service);
            app.manage(launcher::LauncherController::default());
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
