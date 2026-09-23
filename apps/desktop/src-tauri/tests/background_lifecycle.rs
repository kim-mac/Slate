use ai_clip_memory_desktop_lib::background::{
    should_show_main_window, startup_plan, MainCloseDecision, RuntimePolicy, TrayMenuAction,
};

#[test]
fn ordinary_close_hides_until_an_explicit_quit_is_requested() {
    let policy = RuntimePolicy::default();

    assert_eq!(policy.main_close_decision(), MainCloseDecision::Hide);

    policy.request_quit();
    assert_eq!(policy.main_close_decision(), MainCloseDecision::AllowExit);
}

#[test]
fn tray_initialization_can_only_be_claimed_once_per_process() {
    let policy = RuntimePolicy::default();

    assert!(policy.claim_tray_initialization());
    assert!(!policy.claim_tray_initialization());
}

#[test]
fn main_window_and_single_tray_use_dedicated_slate_runtime_icons() {
    let source = include_str!("../src/background.rs");
    let window_icon = source
        .find("tauri::include_image!(\"icons/runtime-window.png\")")
        .expect("the main window should use the approved runtime PNG");
    let tray_icon = source
        .find("tauri::include_image!(\"icons/runtime-tray.png\")")
        .expect("the tray should use its dedicated runtime PNG");
    let tray_guard = source
        .find("claim_tray_initialization()")
        .expect("the existing one-tray-per-process guard should remain");

    assert!(window_icon < source.find("initialize_tray(app)?").unwrap());
    assert!(tray_guard < tray_icon);
    assert!(!source.contains("app.default_window_icon()"));
    assert_eq!(source.matches("tray.build(app)?").count(), 1);
}

#[test]
fn tray_menu_ids_map_only_to_the_two_approved_actions() {
    assert_eq!(TrayMenuAction::from_id("open"), TrayMenuAction::Open);
    assert_eq!(TrayMenuAction::from_id("quit"), TrayMenuAction::Quit);
    assert_eq!(
        TrayMenuAction::from_id("unexpected"),
        TrayMenuAction::Ignore
    );
}

#[test]
fn exact_autostart_argument_hides_the_main_window_without_disabling_shortcuts() {
    let autostart = startup_plan(["tin.exe", "--autostart"]);
    let manual = startup_plan(["tin.exe"]);

    assert!(autostart.start_hidden);
    assert!(autostart.initialize_shortcuts);
    assert!(!manual.start_hidden);
    assert!(manual.initialize_shortcuts);
    assert!(!should_show_main_window(autostart.start_hidden));
    assert!(should_show_main_window(manual.start_hidden));
}

#[test]
fn configured_main_window_starts_hidden_before_rust_applies_the_startup_plan() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config");
    let main = config["app"]["windows"]
        .as_array()
        .and_then(|windows| windows.iter().find(|window| window["label"] == "main"))
        .expect("configured main window");

    assert_eq!(main["visible"], false);
}

#[test]
fn single_instance_interception_is_registered_before_other_runtime_plugins_and_setup() {
    let source = include_str!("../src/lib.rs");
    let single_instance = source
        .find("tauri_plugin_single_instance::init")
        .expect("single-instance plugin registration");
    let autostart = source
        .find("tauri_plugin_autostart::Builder")
        .expect("autostart plugin registration");
    let setup = source.find(".setup(|app|").expect("application setup");

    assert!(single_instance < autostart);
    assert!(single_instance < setup);
}

#[test]
fn duplicate_activation_reuses_the_existing_main_window_presentation_path() {
    let source = include_str!("../src/lib.rs");
    let callback = source
        .split("tauri_plugin_single_instance::init")
        .nth(1)
        .expect("single-instance callback");

    assert!(callback.contains("background::show_main_window(app)"));
}

#[test]
fn launcher_open_tin_reuses_main_presentation_before_hiding_the_launcher() {
    let source = include_str!("../src/launcher.rs");
    let command = source
        .split("pub async fn open_tin_from_launcher")
        .nth(1)
        .expect("launcher Open Slate command");
    let show = command
        .find("background::show_main_window(app)")
        .expect("existing main-window presentation helper");
    let hide = command
        .find("hide_session(app, session)")
        .expect("launcher hide after opening Slate");

    assert!(show < hide);
}

#[test]
fn launcher_focus_loss_does_not_dismiss_the_window_but_close_requests_still_hide_it() {
    let source = include_str!("../src/platform/windows.rs");
    let initialization = source
        .split("pub fn initialize_launcher")
        .nth(1)
        .expect("launcher initialization");

    assert!(!initialization.contains("WindowEvent::Focused(false)"));
    assert!(initialization.contains("WindowEvent::CloseRequested"));
    assert!(initialization.contains("launcher::dismiss_window(&handle, false)"));
}

#[test]
fn similar_arguments_do_not_trigger_hidden_startup() {
    assert!(!startup_plan(["tin.exe", "--autostart=true"]).start_hidden);
    assert!(!startup_plan(["tin.exe", "autostart"]).start_hidden);
}
