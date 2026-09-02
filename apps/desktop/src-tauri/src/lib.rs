pub mod clips;
mod database;

use std::fs;

use clips::ClipService;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let application_data_directory = app.path().app_data_dir()?;
            fs::create_dir_all(&application_data_directory)?;
            let clip_service = ClipService::open(application_data_directory.join("clips.sqlite3"))?;
            app.manage(clip_service);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AI Clip Memory");
}
