use serde_json::Value;
use std::{fs, path::Path};

fn source(path: &str) -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(path)).unwrap_or_default()
}

#[test]
fn official_updater_is_pinned_and_has_a_download_only_adapter() {
    let manifest = source("Cargo.toml");
    let dependency = manifest
        .lines()
        .find(|line| line.starts_with("tauri-plugin-updater ="))
        .unwrap();
    assert!(dependency.contains("version = \"=2.13.3\""));
    assert!(dependency.contains("default-features = false"));
    assert!(dependency.contains("features = [\"native-tls\", \"zip\", \"system-proxy\"]"));
    assert!(!dependency.contains("rustls-tls"));
    let driver = source("src/updater/tauri_driver.rs");
    assert!(driver.contains(".updater_builder()"));
    assert!(driver.contains("sdk.initialize("));
    assert!(!driver.contains(".plugin("));
    assert!(driver.contains(".download("));
    assert!(driver.contains("require_signed_version: true"));
    assert!(!driver.contains(".install("));
    assert!(!driver.contains("download_and_install"));
    assert!(!driver.contains("danger_accept_invalid"));
}

#[test]
fn checked_offers_keep_a_finite_download_timeout() {
    let driver = source("src/updater/tauri_driver.rs");
    assert!(driver.contains("const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);"));
    let check = driver.find(".check()").unwrap();
    let timeout = driver
        .find("update.timeout = Some(REQUEST_TIMEOUT);")
        .expect("the SDK does not propagate the check timeout to its returned Update");
    let retained = driver.find("payload: Arc::new(update)").unwrap();
    assert!(
        check < timeout && timeout < retained,
        "the download timeout must be set before retaining the checked offer"
    );
}

#[test]
fn only_main_can_use_the_narrow_updater_commands_and_event_subscriptions() {
    let main: Value = serde_json::from_str(&source("capabilities/default.json")).unwrap();
    let launcher: Value = serde_json::from_str(&source("capabilities/launcher.json")).unwrap();
    assert_eq!(main["windows"], serde_json::json!(["main"]));
    let main_permissions = main["permissions"].as_array().unwrap();
    for command in [
        "get-update-status",
        "check-for-updates",
        "download-update",
        "cancel-update",
        "dismiss-update",
        "restart-to-update",
    ] {
        let permission = format!("allow-{command}");
        assert!(
            main_permissions.contains(&Value::String(permission.clone())),
            "{permission}"
        );
        assert!(!launcher["permissions"]
            .as_array()
            .unwrap()
            .contains(&Value::String(permission)));
    }
    for event in ["core:event:allow-listen", "core:event:allow-unlisten"] {
        assert!(main_permissions.contains(&Value::String(event.into())));
    }
    for capability in [main, launcher] {
        assert!(capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| !p.as_str().unwrap().starts_with("updater:")));
    }
}

#[test]
fn production_endpoint_enables_configured_windows_installation_without_startup_window_changes() {
    let config: Value = serde_json::from_str(&source("tauri.conf.json")).unwrap();
    let updater = &config["plugins"]["updater"];
    assert_eq!(
        updater["endpoints"],
        serde_json::json!(["https://tryslate.tech/updates/windows/latest.json"])
    );
    assert!(updater["pubkey"]
        .as_str()
        .is_some_and(|key| !key.is_empty()));
    assert_eq!(updater["requireSignedVersion"], true);
    for flag in [
        "allowDowngrades",
        "dangerousInsecureTransportProtocol",
        "dangerousAcceptInvalidCerts",
        "dangerousAcceptInvalidHostnames",
    ] {
        assert_eq!(updater[flag], false, "{flag}");
    }
    let driver = source("src/updater/tauri_driver.rs");
    assert!(driver.contains("plugins.0.get(\"updater\")"));
    let controller = source("src/updater/mod.rs");
    assert!(controller.contains("installation_enabled: cfg!(windows) && driver.configured(),"));
    assert!(!controller.contains("SLATE_PRIVATE_REHEARSAL_"));
    assert!(controller.contains("emit_to(\"main\""));
    assert!(!controller.contains(".show("));
    assert!(!controller.contains(".set_focus("));
    let lib = source("src/lib.rs");
    assert!(lib.contains("updater::initialize(app.handle())"));
    assert!(!lib.contains("tauri_plugin_updater::Builder"));
}

#[test]
fn restart_is_explicit_main_only_guarded_and_never_uses_sdk_early_exit() {
    let controller = source("src/updater/mod.rs");
    let restart = controller
        .split("pub fn restart_to_update(")
        .nth(1)
        .unwrap();
    assert!(restart.contains("require_main(window.label())?"));
    assert!(!restart.contains("String"));
    assert!(controller.contains("installation_enabled: cfg!(windows) && driver.configured(),"));
    assert!(controller.contains("if !state.snapshot.installation_enabled"));
    assert!(controller.contains("begin_user_preparation()"));
    assert!(controller.contains("guard.handoff(|| staged.launch())"));
    let handoff = source("src/updater/handoff.rs");
    assert!(handoff.contains("crate::background::quit_after_update(&self.0, authorization)"));
    assert!(!handoff.contains("crate::background::quit_app("));
    assert!(controller.contains("boundary.quit(authorization)"));
    let background = source("src/background.rs");
    let authorized = background
        .split("pub(crate) fn quit_after_update(")
        .nth(1)
        .unwrap()
        .split("pub fn quit_app(")
        .next()
        .unwrap();
    assert!(authorized.contains("with_update_exit(authorization"));
    assert!(authorized.contains("app.exit(0)"));
    assert!(background.contains("authorization.begin_exit()?;"));
    let delegation = background
        .split("pub(crate) fn with_update_exit(")
        .nth(1)
        .unwrap()
        .split("pub(crate) fn quit_after_update(")
        .next()
        .unwrap();
    assert!(
        delegation.find("authorization.begin_exit()?").unwrap()
            < delegation.find("runtime.request_quit()").unwrap()
    );
    assert!(
        delegation.find("runtime.request_quit()").unwrap() < delegation.find("exit();").unwrap()
    );
    assert!(handoff.contains("Command::new(&self.path)"));
    assert!(handoff.contains(".args(INSTALL_ARGS)"));
    for forbidden in [
        ".install(",
        "download_and_install(",
        "process::exit(",
        "ShellExecute",
        "runas",
    ] {
        assert!(!handoff.contains(forbidden), "{forbidden}");
    }
}
