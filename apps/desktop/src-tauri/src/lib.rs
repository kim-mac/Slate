#[cfg(all(target_os = "macos", not(feature = "macos-dev")))]
compile_error!("macOS requires the explicit macos-dev feature in M1");
#[cfg(all(
    feature = "macos-dev",
    any(not(target_os = "macos"), not(debug_assertions))
))]
compile_error!("macos-dev is restricted to macOS debug builds");
#[cfg(all(feature = "macos-dev", feature = "ux-dev"))]
compile_error!("macos-dev and ux-dev are mutually exclusive");

pub mod app_paths;
pub mod background;
pub mod bridge;
pub mod clips;
mod commands;
mod database;
pub mod desktop_capture;
mod extension_listing;
pub mod installation_safety;
mod launcher;
#[cfg(all(target_os = "macos", feature = "macos-dev"))]
mod macos_dev;
mod platform;
pub mod storage;
#[cfg(not(feature = "macos-dev"))]
#[cfg(not(feature = "ux-dev"))]
pub mod updater;
#[cfg(any(feature = "ux-dev", feature = "macos-dev"))]
#[path = "ux_dev/updater.rs"]
pub mod updater;
#[cfg(feature = "ux-dev")]
mod ux_dev;

use installation_safety::SafetyCoordinator;
use std::sync::Arc;
use storage::StorageState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(all(target_os = "macos", feature = "macos-dev"))]
    let context = {
        let mut context = context;
        macos_dev::prepare(context.config_mut())
            .expect("macOS development store configuration rejected");
        context
    };
    #[cfg(all(target_os = "macos", feature = "macos-dev"))]
    let profile = {
        macos_dev::validate(context.config()).expect("macOS development configuration rejected");
        macos_dev::Profile::open().expect("macOS development isolation rejected")
    };
    #[cfg(feature = "ux-dev")]
    let profile = {
        ux_dev::validate(context.config()).expect("UX development identity/configuration rejected");
        ux_dev::Profile::open().expect("UX development profile rejected")
    };
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        let _ = background::show_main_window(app);
    }));
    #[cfg(all(windows, not(feature = "ux-dev")))]
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
        .setup(move |app| {
            let startup = background::startup_plan(std::env::args());
            #[cfg(not(any(feature = "ux-dev", feature = "macos-dev")))]
            let application_data_directory = app.path().app_data_dir()?;
            #[cfg(all(target_os = "macos", feature = "macos-dev"))]
            let application_data_directory = {
                profile.validate_data()?;
                if app.path().app_data_dir()? != profile.data {
                    return Err("macOS application-data path does not match guarded profile".into());
                }
                let data = profile.data.clone();
                app.manage(profile);
                data
            };
            #[cfg(feature = "ux-dev")]
            let application_data_directory = {
                let data = profile.data.clone();
                app.manage(profile);
                data
            };
            #[cfg(all(windows, not(feature = "ux-dev")))]
            let safety = SafetyCoordinator::for_current_installation();
            #[cfg(any(not(windows), feature = "ux-dev"))]
            let safety = SafetyCoordinator::new();
            app.manage(StorageState::with_safety(
                application_data_directory,
                Arc::clone(&safety),
            ));
            app.manage(Arc::clone(&safety));
            #[cfg(feature = "ux-dev")]
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .data_directory(app.state::<ux_dev::Profile>().webview.clone())
                .build()?;
            #[cfg(all(target_os = "macos", feature = "macos-dev"))]
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .data_store_identifier(macos_dev::policy::STORE_ID)
                .build()?;
            installation_safety::ipc::initialize(app.handle(), &safety);
            app.manage(launcher::LauncherController::default());
            app.manage(desktop_capture::CaptureController::default());
            updater::initialize(app.handle());
            background::initialize(app, startup.start_hidden)?;
            if startup.initialize_shortcuts {
                platform::initialize_launcher(app.handle());
            }
            #[cfg(feature = "ux-dev")]
            ux_dev::write_receipt(app.handle())?;
            #[cfg(all(target_os = "macos", feature = "macos-dev"))]
            macos_dev::write_receipt(app.handle())?;
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                if let Some(safety) = webview.try_state::<Arc<SafetyCoordinator>>() {
                    let _ = safety.disconnected(webview.label());
                }
            }
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(safety) = window.try_state::<Arc<SafetyCoordinator>>() {
                    let _ = safety.disconnected(window.label());
                }
            }
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window
                        .state::<background::RuntimePolicy>()
                        .main_close_decision()
                        == background::MainCloseDecision::Hide
                    {
                        api.prevent_close();
                        background::close_main_window(window);
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
            commands::rename_group,
            commands::create_clip,
            commands::update_clip,
            commands::delete_clip,
            commands::set_clip_pinned,
            commands::copy_clip_content,
            commands::open_clip_source,
            extension_listing::open_extension_listing,
            launcher::launcher_ready,
            launcher::hide_launcher,
            launcher::open_tin_from_launcher,
            launcher::get_launcher_status,
            commands::get_autostart_enabled,
            commands::set_autostart_enabled,
            updater::get_update_status,
            updater::check_for_updates,
            updater::download_update,
            updater::cancel_update,
            updater::dismiss_update,
            updater::restart_to_update,
            installation_safety::ipc::connect_installation_safety,
            installation_safety::ipc::get_installation_safety_status,
            installation_safety::ipc::acquire_installation_lease,
            installation_safety::ipc::release_installation_lease,
            installation_safety::ipc::acknowledge_installation_safety,
            background::hide_main_after_inline_save,
        ])
        .run(context)
        .expect("error while running Slate");
}
