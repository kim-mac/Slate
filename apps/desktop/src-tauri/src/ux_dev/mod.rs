mod guard;
pub mod paths;
pub use paths::Profile;
pub const IDENTIFIER: &str = "com.aiclipmemory.desktop.ux-dev";
pub const TITLE: &str = "Slate UX Development";
pub fn write_receipt(app: &tauri::AppHandle) -> std::io::Result<()> {
    use std::io::Write;
    use tauri::Manager;
    let profile = app.state::<Profile>();
    profile.validate_data()?;
    let receipt = serde_json::json!({
        "uxDevelopment": true, "pid": std::process::id(), "identifier": app.config().identifier,
        "dataDirectory": profile.data, "webviewDirectory": profile.webview,
        "productionUpdaterEnabled": false, "installationEnabled": false,
        "productionMaintenanceGate": false, "autostartEnabled": false,
        "nativeMessagingRegistration": false, "quickSearchShortcut": "Ctrl+Alt+Shift+Space",
        "mainWindowTitle": app.get_webview_window("main").and_then(|w| w.title().ok()),
        "launcherWindowTitle": app.get_webview_window("launcher").and_then(|w| w.title().ok()),
        "databasePath": app.state::<crate::storage::StorageState>().database_path()
    });
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(std::io::Error::other)?
        .as_nanos();
    let path = profile.data.parent().unwrap().join(format!(
        "native-startup-{}-{stamp}.json",
        std::process::id()
    ));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(serde_json::to_string_pretty(&receipt)?.as_bytes())?;
    println!("{receipt}");
    Ok(())
}
pub fn validate(config: &tauri::Config) -> std::io::Result<()> {
    let disabled = config.plugins.0.get("updater").is_some_and(|v| {
        v.get("endpoints") == Some(&serde_json::json!([]))
            && v.get("pubkey").and_then(|k| k.as_str()) == Some("")
    });
    if config.identifier != IDENTIFIER
        || config.product_name.as_deref() != Some(TITLE)
        || !disabled
        || config.bundle.active
        || config.app.windows.len() != 1
        || config.app.windows[0].create
        || config.app.windows[0].label != "main"
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "UX dev configuration required",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn production_identity_and_any_upstream_endpoint_are_rejected() {
        let mut config: tauri::Config =
            serde_json::from_str(include_str!("../../tauri.ux-dev.conf.json")).unwrap();
        assert!(validate(&config).is_ok());
        config.identifier = "com.aiclipmemory.desktop".into();
        assert!(validate(&config).is_err());
        config.identifier = IDENTIFIER.into();
        config.plugins.0.insert(
            "updater".into(),
            serde_json::json!({"pubkey":"", "endpoints":["https://example.invalid"]}),
        );
        assert!(validate(&config).is_err());
        config.plugins.0.insert(
            "updater".into(),
            serde_json::json!({"pubkey":"", "endpoints":[]}),
        );
        config.bundle.active = true;
        assert!(validate(&config).is_err());
    }
}
