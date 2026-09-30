pub mod app_paths;
pub mod background;
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
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        let _ = background::show_main_window(app);
    }));
    #[cfg(windows)]
    let builder = builder.plugin(
        tauri_plugin_autostart::Builder::new()
            .app_name(background::AUTOSTART_APP_NAME)
            .arg(background::AUTOSTART_ARGUMENT)
            .build(),
    );

    builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let startup = background::startup_plan(std::env::args());
            let application_data_directory = app.path().app_data_dir()?;
            app.manage(StorageState::new(application_data_directory));
            app.manage(launcher::LauncherController::default());
            app.manage(desktop_capture::CaptureController::default());
            background::initialize(app, startup.start_hidden)?;
            if startup.initialize_shortcuts {
                platform::initialize_launcher(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window
                        .state::<background::RuntimePolicy>()
                        .main_close_decision()
                        == background::MainCloseDecision::Hide
                    {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_clips,
            commands::merge_clips,
            commands::unmerge_group_member,
            commands::unmerge_group,
            commands::delete_group_member,
            commands::delete_group,
            commands::set_group_pinned,
            commands::create_clip,
            commands::update_clip,
            commands::delete_clip,
            commands::set_clip_pinned,
            commands::copy_clip_content,
            commands::open_clip_source,
            launcher::launcher_ready,
            launcher::hide_launcher,
            launcher::open_tin_from_launcher,
            launcher::get_launcher_status,
            commands::get_autostart_enabled,
            commands::set_autostart_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Slate");
}
