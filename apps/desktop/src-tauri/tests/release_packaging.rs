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

fn package_license(cargo_manifest: &str) -> &str {
    let package_section = cargo_manifest
        .split_once("[package]")
        .expect("Cargo.toml should contain a package section")
        .1;
    let license_line = package_section
        .lines()
        .find(|line| line.trim_start().starts_with("license ="))
        .expect("the package section should contain a license");
    license_line
        .split_once('=')
        .expect("the license should use key/value syntax")
        .1
        .trim()
        .trim_matches('"')
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
fn release_license_metadata_is_mit_everywhere() {
    let root = repository_root();

    for path in [
        root.join("package.json"),
        root.join("apps/desktop/package.json"),
        root.join("apps/extension/package.json"),
        root.join("packages/shared/package.json"),
    ] {
        let document = read_json(&path);
        assert_eq!(
            document["license"].as_str(),
            Some("MIT"),
            "{} must declare the project license",
            path.display()
        );
    }

    let cargo_manifest = read(root.join("apps/desktop/src-tauri/Cargo.toml"));
    assert_eq!(package_license(&cargo_manifest), "MIT");
    assert!(root.join("LICENSE").is_file());
    assert!(root.join("THIRD_PARTY_NOTICES.md").is_file());
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
    assert_eq!(
        manifest["icons"],
        serde_json::json!({
            "16": "icons/icon-16.png",
            "32": "icons/icon-32.png",
            "48": "icons/icon-48.png",
            "128": "icons/icon-128.png"
        })
    );

    for icon in ["icon-16.png", "icon-32.png", "icon-48.png", "icon-128.png"] {
        assert!(
            repository_root()
                .join("apps/extension/public/icons")
                .join(icon)
                .is_file(),
            "extension icon {icon} should exist"
        );
    }
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

#[test]
fn public_release_workflow_keeps_compatibility_names_and_identities() {
    let root = repository_root();
    let stage_script = read(root.join("scripts/windows/Stage-WindowsRelease.ps1"));
    let extension_script = read(root.join("scripts/windows/Build-ExtensionRelease.ps1"));
    let cargo_manifest = read(root.join("apps/desktop/src-tauri/Cargo.toml"));

    assert!(stage_script.contains("Slate-$releaseVersion-Windows-x64.exe"));
    assert!(stage_script.contains("Slate-$releaseVersion-Windows-ARM64.exe"));
    assert!(extension_script.contains("Slate-Extension-$releaseVersion.zip"));
    assert!(extension_script.contains(CHROME_ID));
    assert!(cargo_manifest.contains("name = \"ai-clip-memory-native-host\""));
    assert!(cargo_manifest.contains("default-run = \"ai-clip-memory-desktop\""));
}

#[test]
fn extension_release_script_requires_a_fresh_validated_production_build() {
    let script = read(repository_root().join("scripts/windows/Build-ExtensionRelease.ps1"));

    let clean_index = script
        .find("Remove-Item -LiteralPath $extensionOutputDirectory -Recurse -Force")
        .expect("the extension output should be removed before building");
    let build_index = script
        .find("build:extension")
        .expect("the production extension build should run");
    assert!(clean_index < build_index);

    for required_check in [
        "permissions",
        "content_scripts",
        "key",
        "ConvertTo-ChromiumExtensionId",
        "forbiddenReleasePatterns",
    ] {
        assert!(script.contains(required_check));
    }
}

#[cfg(windows)]
#[test]
fn staging_copies_installers_byte_for_byte_and_writes_deterministic_checksums() {
    let root = repository_root();
    let temporary = tempfile::tempdir().expect("a temporary directory should exist");
    let source = temporary.path().join("source");
    let output = temporary.path().join("release");
    fs::create_dir_all(&source).expect("the source directory should exist");

    let x64_source = source.join("AI Clip Memory_0.1.0_x64-setup.exe");
    let arm64_source = source.join("AI Clip Memory_0.1.0_arm64-setup.exe");
    fs::write(&x64_source, b"synthetic x64 installer bytes")
        .expect("the x64 fixture should be written");
    fs::write(&arm64_source, b"synthetic arm64 installer bytes")
        .expect("the arm64 fixture should be written");

    let result = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(root.join("scripts/windows/Stage-WindowsRelease.ps1"))
        .arg("-X64InstallerPath")
        .arg(&x64_source)
        .arg("-Arm64InstallerPath")
        .arg(&arm64_source)
        .arg("-OutputDirectory")
        .arg(&output)
        .output()
        .expect("PowerShell should run the staging script");

    assert!(
        result.status.success(),
        "staging failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );

    let x64_public = output.join("Slate-0.1.0-Windows-x64.exe");
    let arm64_public = output.join("Slate-0.1.0-Windows-ARM64.exe");
    assert_eq!(
        fs::read(&x64_public).unwrap(),
        fs::read(&x64_source).unwrap()
    );
    assert_eq!(
        fs::read(&arm64_public).unwrap(),
        fs::read(&arm64_source).unwrap()
    );

    let sums = read(output.join("SHA256SUMS.txt"));
    let lines: Vec<_> = sums.lines().collect();
    assert_eq!(lines.len(), 2);
    assert!(lines[0].ends_with("  Slate-0.1.0-Windows-ARM64.exe"));
    assert!(lines[1].ends_with("  Slate-0.1.0-Windows-x64.exe"));
    assert!(lines.iter().all(|line| {
        let hash = line.split_once("  ").unwrap().0;
        hash.len() == 64
            && hash
                .chars()
                .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_lowercase())
    }));
    assert!(sums.ends_with('\n'));
}
