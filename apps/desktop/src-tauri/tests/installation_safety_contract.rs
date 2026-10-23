use serde_json::Value;

const COMMANDS: [&str; 5] = [
    "connect_installation_safety",
    "get_installation_safety_status",
    "acquire_installation_lease",
    "release_installation_lease",
    "acknowledge_installation_safety",
];

#[test]
fn inline_close_completion_is_main_only_and_registered_with_narrow_permission() {
    let lib = include_str!("../src/lib.rs");
    let build = include_str!("../build.rs");
    let main: Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
    let launcher: Value =
        serde_json::from_str(include_str!("../capabilities/launcher.json")).unwrap();
    assert!(lib.contains("background::hide_main_after_inline_save"));
    assert!(build.contains("\"hide_main_after_inline_save\""));
    let permission = Value::String("allow-hide-main-after-inline-save".into());
    assert!(main["permissions"]
        .as_array()
        .unwrap()
        .contains(&permission));
    assert!(!launcher["permissions"]
        .as_array()
        .unwrap()
        .contains(&permission));
    let background = include_str!("../src/background.rs");
    assert!(background.contains("slate:inline-close-requested"));
    assert!(background.contains("with_main_hide"));
}

#[test]
fn inline_content_is_an_optional_compare_on_the_existing_update_command() {
    let commands = include_str!("../src/commands.rs");
    let command = commands
        .split("pub fn update_clip(")
        .nth(1)
        .unwrap()
        .split("#[tauri::command]")
        .next()
        .unwrap();
    assert!(command.contains("expected_content: Option<String>"));
    assert!(command.contains("validate_update_input(input, expected_content.is_some())"));
    assert!(command.contains("service.update_content("));
    assert!(command.contains("service.update("));
}

#[test]
fn only_window_handshake_ipc_is_registered_for_both_windows() {
    let lib = include_str!("../src/lib.rs");
    let build = include_str!("../build.rs");
    for capability in [
        include_str!("../capabilities/default.json"),
        include_str!("../capabilities/launcher.json"),
    ] {
        let value: Value = serde_json::from_str(capability).unwrap();
        for command in COMMANDS {
            assert!(
                lib.contains(&format!("installation_safety::ipc::{command}")),
                "{command} must be registered"
            );
            assert!(
                build.contains(&format!("\"{command}\"")),
                "{command} must have ACL metadata"
            );
            let allow = format!("allow-{}", command.replace('_', "-"));
            assert!(value["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p.as_str() == Some(&allow)));
        }
        for permission in value["permissions"].as_array().unwrap() {
            let name = permission.as_str().unwrap();
            assert!(!name.contains("prepare") && !name.contains("install-update"));
        }
    }
    assert!(!build.contains("\"begin_preparation\""));
    assert!(!lib.contains("installation_safety::begin_preparation"));
}

#[test]
fn desktop_storage_capture_and_autostart_share_the_runtime_coordinator() {
    let lib = include_str!("../src/lib.rs");
    assert!(lib.contains("StorageState::with_safety"));
    let capture = include_str!("../src/desktop_capture.rs");
    let shortcut = capture
        .split("pub(crate) fn shortcut_event")
        .nth(1)
        .unwrap();
    assert!(shortcut.contains("capture_and_persist("));
    assert!(!shortcut.contains("persist_capture("));
    let commands = include_str!("../src/commands.rs");
    let setter = commands
        .split("pub async fn set_autostart_enabled")
        .nth(1)
        .unwrap()
        .split("#[derive")
        .next()
        .unwrap();
    assert!(setter.contains(".admit()"));
    assert!(lib.contains("tauri::WindowEvent::Destroyed"));
    assert!(lib.contains("tauri::webview::PageLoadEvent::Started"));
    let platform = include_str!("../src/installation_safety/windows.rs");
    assert!(platform.contains("ProcessFailedEventHandler"));
    assert!(platform.contains("add_ProcessFailed"));
    assert!(platform.contains("disconnected"));
}

#[test]
fn copy_command_holds_one_admission_through_the_clipboard_write() {
    let commands = include_str!("../src/commands.rs");
    let copy = commands
        .split("pub fn copy_clip_content")
        .nth(1)
        .unwrap()
        .split("#[tauri::command]")
        .next()
        .unwrap();
    assert!(copy.contains(".admit_operation()"));
    assert!(copy.contains(".with_admitted_service(permit.as_ref()"));
    assert!(!copy.contains(".with_service("));
    assert!(copy.contains(".write_text(content)"));
}

#[test]
fn production_entrypoints_use_the_same_installation_gate_without_install_ipc() {
    let lib = include_str!("../src/lib.rs");
    assert!(lib.contains("SafetyCoordinator::for_current_installation()"));
    let host = include_str!("../src/bin/ai-clip-memory-native-host.rs");
    assert!(host.contains("InstallationGate::for_current_user()"));
    assert!(!host.contains("for_current_executable"));
    assert!(!lib.contains("for_current_installation()?"));
    let module = include_str!("../src/installation_safety/mod.rs");
    assert!(module.contains("gate::UserGate::new()"));
    let gate = include_str!("../src/installation_safety/gate.rs");
    assert!(!gate.contains("current_exe("));
    assert!(!gate.contains("current_dir("));
    assert!(!gate.contains(".slate-maintenance-v1.lock"));
    assert!(gate.contains("maintenance-v2.lock"));
    let profile = include_str!("../src/installation_safety/profile.rs");
    for api in [
        "GetUserProfileDirectoryW",
        "OpenProcessToken",
        "TokenUser",
        "ProfileImagePath",
    ] {
        assert!(profile.contains(api));
    }
    for variable in ["USERPROFILE", "APPDATA", "LOCALAPPDATA"] {
        assert!(!profile.contains(variable));
    }
    assert!(host.contains("run_with_storage("));
    assert!(!host.contains("StorageState::new"));
    assert!(!host.contains("SLATE_GATE_TEST_ROOT"));
    let bridge = include_str!("../src/bridge/native_host.rs");
    let guarded = bridge.split("pub fn run_with_storage").nth(1).unwrap();
    assert!(guarded.find("let Ok(_permit)").unwrap() < guarded.find("StorageState::new").unwrap());
    assert!(guarded.contains("run_once(reader, writer, &service)"));
    let coordinator = include_str!("../src/installation_safety/coordinator.rs");
    let admit = coordinator
        .split("pub fn admit(self:")
        .nth(1)
        .unwrap()
        .split("pub(crate) fn begin_preparation")
        .next()
        .unwrap();
    assert!(admit.find("drop(p)").unwrap() < admit.find("gate.admit()").unwrap());
}
