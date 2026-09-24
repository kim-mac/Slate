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

fn ico_frames(path: impl AsRef<Path>) -> Vec<(u16, u16, u16)> {
    let bytes = fs::read(path.as_ref())
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.as_ref().display()));
    assert_eq!(&bytes[0..4], &[0, 0, 1, 0], "ICO header should be valid");
    let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
    let mut frames = Vec::with_capacity(count);

    for index in 0..count {
        let offset = 6 + index * 16;
        let width = if bytes[offset] == 0 {
            256
        } else {
            u16::from(bytes[offset])
        };
        let height = if bytes[offset + 1] == 0 {
            256
        } else {
            u16::from(bytes[offset + 1])
        };
        let bits_per_pixel = u16::from_le_bytes([bytes[offset + 6], bytes[offset + 7]]);
        frames.push((width, height, bits_per_pixel));
    }

    frames
}

fn png_dimensions(path: impl AsRef<Path>) -> (u32, u32) {
    let bytes = fs::read(path.as_ref())
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.as_ref().display()));
    assert_eq!(
        &bytes[0..8],
        &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    );
    (
        u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
        u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
    )
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
fn slate_brand_assets_preserve_the_approved_raster_source_and_windows_frames() {
    let root = repository_root();
    let brand_directory = root.join("assets/brand");
    let master = brand_directory.join("slate-icon-master-1024.png");

    assert!(
        master.is_file(),
        "the approved raster master should be kept"
    );
    let master_bytes = fs::read(&master).expect("the approved raster master should be readable");
    assert_eq!(
        &master_bytes[0..8],
        &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    );
    assert_eq!(
        u32::from_be_bytes(master_bytes[16..20].try_into().unwrap()),
        1024
    );
    assert_eq!(
        u32::from_be_bytes(master_bytes[20..24].try_into().unwrap()),
        1024
    );

    let metadata = read_json(brand_directory.join("brand.json"));
    assert_eq!(metadata["brand"], "Slate");
    assert_eq!(metadata["direction"], "Solid Angular Fold S");
    assert_eq!(
        metadata["canonical_visual_reference"],
        "slate-icon-master-1024.png"
    );
    let brand_readme = read(brand_directory.join("README.md"));
    assert!(brand_readme.contains("raster-derived"));
    assert!(brand_readme.contains("not a canonical SVG"));
    assert!(brand_readme.contains("16, 20, 24, 32, 48, 64, and 256 px"));

    assert!(
        !root
            .join("apps/desktop/src-tauri/icons/app-icon.svg")
            .exists(),
        "the obsolete bookmark SVG should be removed rather than replaced"
    );
    assert_eq!(
        ico_frames(root.join("apps/desktop/src-tauri/icons/icon.ico")),
        vec![
            (32, 32, 32),
            (16, 16, 32),
            (20, 20, 32),
            (24, 24, 32),
            (48, 48, 32),
            (64, 64, 32),
            (256, 256, 32),
        ]
    );
}

#[test]
fn runtime_windows_icons_use_the_approved_small_slate_artwork() {
    let root = repository_root();
    let desktop_icons = root.join("apps/desktop/src-tauri/icons");
    let extension_icons = root.join("apps/extension/public/icons");

    for (runtime, approved, size) in [
        ("runtime-window.png", "icon-32.png", 32),
        ("runtime-tray.png", "icon-16.png", 16),
    ] {
        let runtime_icon = desktop_icons.join(runtime);
        assert_eq!(png_dimensions(&runtime_icon), (size, size));
        assert_eq!(
            fs::read(runtime_icon).unwrap(),
            fs::read(extension_icons.join(approved)).unwrap(),
            "runtime icon must preserve the approved white-on-black Slate geometry and colors"
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
fn nsis_public_presentation_uses_slate_without_renaming_installed_identity() {
    let root = repository_root();
    let configuration = read_json(root.join("apps/desktop/src-tauri/tauri.conf.json"));
    let template = read(root.join("apps/desktop/src-tauri/windows/installer.nsi"));

    assert_eq!(configuration["productName"], "AI Clip Memory");
    assert_eq!(configuration["identifier"], "com.aiclipmemory.desktop");
    assert_eq!(configuration["version"], "0.1.0");
    assert_eq!(
        configuration["bundle"]["windows"]["nsis"]["customLanguageFiles"]["English"],
        "windows/installer-english.nsh"
    );
    assert!(template.contains("!define PRODUCTNAME \"{{product_name}}\""));
    assert!(template.contains("!define PUBLICNAME \"Slate\""));
    assert!(template.contains("Name \"${PUBLICNAME}\""));
    assert!(template.contains("VIAddVersionKey \"ProductName\" \"${PUBLICNAME}\""));
    assert!(template.contains("VIAddVersionKey \"FileDescription\" \"${PUBLICNAME}\""));
    assert!(
        template.contains("WriteRegStr SHCTX \"${UNINSTKEY}\" \"DisplayName\" \"${PUBLICNAME}\"")
    );
    assert_eq!(
        template
            .matches("!insertmacro CheckIfAppIsRunning \"${MAINBINARYNAME}.exe\" \"${PUBLICNAME}\"")
            .count(),
        2
    );
    assert!(template.contains("\"Open with ${PUBLICNAME}\""));

    assert!(template.contains("!define UNINSTKEY \"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCTNAME}\""));
    assert!(template.contains("!define MANUPRODUCTKEY \"${MANUKEY}\\${PRODUCTNAME}\""));
    assert!(template.contains("StrCpy $INSTDIR \"$LOCALAPPDATA\\${PRODUCTNAME}\""));
    assert!(template.contains("StrCmp \"$R0$R1\" \"${PRODUCTNAME}${MANUFACTURER}\""));
    assert!(template.contains("DeleteRegValue HKCU \"Software\\Microsoft\\Windows\\CurrentVersion\\Run\" \"${PRODUCTNAME}\""));
    assert!(template.contains("!define MAINBINARYNAME \"{{main_binary_name}}\""));
    assert!(template.contains(
        "CreateShortcut \"$SMPROGRAMS\\${PRODUCTNAME}.lnk\" \"$INSTDIR\\${MAINBINARYNAME}.exe\""
    ));
    assert!(template
        .contains("CreateShortcut \"$DESKTOP\\Slate.lnk\" \"$INSTDIR\\${MAINBINARYNAME}.exe\""));
}

#[test]
fn nsis_english_installer_messages_use_the_public_slate_name() {
    let language =
        read(repository_root().join("apps/desktop/src-tauri/windows/installer-english.nsh"));

    for message in [
        "alreadyInstalledLong",
        "appRunning",
        "appRunningOkKill",
        "choowHowToInstall",
        "failedToKillApp",
        "newerVersionInstalled",
        "olderOrUnknownVersionInstalled",
        "uninstallApp",
    ] {
        let line = language
            .lines()
            .find(|line| line.starts_with(&format!("LangString {message} ")))
            .unwrap_or_else(|| panic!("missing public installer message {message}"));
        assert!(line.contains("${PUBLICNAME}"), "{message} must say Slate");
    }
    assert!(!language.contains("${PRODUCTNAME}"));
    assert!(!language.contains("{{product_name}}"));
    assert!(!language.contains("AI Clip Memory"));
    assert_eq!(
        language
            .lines()
            .filter(|line| line.starts_with("LangString "))
            .count(),
        27
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
fn installer_migrates_only_its_own_start_menu_shortcut_to_slate() {
    let root = repository_root();
    let configuration = read_json(root.join("apps/desktop/src-tauri/tauri.conf.json"));
    let hooks = read(root.join("apps/desktop/src-tauri/windows/installer-hooks.nsh"));

    assert_eq!(configuration["productName"], "AI Clip Memory");
    assert_eq!(configuration["identifier"], "com.aiclipmemory.desktop");
    assert_eq!(
        configuration["bundle"]["windows"]["nsis"]["installMode"],
        "currentUser"
    );
    assert!(configuration["bundle"]["windows"]["nsis"]
        .get("startMenuFolder")
        .is_none());
    let preinstall = hooks
        .split_once("!macro NSIS_HOOK_PREINSTALL")
        .unwrap()
        .1
        .split_once("!macroend")
        .unwrap()
        .0;
    let postinstall = hooks
        .split_once("!macro NSIS_HOOK_POSTINSTALL")
        .unwrap()
        .1
        .split_once("!macroend")
        .unwrap()
        .0;
    let postuninstall = hooks
        .split_once("!macro NSIS_HOOK_POSTUNINSTALL")
        .unwrap()
        .1
        .split_once("!macroend")
        .unwrap()
        .0;
    assert!(hooks.contains("$SMPROGRAMS\\${PRODUCTNAME}.lnk"));
    assert!(hooks.contains("$SMPROGRAMS\\Slate.lnk"));
    assert!(hooks.contains("$INSTDIR\\${MAINBINARYNAME}.exe"));
    assert!(
        preinstall.contains("!insertmacro IsShortcutTarget \"$SMPROGRAMS\\${PRODUCTNAME}.lnk\"")
    );
    assert!(preinstall.contains("!insertmacro IsShortcutTarget \"$SMPROGRAMS\\Slate.lnk\""));
    assert!(
        postinstall.contains("!insertmacro IsShortcutTarget \"$SMPROGRAMS\\${PRODUCTNAME}.lnk\"")
    );
    assert!(postinstall.contains("!insertmacro IsShortcutTarget \"$SMPROGRAMS\\Slate.lnk\""));
    assert!(postinstall
        .contains("Rename \"$SMPROGRAMS\\${PRODUCTNAME}.lnk\" \"$SMPROGRAMS\\Slate.lnk\""));
    assert!(postinstall.contains("Delete \"$SMPROGRAMS\\${PRODUCTNAME}.lnk\""));
    assert!(postinstall.contains("!insertmacro SetLnkAppUserModelId \"$SMPROGRAMS\\Slate.lnk\""));
    assert!(postuninstall.contains("${If} $UpdateMode <> 1"));
    assert!(postuninstall.contains("!insertmacro IsShortcutTarget \"$SMPROGRAMS\\Slate.lnk\""));
    assert!(postuninstall.contains("!insertmacro UnpinShortcut \"$SMPROGRAMS\\Slate.lnk\""));
    assert!(postuninstall.contains("Delete \"$SMPROGRAMS\\Slate.lnk\""));
}

#[test]
fn nsis_desktop_shortcut_uses_a_documented_cli_2_11_4_template() {
    let root = repository_root();
    let configuration = read_json(root.join("apps/desktop/src-tauri/tauri.conf.json"));
    let template = read(root.join("apps/desktop/src-tauri/windows/installer.nsi"));

    assert_eq!(configuration["productName"], "AI Clip Memory");
    assert_eq!(configuration["identifier"], "com.aiclipmemory.desktop");
    assert_eq!(configuration["version"], "0.1.0");
    assert_eq!(
        configuration["bundle"]["windows"]["nsis"]["template"],
        "windows/installer.nsi"
    );
    assert!(template.contains("tauri-cli-v2.11.4"));
    assert!(template.contains("diff-reviewed against upstream"));
    assert!(template
        .contains("!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut"));
    assert!(template.contains("Call CreateOrUpdateDesktopShortcut"));
    assert!(template.contains("${OrIf} ${Silent}"));
    assert!(template.contains("!define PRODUCTNAME \"{{product_name}}\""));
    assert!(template.contains("!define BUNDLEID \"{{bundle_id}}\""));
}

#[test]
fn nsis_desktop_shortcut_migration_and_uninstall_are_owned_and_idempotent() {
    let template = read(repository_root().join("apps/desktop/src-tauri/windows/installer.nsi"));
    let install = template
        .split_once("Section Install")
        .expect("install section")
        .1
        .split_once("SectionEnd")
        .expect("install section end")
        .0;
    let migration = template
        .split_once("Function MigrateOwnedDesktopShortcut")
        .expect("desktop migration function")
        .1
        .split_once("FunctionEnd")
        .expect("desktop migration function end")
        .0;
    let creation = template
        .split_once("Function CreateOrUpdateDesktopShortcut")
        .expect("desktop creation function")
        .1
        .split_once("FunctionEnd")
        .expect("desktop creation function end")
        .0;
    let uninstall = template
        .split_once("; Remove desktop shortcuts")
        .expect("desktop uninstall section")
        .1
        .split_once("; Remove registry information for add/remove programs")
        .expect("desktop uninstall section end")
        .0;

    assert!(install.contains("Call MigrateOwnedDesktopShortcut"));
    assert!(creation.contains("Call MigrateOwnedDesktopShortcut"));
    assert!(
        install.find("Call MigrateOwnedDesktopShortcut").unwrap()
            < install.find("${If} $PassiveMode = 1").unwrap()
    );
    assert!(migration.contains(
        "IsShortcutTarget \"$DESKTOP\\${PRODUCTNAME}.lnk\" \"$INSTDIR\\${MAINBINARYNAME}.exe\""
    ));
    assert!(migration
        .contains("IsShortcutTarget \"$DESKTOP\\Slate.lnk\" \"$INSTDIR\\${MAINBINARYNAME}.exe\""));
    assert!(migration.contains("Rename \"$DESKTOP\\${PRODUCTNAME}.lnk\" \"$DESKTOP\\Slate.lnk\""));
    assert!(migration.contains("Delete \"$DESKTOP\\${PRODUCTNAME}.lnk\""));
    assert!(migration.contains("Call ReportDesktopShortcutFailure"));
    assert!(!migration.contains("Abort"));
    assert!(
        migration
            .find("IsShortcutTarget \"$DESKTOP\\${PRODUCTNAME}.lnk\"")
            .unwrap()
            < migration
                .find("Rename \"$DESKTOP\\${PRODUCTNAME}.lnk\"")
                .unwrap()
    );
    assert!(creation
        .contains("IsShortcutTarget \"$DESKTOP\\Slate.lnk\" \"$INSTDIR\\${MAINBINARYNAME}.exe\""));
    assert!(creation
        .contains("CreateShortcut \"$DESKTOP\\Slate.lnk\" \"$INSTDIR\\${MAINBINARYNAME}.exe\""));
    assert!(creation.contains("SetLnkAppUserModelId \"$DESKTOP\\Slate.lnk\""));
    assert!(creation.contains("${If} $UpdateMode = 1"));
    assert!(creation.contains("${OrIf} $NoShortcutMode = 1"));
    assert!(creation.contains("Return"));
    assert!(creation.contains("Call ReportDesktopShortcutFailure"));
    assert!(!creation.contains("CreateShortcut \"$DESKTOP\\${PRODUCTNAME}.lnk\""));
    assert!(
        creation
            .find("IsShortcutTarget \"$DESKTOP\\Slate.lnk\"")
            .unwrap()
            < creation
                .find("CreateShortcut \"$DESKTOP\\Slate.lnk\"")
                .unwrap()
    );
    assert!(uninstall
        .contains("IsShortcutTarget \"$DESKTOP\\Slate.lnk\" \"$INSTDIR\\${MAINBINARYNAME}.exe\""));
    assert!(uninstall.contains("Delete \"$DESKTOP\\Slate.lnk\""));
}

#[test]
fn nsis_desktop_collision_is_preflighted_before_reinstall_or_install_writes() {
    let template = read(repository_root().join("apps/desktop/src-tauri/windows/installer.nsi"));
    let on_init = template
        .split_once("Function .onInit")
        .expect("installer initialization")
        .1
        .split_once("FunctionEnd")
        .expect("installer initialization end")
        .0;
    let preflight = template
        .split_once("Function PreflightDesktopShortcutCollision")
        .expect("desktop collision preflight")
        .1
        .split_once("FunctionEnd")
        .expect("desktop collision preflight end")
        .0;

    // .onInit executes before PageLeaveReinstall can uninstall the previous
    // version, and before the WebView2 and Install sections can write files.
    assert!(on_init.contains("Call RestorePreviousInstallLocation"));
    assert!(on_init.contains("Call PreflightDesktopShortcutCollision"));
    assert!(
        on_init.find("Call RestorePreviousInstallLocation").unwrap()
            < on_init
                .find("Call PreflightDesktopShortcutCollision")
                .unwrap()
    );
    assert!(preflight.contains("IsShortcutTarget \"$DESKTOP\\Slate.lnk\""));
    assert!(preflight.contains("IsShortcutTarget \"$DESKTOP\\${PRODUCTNAME}.lnk\""));
    assert!(on_init.contains("$INSTDIR\\${MAINBINARYNAME}.exe"));
    assert!(preflight.contains("$SlateDesktopPreflightTarget"));
    assert!(preflight.contains("$NoShortcutMode"));
    assert!(preflight.contains("$UpdateMode"));
    assert!(preflight.contains("Call RejectDesktopShortcutCollision"));
    assert!(
        preflight
            .find("IsShortcutTarget \"$DESKTOP\\Slate.lnk\"")
            .unwrap()
            < preflight
                .find("IsShortcutTarget \"$DESKTOP\\${PRODUCTNAME}.lnk\"")
                .unwrap()
    );
    assert!(
        preflight
            .find("IsShortcutTarget \"$DESKTOP\\${PRODUCTNAME}.lnk\"")
            .unwrap()
            < preflight.find("$NoShortcutMode").unwrap()
    );
    assert!(
        preflight.find("$NoShortcutMode").unwrap()
            < preflight
                .rfind("Call RejectDesktopShortcutCollision")
                .unwrap()
    );
}

#[test]
fn nsis_desktop_collision_reports_interactively_and_fails_silent_or_passive() {
    let template = read(repository_root().join("apps/desktop/src-tauri/windows/installer.nsi"));
    let rejection = template
        .split_once("Function RejectDesktopShortcutCollision")
        .expect("collision rejection function")
        .1
        .split_once("FunctionEnd")
        .expect("collision rejection function end")
        .0;
    assert!(rejection.contains("${Silent}"));
    assert!(rejection.contains("$PassiveMode"));
    assert!(rejection.contains("MessageBox MB_OK|MB_ICONSTOP"));
    assert!(rejection.contains("A Desktop shortcut named Slate already exists"));
    assert!(rejection.contains("SetErrorLevel 1"));
    assert!(rejection.contains("Abort"));
}

#[test]
fn nsis_reuses_an_owned_slate_shortcut_after_an_interactive_directory_change() {
    let template = read(repository_root().join("apps/desktop/src-tauri/windows/installer.nsi"));
    let migration = template
        .split_once("Function MigrateOwnedDesktopShortcut")
        .unwrap()
        .1
        .split_once("FunctionEnd")
        .unwrap()
        .0;
    let owned_slate = migration
        .find("IsShortcutTarget \"$DESKTOP\\Slate.lnk\" \"$SlateDesktopPreflightTarget\"")
        .expect("previously owned Slate shortcut must be recognized");
    let retarget = migration
        .find("SetShortcutTarget \"$DESKTOP\\Slate.lnk\" \"$INSTDIR\\${MAINBINARYNAME}.exe\"")
        .expect("previously owned Slate shortcut must follow the final directory");
    let current_target = migration
        .find("IsShortcutTarget \"$DESKTOP\\Slate.lnk\" \"$INSTDIR\\${MAINBINARYNAME}.exe\"")
        .expect("final target remains ownership checked");
    assert!(owned_slate < retarget && retarget < current_target);
    assert!(
        retarget
            < migration
                .find("IsShortcutTarget \"$DESKTOP\\${PRODUCTNAME}.lnk\"")
                .unwrap(),
        "an already-owned Slate shortcut must follow the selected directory even without a legacy shortcut"
    );
}

#[test]
fn nsis_no_shortcut_mode_still_preflights_wix_migration() {
    let template = read(repository_root().join("apps/desktop/src-tauri/windows/installer.nsi"));
    let preflight = template
        .split_once("Function PreflightDesktopShortcutCollision")
        .unwrap()
        .1
        .split_once("FunctionEnd")
        .unwrap()
        .0;
    let skip_modes = preflight.find("$NoShortcutMode").unwrap();
    let wix_lookup = preflight[skip_modes..]
        .find("EnumRegKey")
        .expect("a prior WiX install can still force Desktop shortcut creation");
    assert!(preflight[skip_modes + wix_lookup..].contains("msiexec"));
    assert!(preflight[skip_modes + wix_lookup..].contains("Call RejectDesktopShortcutCollision"));
}

#[test]
fn nsis_no_shortcut_and_update_modes_skip_late_public_shortcut_collision() {
    let template = read(repository_root().join("apps/desktop/src-tauri/windows/installer.nsi"));
    let preflight = template
        .split_once("Function PreflightDesktopShortcutCollision")
        .unwrap()
        .1
        .split_once("FunctionEnd")
        .unwrap()
        .0;
    let creation = template
        .split_once("Function CreateOrUpdateDesktopShortcut")
        .unwrap()
        .1
        .split_once("FunctionEnd")
        .unwrap()
        .0;

    // Both modes can bypass preflight only after it has checked whether an
    // owned legacy shortcut needs migration. The same modes must then return
    // before the late Slate collision guard if WiX migration is not active.
    let legacy_preflight = preflight
        .find("IsShortcutTarget \"$DESKTOP\\${PRODUCTNAME}.lnk\"")
        .unwrap();
    let mode_preflight = preflight.find("${If} $NoShortcutMode = 1").unwrap();
    assert!(legacy_preflight < mode_preflight);

    let migrate = creation.find("Call MigrateOwnedDesktopShortcut").unwrap();
    let mode_guard = creation.find("${If} $WixMode = 0").unwrap();
    let no_shortcut = creation[mode_guard..].find("$NoShortcutMode = 1").unwrap();
    let update = creation[mode_guard..].find("$UpdateMode = 1").unwrap();
    let skip_return = creation[mode_guard..].find("Return").unwrap();
    let slate_collision = creation
        .find("IsShortcutTarget \"$DESKTOP\\Slate.lnk\"")
        .unwrap();
    assert!(migrate < mode_guard);
    assert!(no_shortcut < skip_return && update < skip_return);
    assert!(mode_guard + skip_return < slate_collision);
}

#[test]
fn nsis_optional_desktop_action_cannot_abort_after_installation() {
    let template = read(repository_root().join("apps/desktop/src-tauri/windows/installer.nsi"));
    let install = template
        .split_once("Section Install")
        .unwrap()
        .1
        .split_once("SectionEnd")
        .unwrap()
        .0;
    let migration = template
        .split_once("Function MigrateOwnedDesktopShortcut")
        .unwrap()
        .1
        .split_once("FunctionEnd")
        .unwrap()
        .0;
    let creation = template
        .split_once("Function CreateOrUpdateDesktopShortcut")
        .unwrap()
        .1
        .split_once("FunctionEnd")
        .unwrap()
        .0;
    let failure_report = template
        .split_once("Function ReportDesktopShortcutFailure")
        .unwrap()
        .1
        .split_once("FunctionEnd")
        .unwrap()
        .0;

    assert!(template
        .contains("!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut"));
    assert!(install.contains("Call MigrateOwnedDesktopShortcut"));
    assert!(install.contains("Call CreateOrUpdateDesktopShortcut"));
    assert!(migration.contains("IsShortcutTarget \"$DESKTOP\\${PRODUCTNAME}.lnk\""));
    assert!(creation.contains("IsShortcutTarget \"$DESKTOP\\Slate.lnk\""));
    assert!(!migration.contains("installation is complete"));
    assert!(failure_report.contains("StrCpy $SlateDesktopShortcutBlocked 1"));
    assert!(failure_report.contains("DetailPrint \"$R8\""));
    assert!(failure_report.contains("${IfNot} ${Silent}"));
    assert!(failure_report.contains("${AndIf} $PassiveMode != 1"));
    assert!(failure_report.contains("MessageBox MB_OK|MB_ICONEXCLAMATION \"$R8\""));
    assert!(!failure_report.contains("Abort"));
    assert!(
        creation
            .find("${If} $SlateDesktopShortcutBlocked = 1")
            .unwrap()
            < creation.find("Call MigrateOwnedDesktopShortcut").unwrap(),
        "a failed migration must not be retried by the silent or Finish-page action"
    );
    assert!(
        !migration.contains("Abort"),
        "owned-legacy migration may run after application files are written"
    );
    assert!(
        !creation.contains("Abort"),
        "Finish-page and silent/passive shortcut actions must be nonfatal"
    );
}

#[test]
fn nsis_preflight_recognizes_shortcuts_from_the_previous_install_directory() {
    let template = read(repository_root().join("apps/desktop/src-tauri/windows/installer.nsi"));
    let on_init = template
        .split_once("Function .onInit")
        .unwrap()
        .1
        .split_once("FunctionEnd")
        .unwrap()
        .0;
    let preflight = template
        .split_once("Function PreflightDesktopShortcutCollision")
        .unwrap()
        .1
        .split_once("FunctionEnd")
        .unwrap()
        .0;
    let migration = template
        .split_once("Function MigrateOwnedDesktopShortcut")
        .unwrap()
        .1
        .split_once("FunctionEnd")
        .unwrap()
        .0;

    assert!(on_init
        .contains("ReadRegStr $SlateDesktopPreviousInstallDir SHCTX \"${MANUPRODUCTKEY}\" \"\""));
    assert!(preflight.contains("$SlateDesktopPreviousInstallDir\\${MAINBINARYNAME}.exe"));
    assert!(
        preflight.contains("$SlateDesktopPreviousInstallDir\\$SlateDesktopPreviousMainBinaryName")
    );
    assert!(migration.contains("$SlateDesktopPreviousInstallDir\\${MAINBINARYNAME}.exe"));
    assert!(
        migration.contains("$SlateDesktopPreviousInstallDir\\$SlateDesktopPreviousMainBinaryName")
    );
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
fn release_zip_manifest(path: &Path) -> Value {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            r#"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($env:SLATE_RELEASE_ZIP)
try {
    $entry = $archive.GetEntry('manifest.json')
    if ($null -eq $entry) { throw 'Release ZIP is missing its root manifest.' }
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { [Console]::Out.Write($reader.ReadToEnd()) }
    finally { $reader.Dispose() }
}
finally { $archive.Dispose() }
"#,
        ])
        .env("SLATE_RELEASE_ZIP", path)
        .output()
        .expect("PowerShell should read the release ZIP");
    assert!(
        output.status.success(),
        "could not inspect release ZIP: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("release ZIP manifest should be valid JSON")
}

#[cfg(windows)]
#[test]
fn chrome_web_store_zip_omits_only_the_development_key_and_is_reproducible() {
    let root = repository_root();
    let source_manifest = read_json(root.join("apps/extension/public/manifest.json"));
    let source_key = source_manifest["key"]
        .as_str()
        .expect("development manifest should retain its public key");
    assert!(!source_key.is_empty());

    let output_directory = tempfile::tempdir().expect("release output directory should exist");
    let zip_path = output_directory.path().join("Slate-Extension-0.1.0.zip");
    let release_script = root.join("scripts/windows/Build-ExtensionRelease.ps1");
    let build = || {
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&release_script)
            .arg("-OutputDirectory")
            .arg(output_directory.path())
            .output()
            .expect("PowerShell should run extension release packaging");
        assert!(
            output.status.success(),
            "extension release packaging failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    };

    build();
    let built_manifest = read_json(root.join("apps/extension/dist/manifest.json"));
    assert_eq!(built_manifest, source_manifest);

    let packaged_manifest = release_zip_manifest(&zip_path);
    assert!(
        packaged_manifest.get("key").is_none(),
        "Chrome Web Store ZIP must omit the development-only manifest key"
    );
    let mut expected_manifest = source_manifest;
    expected_manifest
        .as_object_mut()
        .expect("source manifest should be an object")
        .remove("key");
    assert_eq!(packaged_manifest, expected_manifest);

    let first_zip = fs::read(&zip_path).expect("first ZIP should exist");
    build();
    assert_eq!(
        fs::read(&zip_path).expect("second ZIP should exist"),
        first_zip,
        "release ZIP must be byte-for-byte reproducible"
    );
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
