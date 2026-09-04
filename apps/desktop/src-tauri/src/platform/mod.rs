#[cfg(windows)]
mod windows;

#[cfg(windows)]
pub use windows::{initialize_launcher, present_launcher};

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
) -> Result<(), &'static str> {
    Err("launcher_unavailable")
}
