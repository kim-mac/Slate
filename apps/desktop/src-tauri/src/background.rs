use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

pub const AUTOSTART_ARGUMENT: &str = "--autostart";
pub const AUTOSTART_APP_NAME: &str = "AI Clip Memory";
const TRAY_ID: &str = "tin-background";
const OPEN_MENU_ID: &str = "open";
const QUIT_MENU_ID: &str = "quit";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MainCloseDecision {
    Hide,
    AllowExit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TrayMenuAction {
    Open,
    Quit,
    Ignore,
}

impl TrayMenuAction {
    pub fn from_id(id: &str) -> Self {
        match id {
            OPEN_MENU_ID => Self::Open,
            QUIT_MENU_ID => Self::Quit,
            _ => Self::Ignore,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StartupPlan {
    pub start_hidden: bool,
    pub initialize_shortcuts: bool,
}

pub fn startup_plan<I, S>(args: I) -> StartupPlan
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    StartupPlan {
        start_hidden: args
            .into_iter()
            .any(|argument| argument.as_ref() == AUTOSTART_ARGUMENT),
        initialize_shortcuts: true,
    }
}

pub fn should_show_main_window(start_hidden: bool) -> bool {
    !start_hidden
}

#[derive(Default)]
pub struct RuntimePolicy {
    quit_requested: AtomicBool,
    tray_initialized: AtomicBool,
}

impl RuntimePolicy {
    pub fn request_quit(&self) {
        self.quit_requested.store(true, Ordering::SeqCst);
    }

    pub fn main_close_decision(&self) -> MainCloseDecision {
        if self.quit_requested.load(Ordering::SeqCst) {
            MainCloseDecision::AllowExit
        } else {
            MainCloseDecision::Hide
        }
    }

    pub fn claim_tray_initialization(&self) -> bool {
        self.tray_initialized
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }
}

pub fn initialize(app: &mut tauri::App, start_hidden: bool) -> tauri::Result<()> {
    app.manage(RuntimePolicy::default());
    if let Some(window) = app.get_webview_window("main") {
        window.set_icon(tauri::include_image!("icons/runtime-window.png"))?;
    }
    initialize_tray(app)?;

    if should_show_main_window(start_hidden) {
        if let Some(window) = app.get_webview_window("main") {
            window.show()?;
            window.set_focus()?;
        }
    }

    Ok(())
}

fn initialize_tray(app: &tauri::App) -> tauri::Result<()> {
    if !app.state::<RuntimePolicy>().claim_tray_initialization() {
        return Ok(());
    }

    let name = if cfg!(feature = "macos-dev") {
        "Slate macOS Development"
    } else if cfg!(feature = "ux-dev") {
        "Slate UX Development"
    } else {
        "Slate"
    };
    let open_label = if cfg!(feature = "macos-dev") {
        "Open Slate macOS Development"
    } else if cfg!(feature = "ux-dev") {
        "Open Slate UX Development"
    } else {
        "Open Slate"
    };
    let quit_label = if cfg!(feature = "macos-dev") {
        "Quit Slate macOS Development"
    } else if cfg!(feature = "ux-dev") {
        "Quit Slate UX Development"
    } else {
        "Quit Slate"
    };
    let open = MenuItem::with_id(app, OPEN_MENU_ID, open_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::include_image!("icons/runtime-tray.png"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(name)
        .on_menu_event(
            |app, event| match TrayMenuAction::from_id(event.id().as_ref()) {
                TrayMenuAction::Open => {
                    let _ = show_main_window(app);
                }
                TrayMenuAction::Quit => quit_app(app),
                TrayMenuAction::Ignore => {}
            },
        );

    tray.build(app)?;
    Ok(())
}

pub fn show_main_window(app: &tauri::AppHandle) -> Result<(), &'static str> {
    let window = app
        .get_webview_window("main")
        .ok_or("main_window_unavailable")?;
    present_window(&window)
}

pub(crate) fn close_main_window(window: &tauri::Window) {
    use crate::installation_safety::SafetyCoordinator;
    use std::sync::Arc;
    use tauri::Emitter;

    let Some(safety) = window.try_state::<Arc<SafetyCoordinator>>() else {
        return;
    };
    match safety.main_close_needs_save() {
        Ok(true) => {
            let _ = window.emit_to("main", "slate:inline-close-requested", ());
        }
        Ok(false) => {
            let _ = safety.with_main_close_hide(|| window.hide());
        }
        Err(_) => {} // Unavailable/ambiguous safety must leave the draft visible.
    }
}

#[tauri::command]
pub fn hide_main_after_inline_save(
    window: tauri::WebviewWindow,
    safety: tauri::State<'_, std::sync::Arc<crate::installation_safety::SafetyCoordinator>>,
) -> Result<(), &'static str> {
    safety
        .with_main_hide(window.label(), || window.hide())
        .map_err(|_| "inline_close_not_ready")?
        .map_err(|_| "main_window_unavailable")
}

trait MainWindowOperations {
    fn unminimize_main(&self) -> Result<(), ()>;
    fn show_main(&self) -> Result<(), ()>;
    fn focus_main(&self) -> Result<(), ()>;
}

impl MainWindowOperations for tauri::WebviewWindow {
    fn unminimize_main(&self) -> Result<(), ()> {
        self.unminimize().map_err(|_| ())
    }

    fn show_main(&self) -> Result<(), ()> {
        self.show().map_err(|_| ())
    }

    fn focus_main(&self) -> Result<(), ()> {
        self.set_focus().map_err(|_| ())
    }
}

fn present_window(window: &impl MainWindowOperations) -> Result<(), &'static str> {
    window
        .unminimize_main()
        .map_err(|_| "main_window_unavailable")?;
    window.show_main().map_err(|_| "main_window_unavailable")?;
    window.focus_main().map_err(|_| "main_window_unavailable")
}

/// Shared production delegation; tests substitute only the final OS exit effects.
pub(crate) fn with_update_exit(
    authorization: crate::installation_safety::UpdateExitAuthorization,
    runtime: &RuntimePolicy,
    exit: impl FnOnce(),
) -> Result<(), crate::installation_safety::SafetyError> {
    authorization.begin_exit()?;
    runtime.request_quit();
    exit();
    Ok(())
}

pub(crate) fn quit_after_update(
    app: &tauri::AppHandle,
    authorization: crate::installation_safety::UpdateExitAuthorization,
) {
    if with_update_exit(authorization, &app.state::<RuntimePolicy>(), || {
        crate::launcher::exit(app);
        app.exit(0);
    })
    .is_err()
    {
        // Fail closed without dropping the controller's maintenance/staging pins.
        eprintln!("Slate could not authorize updater exit.");
    }
}

pub fn quit_app(app: &tauri::AppHandle) {
    use crate::installation_safety::SafetyCoordinator;
    use std::sync::Arc;
    use tauri::Emitter;
    use tauri_plugin_notification::NotificationExt;
    let allowed = app
        .try_state::<Arc<SafetyCoordinator>>()
        .is_some_and(|safety| safety.begin_quit().is_ok());
    if !allowed {
        // Never queue a deferred Quit: a failed save must leave the draft usable.
        let _ = show_main_window(app);
        let _ = app.emit("slate:quit-blocked", ());
        let _ = app.notification().builder().title("Slate is still open")
            .body("Finish saving in Slate or Quick Search, or press Escape to cancel inline editing, then choose Quit again.")
            .show();
        return;
    }
    app.state::<RuntimePolicy>().request_quit();
    crate::launcher::exit(app);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::{present_window, MainWindowOperations};

    #[derive(Default)]
    struct RecordingWindow {
        operations: RefCell<Vec<&'static str>>,
    }

    impl MainWindowOperations for RecordingWindow {
        fn unminimize_main(&self) -> Result<(), ()> {
            self.operations.borrow_mut().push("unminimize");
            Ok(())
        }

        fn show_main(&self) -> Result<(), ()> {
            self.operations.borrow_mut().push("show");
            Ok(())
        }

        fn focus_main(&self) -> Result<(), ()> {
            self.operations.borrow_mut().push("focus");
            Ok(())
        }
    }

    #[test]
    fn opening_tin_restores_shows_and_focuses_the_existing_window() {
        let window = RecordingWindow::default();

        present_window(&window).expect("the main window should be presented");

        assert_eq!(*window.operations.borrow(), ["unminimize", "show", "focus"]);
    }

    #[test]
    fn retired_update_authorization_cannot_change_runtime_or_invoke_exit() {
        let safety = crate::installation_safety::SafetyCoordinator::new();
        let main = safety.connect("main").unwrap();
        let launcher = safety.connect("launcher").unwrap();
        let attempt = safety.begin_user_preparation().unwrap();
        let epoch = safety.status().unwrap().generation;
        safety.acknowledge("main", main, epoch).unwrap();
        safety.acknowledge("launcher", launcher, epoch).unwrap();
        let mut guard = match attempt.try_freeze() {
            Ok(guard) => guard,
            Err(_) => panic!("acknowledged preparation must freeze"),
        };
        let authorization = guard.handoff(|| Ok::<(), ()>(())).unwrap().ok().unwrap();
        drop(guard);
        let runtime = super::RuntimePolicy::default();
        assert_eq!(
            super::with_update_exit(authorization, &runtime, || panic!("must not exit")),
            Err(crate::installation_safety::SafetyError::NotReady)
        );
        assert_eq!(
            runtime.main_close_decision(),
            super::MainCloseDecision::Hide
        );
        assert!(safety.admit().is_ok());
    }
}
