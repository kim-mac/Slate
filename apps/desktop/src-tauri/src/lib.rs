pub mod clips;
mod commands;
mod database;

use std::fs;

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
            let clip_service = ClipService::open(application_data_directory.join("clips.sqlite3"))?;
            app.manage(clip_service);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_clips,
            commands::create_clip,
            commands::update_clip,
            commands::delete_clip,
            commands::set_clip_pinned,
            commands::copy_clip_content,
            commands::open_clip_source,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Clip Memory");
}
