//! No transport, staging, process gate or installer boundary is compiled in this module.
use serde::Serialize;
use tauri::WebviewWindow;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    revision: u64,
    phase: &'static str,
    current_version: &'static str,
    available_version: Option<&'static str>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    dismissed: bool,
    error: Option<&'static str>,
    installation_enabled: bool,
}
pub fn initialize(_: &tauri::AppHandle) {}
fn disabled() -> Result<UpdateSnapshot, &'static str> {
    Err("Updates are disabled in UX development mode.")
}
#[tauri::command]
pub fn get_update_status(window: WebviewWindow) -> Result<UpdateSnapshot, &'static str> {
    if window.label() != "main" {
        return disabled();
    }
    Ok(UpdateSnapshot {
        revision: 0,
        phase: "unconfigured",
        current_version: env!("CARGO_PKG_VERSION"),
        available_version: None,
        downloaded_bytes: 0,
        total_bytes: None,
        dismissed: false,
        error: None,
        installation_enabled: false,
    })
}
macro_rules! deny_command {
    ($name:ident) => {
        #[tauri::command]
        pub fn $name() -> Result<UpdateSnapshot, &'static str> {
            disabled()
        }
    };
}
deny_command!(check_for_updates);
deny_command!(download_update);
deny_command!(cancel_update);
deny_command!(dismiss_update);
deny_command!(restart_to_update);
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_mutating_updater_command_is_rejected_natively() {
        for call in [
            check_for_updates,
            download_update,
            cancel_update,
            dismiss_update,
            restart_to_update,
        ] {
            assert!(call().is_err());
        }
    }
}
