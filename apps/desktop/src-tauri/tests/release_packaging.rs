use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value;

const RELEASE_VERSION: &str = "0.1.0";
const HOST_NAME: &str = "com.aiclipmemory.bridge";
const HOST_EXECUTABLE: &str = "ai-clip-memory-native-host.exe";
const CHROME_ID: &str = "jjfaegknedfakmidhhdlmbebnjafcjfi";
const EDGE_ID: &str = "jcfcmapapjlgpbkcgcaeggeblgpidkoo";

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn read(path: impl AsRef<Path>) -> String {
    fs::read_to_string(path.as_ref())
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.as_ref().display()))
}

fn read_json(path: impl AsRef<Path>) -> Value {
    serde_json::from_str(&read(path)).expect("the file should contain valid JSON")
}

fn package_version(cargo_manifest: &str) -> &str {
    let package_section = cargo_manifest
        .split_once("[package]")
        .expect("Cargo.toml should contain a package section")
        .1;
    let version_line = package_section
        .lines()
        .find(|line| line.trim_start().starts_with("version ="))
        .expect("the package section should contain a version");
    version_line
        .split_once('=')
        .expect("the version should use key/value syntax")
        .1
        .trim()
        .trim_matches('"')
}

#[test]
fn release_versions_are_aligned() {
    let root = repository_root();

    for path in [
        root.join("package.json"),
        root.join("apps/desktop/package.json"),
        root.join("apps/extension/package.json"),
        root.join("packages/shared/package.json"),
        root.join("apps/extension/public/manifest.json"),
        root.join("apps/desktop/src-tauri/tauri.conf.json"),
    ] {
        let document = read_json(&path);
        assert_eq!(
            document["version"].as_str(),
            Some(RELEASE_VERSION),
            "{} must use the MVP release version",
            path.display()
        );
    }

    let cargo_manifest = read(root.join("apps/desktop/src-tauri/Cargo.toml"));
    assert_eq!(package_version(&cargo_manifest), RELEASE_VERSION);
    assert_eq!(env!("CARGO_PKG_VERSION"), RELEASE_VERSION);
}

#[test]
fn windows_gui_subsystem_is_scoped_to_the_desktop_entry_point() {
    let root = repository_root();
    let desktop_entry = read(root.join("apps/desktop/src-tauri/src/main.rs"));
    let native_host_entry =
        read(root.join("apps/desktop/src-tauri/src/bin/ai-clip-memory-native-host.rs"));

    assert!(desktop_entry
        .starts_with("#![cfg_attr(not(debug_assertions), windows_subsystem = \"windows\")]"));
    assert!(!native_host_entry.contains("windows_subsystem"));
}

#[test]
fn extension_access_remains_narrow_with_capture_feedback() {
    let manifest = read_json(repository_root().join("apps/extension/public/manifest.json"));

    assert_eq!(manifest["name"], "Slate");
    assert_eq!(
        manifest["permissions"],
        serde_json::json!([
            "activeTab",
            "contextMenus",
            "nativeMessaging",
            "notifications"
        ])
    );
    assert!(manifest.get("host_permissions").is_none());
    assert_eq!(
        manifest["content_scripts"][0]["matches"],
        serde_json::json!([
            "https://chatgpt.com/*",
            "https://chat.openai.com/*",
            "https://claude.ai/*",
            "https://gemini.google.com/*"
        ])
    );
}

#[test]
fn visible_branding_changes_without_replacing_compatibility_identity() {
    let root = repository_root();
    let configuration = read_json(root.join("apps/desktop/src-tauri/tauri.conf.json"));
    let extension = read_json(root.join("apps/extension/public/manifest.json"));

    assert_eq!(configuration["productName"], "AI Clip Memory");
    assert_eq!(configuration["identifier"], "com.aiclipmemory.desktop");
    assert_eq!(configuration["app"]["windows"][0]["title"], "Slate");
    assert_eq!(extension["name"], "Slate");
    assert!(extension["description"].as_str().unwrap().contains("Slate"));
    assert_eq!(extension["key"].as_str().map(str::is_empty), Some(false));

    assert!(read(root.join("apps/desktop/index.html")).contains("<title>Slate</title>"));
    assert!(read(root.join("apps/desktop/launcher.html"))
        .contains("<title>Quick Search — Slate</title>"));

    let background = read(root.join("apps/desktop/src-tauri/src/background.rs"));
    assert!(background.contains("AUTOSTART_APP_NAME: &str = \"AI Clip Memory\""));
    assert!(background.contains("\"Open Slate\""));
    assert!(background.contains("\"Quit Slate\""));

    let registration = read(root.join("scripts/windows/Register-NativeMessagingHost.ps1"));
    assert!(registration.contains("AI Clip Memory\\NativeMessaging"));
    assert!(registration.contains("Slate local capture bridge"));
}

#[test]
fn tauri_is_configured_for_current_user_nsis_only() {
    let configuration = read_json(repository_root().join("apps/desktop/src-tauri/tauri.conf.json"));

    assert_eq!(configuration["bundle"]["active"], true);
    assert_eq!(
        configuration["bundle"]["targets"],
        serde_json::json!(["nsis"])
    );
    assert_eq!(
        configuration["bundle"]["windows"]["nsis"]["installMode"],
        "currentUser"
    );
    assert_eq!(
        configuration["bundle"]["windows"]["nsis"]["installerHooks"],
        "windows/installer-hooks.nsh"
    );
    assert_eq!(configuration["bundle"]["windows"]["allowDowngrades"], false);
    assert_eq!(
        configuration["bundle"]["windows"]["webviewInstallMode"],
        serde_json::json!({ "type": "downloadBootstrapper", "silent": true })
    );
}

#[test]
fn installer_hooks_register_both_browsers_and_remove_only_owned_values() {
    let hooks = read(repository_root().join("apps/desktop/src-tauri/windows/installer-hooks.nsh"));
    let lowercase = hooks.to_ascii_lowercase();

    for key in [
        format!(r"Software\Google\Chrome\NativeMessagingHosts\{HOST_NAME}"),
        format!(r"Software\Microsoft\Edge\NativeMessagingHosts\{HOST_NAME}"),
    ] {
        assert!(hooks.contains(&key), "hook should reference {key}");
    }
    assert!(hooks.contains("ReadRegStr"));
    assert!(hooks.contains("StrCmp"));
    assert!(hooks.contains("DeleteRegKey HKCU"));
    assert!(
        hooks.contains("!define AI_CLIP_MEMORY_MANIFEST_FILE \"${AI_CLIP_MEMORY_HOST_NAME}.json\"")
    );
    assert!(hooks.contains("$INSTDIR\\${AI_CLIP_MEMORY_MANIFEST_FILE}"));
    assert!(!lowercase.contains("clips.sqlite3"));
    assert!(!lowercase.contains("$appdata"));
    assert!(!lowercase.contains("rmdir /r"));
}

#[test]
fn native_messaging_template_uses_a_relative_installed_host_path() {
    let template = read_json(
        repository_root()
            .join("apps/desktop/src-tauri/windows/native-messaging-host.json.template"),
    );

    assert_eq!(template["name"], HOST_NAME);
    assert_eq!(template["path"], HOST_EXECUTABLE);
    assert_eq!(template["type"], "stdio");
    assert_eq!(template["allowed_origins"], serde_json::json!([]));
    assert!(!template.to_string().contains('*'));
}

#[cfg(windows)]
fn run_manifest_generation(arguments: &[&str]) -> Output {
    let script = repository_root().join("scripts/windows/Build-WindowsInstaller.ps1");
    Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(script)
        .args(arguments)
        .output()
        .expect("PowerShell should run the release script")
}

#[cfg(windows)]
#[test]
fn release_script_rejects_arbitrary_extension_identity_overrides() {
    let override_attempt = run_manifest_generation(&[
        "-ChromeExtensionId",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "-EdgeExtensionId",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "-Architecture",
        "arm64",
        "-ManifestOnly",
    ]);
    assert!(!override_attempt.status.success());
}

#[cfg(windows)]
#[test]
fn release_script_generates_both_exact_origins_without_placeholders() {
    let output_directory = tempfile::tempdir().expect("a temporary output directory should exist");
    let output_path = output_directory.path().to_string_lossy().into_owned();
    let output = run_manifest_generation(&[
        "-Architecture",
        "arm64",
        "-OutputDirectory",
        &output_path,
        "-ManifestOnly",
    ]);
    assert!(
        output.status.success(),
        "manifest generation failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let manifest = read_json(output_directory.path().join(format!("{HOST_NAME}.json")));
    assert_eq!(
        manifest["allowed_origins"],
        serde_json::json!([
            format!("chrome-extension://{CHROME_ID}/"),
            format!("chrome-extension://{EDGE_ID}/")
        ])
    );
    assert_eq!(manifest["path"], HOST_EXECUTABLE);
    assert!(!manifest.to_string().contains('*'));
    assert!(!manifest.to_string().contains("placeholder"));
}

#[cfg(windows)]
#[test]
fn release_identity_keeps_the_intended_edge_origin() {
    let identity = read_json(repository_root().join("apps/extension/release-identity.json"));

    assert_eq!(identity["edgeExtensionId"], EDGE_ID);
    assert_eq!(identity.as_object().map(serde_json::Map::len), Some(1));
}

#[test]
fn release_script_maps_and_labels_both_windows_architectures() {
    let script = read(repository_root().join("scripts/windows/Build-WindowsInstaller.ps1"));

    assert!(script.contains("x86_64-pc-windows-msvc"));
    assert!(script.contains("aarch64-pc-windows-msvc"));
    assert!(script.contains("x64-setup.exe"));
    assert!(script.contains("arm64-setup.exe"));
}
