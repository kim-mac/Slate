use crate::installation_safety::SafetyCoordinator;
use std::sync::Arc;
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

// Match the website's verified public listing. The frontend supplies no URL.
const OFFICIAL_EXTENSION_URL: &str =
    "https://chromewebstore.google.com/detail/slate/hgbfaclkpmcecikjepoejgjccddjbekh";

fn listing_for_window(label: &str) -> Result<&'static str, &'static str> {
    if label == "main" {
        Ok(OFFICIAL_EXTENSION_URL)
    } else {
        Err("The extension listing is only available in the main window.")
    }
}

#[tauri::command]
pub fn open_extension_listing(
    window: WebviewWindow,
    safety: State<'_, Arc<SafetyCoordinator>>,
) -> Result<(), &'static str> {
    let url = listing_for_window(window.label())?;
    let _permit = safety
        .admit()
        .map_err(|_| "Slate is busy. Try again when the current operation finishes.")?;
    window
        .app_handle()
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Could not open the extension listing.")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn main_opens_only_the_same_official_https_listing_as_the_website() {
        let url = listing_for_window("main").unwrap();
        assert_eq!(
            url,
            "https://chromewebstore.google.com/detail/slate/hgbfaclkpmcecikjepoejgjccddjbekh"
        );
        assert!(include_str!("../../../site/src/data/releases.ts").contains(url));
    }
    #[test]
    fn untrusted_window_labels_cannot_select_or_change_the_destination() {
        for label in [
            "launcher",
            "",
            "Main",
            "main?url=https://example.com",
            "https://example.com",
            "main\0",
        ] {
            assert!(listing_for_window(label).is_err());
        }
    }
}
