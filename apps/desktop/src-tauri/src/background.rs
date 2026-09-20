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

    let open = MenuItem::with_id(app, OPEN_MENU_ID, "Open Slate", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit Slate", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::include_image!("icons/runtime-tray.png"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Slate")
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

pub fn quit_app(app: &tauri::AppHandle) {
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
}
