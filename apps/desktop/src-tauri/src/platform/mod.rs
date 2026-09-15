#[cfg(windows)]
mod windows;
#[cfg(windows)]
mod windows_capture;

#[cfg(windows)]
pub use windows::{
    get_autostart_enabled, initialize_launcher, present_launcher, set_autostart_enabled,
};
#[cfg(windows)]
pub use windows_capture::capture_selected_text;

// Deliberately no macOS implementation in the Windows MVP.
#[cfg(not(windows))]
pub fn initialize_launcher(app: &tauri::AppHandle) {
    crate::launcher::set_status(
        app,
        crate::launcher::LauncherStatus::unavailable("unsupported_platform"),
    );
}

#[cfg(not(windows))]
pub fn present_launcher(
    _app: &tauri::AppHandle,
    _window: &tauri::WebviewWindow,
    _needs_initial_position: bool,
) -> Result<(), &'static str> {
    Err("launcher_unavailable")
}

#[cfg(not(windows))]
pub fn capture_selected_text(
    _app: &tauri::AppHandle,
) -> Result<crate::desktop_capture::CapturedSelection, crate::desktop_capture::CaptureFailure> {
    Err(crate::desktop_capture::CaptureFailure::Unavailable)
}

#[cfg(not(windows))]
pub fn get_autostart_enabled(_app: &tauri::AppHandle) -> Result<bool, &'static str> {
    Err("unsupported_platform")
}

#[cfg(not(windows))]
pub fn set_autostart_enabled(
    _app: &tauri::AppHandle,
    _enabled: bool,
) -> Result<bool, &'static str> {
    Err("unsupported_platform")
}
