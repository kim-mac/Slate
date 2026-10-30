//! Effective Tauri configuration guard shared by runtime and cross-platform tests.
use super::policy;
use std::io;

fn denied(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message)
}

pub fn validate(config: &tauri::Config) -> io::Result<()> {
    let updater_disabled = config.plugins.0.get("updater").is_some_and(|updater| {
        updater.get("pubkey").and_then(|v| v.as_str()) == Some("")
            && updater.get("endpoints") == Some(&serde_json::json!([]))
    });
    let window = config.app.windows.first();
    let macos = &config.bundle.macos;
    let extra_resources =
        config
            .bundle
            .resources
            .as_ref()
            .is_some_and(|resources| match resources {
                tauri::utils::config::BundleResources::List(values) => !values.is_empty(),
                tauri::utils::config::BundleResources::Map(values) => !values.is_empty(),
            });
    if config.identifier != policy::IDENTIFIER
        || config.product_name.as_deref() != Some(policy::TITLE)
        || config.version.as_deref() != Some("0.3.1")
        || config.app.windows.len() != 1
        || !window.is_some_and(|w| {
            w.label == "main"
                && w.title == policy::TITLE
                && w.url == tauri::WebviewUrl::App("index.html".into())
                && !w.create
                && !w.visible
                && !w.incognito
                && w.data_directory.is_none()
                && w.data_store_identifier == Some(policy::STORE_ID)
        })
        || !updater_disabled
        || config.plugins.0.contains_key("autostart")
        || !config.bundle.active
        || serde_json::to_value(&config.bundle.targets)? != serde_json::json!(["app"])
        || config.bundle.icon != ["icons/macos-dev.png"]
        || macos.minimum_system_version.as_deref() != Some("14.0")
        || macos.signing_identity.as_deref() != Some("-")
        || macos.entitlements.is_some()
        || macos.info_plist.is_some()
        || macos.frameworks.as_ref().is_some_and(|v| !v.is_empty())
        || !macos.files.is_empty()
        || extra_resources
        || config
            .bundle
            .external_bin
            .as_ref()
            .is_some_and(|v| !v.is_empty())
        || !matches!(
            config.bundle.create_updater_artifacts,
            tauri::utils::config::Updater::Bool(false)
        )
    {
        return Err(denied("isolated macOS development configuration required"));
    }
    Ok(())
}
