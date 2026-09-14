use std::{io::ErrorKind, path::Path};

use crate::{
    background::{AUTOSTART_APP_NAME, AUTOSTART_ARGUMENT},
    desktop_capture,
    launcher::{self, LauncherStatus, LABEL},
};
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use winreg::{
    enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE},
    RegKey,
};

const AUTOSTART_RUN_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AutostartAction {
    Enable,
    Disable,
    None,
}

fn autostart_action(current: bool, desired: bool) -> AutostartAction {
    match (current, desired) {
        (_, true) => AutostartAction::Enable,
        (true, false) => AutostartAction::Disable,
        _ => AutostartAction::None,
    }
}

trait RunRegistration {
    fn read_command(&self) -> Result<Option<String>, ()>;
    fn write_command(&self, command: &str) -> Result<(), ()>;
}

trait RunKey {
    fn exists(&self) -> Result<bool, ()>;
    fn create(&self) -> Result<(), ()>;
}

struct CurrentUserRunRegistration;

impl RunKey for CurrentUserRunRegistration {
    fn exists(&self) -> Result<bool, ()> {
        let current_user = RegKey::predef(HKEY_CURRENT_USER);
        match current_user.open_subkey_with_flags(AUTOSTART_RUN_KEY, KEY_READ) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
            Err(_) => Err(()),
        }
    }

    fn create(&self) -> Result<(), ()> {
        RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(AUTOSTART_RUN_KEY)
            .map(|_| ())
            .map_err(|_| ())
    }
}

impl RunRegistration for CurrentUserRunRegistration {
    fn read_command(&self) -> Result<Option<String>, ()> {
        let current_user = RegKey::predef(HKEY_CURRENT_USER);
        let run = current_user
            .open_subkey_with_flags(AUTOSTART_RUN_KEY, KEY_READ)
            .map_err(|_| ())?;
        match run.get_value(AUTOSTART_APP_NAME) {
            Ok(command) => Ok(Some(command)),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(_) => Err(()),
        }
    }

    fn write_command(&self, command: &str) -> Result<(), ()> {
        let current_user = RegKey::predef(HKEY_CURRENT_USER);
        current_user
            .open_subkey_with_flags(AUTOSTART_RUN_KEY, KEY_SET_VALUE)
            .and_then(|run| run.set_value(AUTOSTART_APP_NAME, &command))
            .map_err(|_| ())
    }
}

fn expected_autostart_command(executable: &Path) -> Result<String, &'static str> {
    if !executable.is_absolute() {
        return Err("startup_executable_unavailable");
    }
    let executable = executable
        .to_str()
        .filter(|path| !path.contains('"'))
        .ok_or("startup_executable_unavailable")?;
    Ok(format!(r#""{executable}" {AUTOSTART_ARGUMENT}"#))
}

fn ensure_run_key(key: &impl RunKey) -> Result<(), &'static str> {
    if !key.exists().map_err(|_| "startup_update_failed")? {
        key.create().map_err(|_| "startup_update_failed")?;
    }
    Ok(())
}

fn current_autostart_command() -> Result<String, &'static str> {
    let executable = std::env::current_exe().map_err(|_| "startup_executable_unavailable")?;
    expected_autostart_command(&executable)
}

fn validate_registration(
    plugin_enabled: bool,
    stored_command: Option<&str>,
    expected_command: &str,
) -> Result<bool, &'static str> {
    if !plugin_enabled {
        return Ok(false);
    }
    if stored_command == Some(expected_command) {
        Ok(true)
    } else {
        Err("startup_registration_invalid")
    }
}

fn normalize_registration(
    registration: &impl RunRegistration,
    expected_command: &str,
) -> Result<(), &'static str> {
    if registration
        .read_command()
        .map_err(|_| "startup_update_failed")?
        .as_deref()
        != Some(expected_command)
    {
        registration
            .write_command(expected_command)
            .map_err(|_| "startup_update_failed")?;
    }
    if registration
        .read_command()
        .map_err(|_| "startup_update_failed")?
        .as_deref()
        == Some(expected_command)
    {
        Ok(())
    } else {
        Err("startup_update_failed")
    }
}

fn read_validated_autostart_state(
    plugin_enabled: bool,
    expected_command: &str,
) -> Result<bool, &'static str> {
    let registration = CurrentUserRunRegistration;
    let stored_command = registration
        .read_command()
        .map_err(|_| "startup_state_unavailable")?;
    validate_registration(plugin_enabled, stored_command.as_deref(), expected_command)
}

pub fn get_autostart_enabled(app: &tauri::AppHandle) -> Result<bool, &'static str> {
    let plugin_enabled = app
        .autolaunch()
        .is_enabled()
        .map_err(|_| "startup_state_unavailable")?;
    if !plugin_enabled {
        return Ok(false);
    }
    let expected_command = current_autostart_command()?;
    read_validated_autostart_state(plugin_enabled, &expected_command)
}

pub fn set_autostart_enabled(app: &tauri::AppHandle, enabled: bool) -> Result<bool, &'static str> {
    let manager = app.autolaunch();
    let current = manager
        .is_enabled()
        .map_err(|_| "startup_state_unavailable")?;
    match autostart_action(current, enabled) {
        AutostartAction::Enable => {
            ensure_run_key(&CurrentUserRunRegistration)?;
            manager.enable().map_err(|_| "startup_update_failed")?;
            let expected_command = current_autostart_command()?;
            normalize_registration(&CurrentUserRunRegistration, &expected_command)?;
        }
        AutostartAction::Disable => manager.disable().map_err(|_| "startup_update_failed")?,
        AutostartAction::None => {}
    }
    let plugin_enabled = manager
        .is_enabled()
        .map_err(|_| "startup_state_unavailable")?;
    if !plugin_enabled {
        return Ok(false);
    }
    let expected_command = current_autostart_command()?;
    read_validated_autostart_state(plugin_enabled, &expected_command)
}

pub fn initialize_launcher(app: &tauri::AppHandle) {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("launcher.html".into()))
        .title("Search clips")
        .inner_size(640.0, 420.0)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .build();
    let launcher_window_available = match window {
        Ok(window) => {
            let handle = app.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Focused(false) => launcher::dismiss_window(&handle, true),
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    launcher::dismiss_window(&handle, false);
                }
                _ => {}
            });
            true
        }
        Err(_) => false,
    };

    let launcher_binding = launcher_shortcut();
    let capture_binding = capture_shortcut();
    let plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, received, event| {
            if received == &launcher_binding {
                launcher::shortcut_event(app, event.state() == ShortcutState::Pressed);
            } else if received == &capture_binding {
                desktop_capture::shortcut_event(app, event.state() == ShortcutState::Pressed);
            }
        })
        .build();
    if app.plugin(plugin).is_err() {
        launcher::set_status(app, LauncherStatus::unavailable("shortcut_unavailable"));
        return;
    }

    let launcher_registered =
        launcher_window_available && app.global_shortcut().register(launcher_shortcut()).is_ok();
    let capture_registered = app.global_shortcut().register(capture_shortcut()).is_ok();
    launcher::set_status(
        app,
        if launcher_registered {
            LauncherStatus::available()
        } else {
            LauncherStatus::unavailable("shortcut_unavailable")
        },
    );
    if !capture_registered {
        let _ = app
            .notification()
            .builder()
            .title("Tin")
            .body("Desktop capture shortcut is unavailable")
            .show();
    }
}

fn launcher_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

fn capture_shortcut() -> Shortcut {
    Shortcut::new(
        Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),
        Code::KeyC,
    )
}

pub fn present_launcher(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
) -> Result<(), &'static str> {
    // A visible activation focuses the existing session without moving the UI.
    if !window.is_visible().map_err(|_| "launcher_unavailable")? {
        let monitor = app
            .cursor_position()
            .ok()
            .and_then(|point| app.monitor_from_point(point.x, point.y).ok().flatten())
            .or_else(|| {
                app.get_webview_window("main")
                    .and_then(|w| w.current_monitor().ok().flatten())
            })
            .or_else(|| app.primary_monitor().ok().flatten())
            .ok_or("launcher_unavailable")?;
        let area = monitor.work_area();
        let bounds = launcher::launcher_bounds(
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
            monitor.scale_factor(),
        )
        .ok_or("launcher_unavailable")?;
        window
            .set_position(PhysicalPosition::new(bounds.x, bounds.y))
            .map_err(|_| "launcher_unavailable")?;
        window
            .set_size(PhysicalSize::new(bounds.width, bounds.height))
            .map_err(|_| "launcher_unavailable")?;
        window.show().map_err(|_| "launcher_unavailable")?;
    }
    window.set_focus().map_err(|_| "launcher_unavailable")?;
    let webview: &tauri::Webview = window.as_ref();
    webview.set_focus().map_err(|_| "launcher_unavailable")
}

#[cfg(test)]
mod tests {
    use std::{
        cell::{Cell, RefCell},
        collections::BTreeMap,
        path::Path,
    };

    use super::{
        autostart_action, capture_shortcut, ensure_run_key, expected_autostart_command,
        launcher_shortcut, normalize_registration, validate_registration, AutostartAction, RunKey,
        RunRegistration,
    };

    #[derive(Default)]
    struct MemoryRunKey {
        exists: Cell<bool>,
        values: RefCell<BTreeMap<String, String>>,
        create_error: Cell<bool>,
        create_calls: Cell<usize>,
    }

    impl RunKey for MemoryRunKey {
        fn exists(&self) -> Result<bool, ()> {
            Ok(self.exists.get())
        }

        fn create(&self) -> Result<(), ()> {
            self.create_calls.set(self.create_calls.get() + 1);
            if self.create_error.get() {
                return Err(());
            }
            self.exists.set(true);
            Ok(())
        }
    }

    #[derive(Default)]
    struct MemoryRegistration {
        command: RefCell<Option<String>>,
        writes: RefCell<Vec<String>>,
    }

    impl MemoryRegistration {
        fn with_command(command: &str) -> Self {
            Self {
                command: RefCell::new(Some(command.to_owned())),
                writes: RefCell::new(Vec::new()),
            }
        }
    }

    impl RunRegistration for MemoryRegistration {
        fn read_command(&self) -> Result<Option<String>, ()> {
            Ok(self.command.borrow().clone())
        }

        fn write_command(&self, command: &str) -> Result<(), ()> {
            self.command.replace(Some(command.to_owned()));
            self.writes.borrow_mut().push(command.to_owned());
            Ok(())
        }
    }

    #[test]
    fn capture_and_launcher_shortcuts_are_distinct() {
        assert_ne!(capture_shortcut(), launcher_shortcut());
    }

    #[test]
    fn autostart_updates_are_idempotent() {
        assert_eq!(autostart_action(false, false), AutostartAction::None);
        assert_eq!(autostart_action(true, true), AutostartAction::Enable);
        assert_eq!(autostart_action(false, true), AutostartAction::Enable);
        assert_eq!(autostart_action(true, false), AutostartAction::Disable);
    }

    #[test]
    fn expected_autostart_command_quotes_the_executable_and_places_the_argument_after_it() {
        assert_eq!(
            expected_autostart_command(Path::new(
                r"C:\Users\Kim\AppData\Local\AI Clip Memory\ai-clip-memory-desktop.exe"
            )),
            Ok(
                r#""C:\Users\Kim\AppData\Local\AI Clip Memory\ai-clip-memory-desktop.exe" --autostart"#
                    .to_owned()
            )
        );
    }

    #[test]
    fn expected_autostart_command_rejects_paths_that_cannot_be_safely_quoted() {
        assert!(expected_autostart_command(Path::new(r#"C:\Apps\"Tin"\tin.exe"#)).is_err());
    }

    #[test]
    fn registration_validation_rejects_an_unquoted_or_malformed_command() {
        let expected = r#""C:\Program Files\Tin\tin.exe" --autostart"#;

        assert_eq!(
            validate_registration(
                true,
                Some(r"C:\Program Files\Tin\tin.exe --autostart"),
                expected
            ),
            Err("startup_registration_invalid")
        );
        assert_eq!(
            validate_registration(
                true,
                Some(r#""C:\Program Files\Tin\tin.exe --autostart""#),
                expected
            ),
            Err("startup_registration_invalid")
        );
    }

    #[test]
    fn registration_validation_accepts_only_the_exact_expected_command() {
        let expected = r#""C:\Program Files\Tin\tin.exe" --autostart"#;

        assert_eq!(
            validate_registration(true, Some(expected), expected),
            Ok(true)
        );
        assert_eq!(
            validate_registration(false, Some(expected), expected),
            Ok(false)
        );
    }

    #[test]
    fn normalization_is_idempotent_once_the_registration_is_correct() {
        let expected = r#""C:\Program Files\Tin\tin.exe" --autostart"#;
        let registration =
            MemoryRegistration::with_command(r"C:\Program Files\Tin\tin.exe --autostart");

        assert_eq!(normalize_registration(&registration, expected), Ok(()));
        assert_eq!(normalize_registration(&registration, expected), Ok(()));
        assert_eq!(registration.command.borrow().as_deref(), Some(expected));
        assert_eq!(registration.writes.borrow().as_slice(), [expected]);
    }

    #[test]
    fn missing_run_key_is_created_without_writing_values() {
        let key = MemoryRunKey::default();

        assert_eq!(ensure_run_key(&key), Ok(()));
        assert!(key.exists.get());
        assert_eq!(key.create_calls.get(), 1);
        assert!(key.values.borrow().is_empty());
    }

    #[test]
    fn existing_run_key_and_unrelated_values_are_left_intact() {
        let key = MemoryRunKey::default();
        key.exists.set(true);
        key.values
            .borrow_mut()
            .insert("Unrelated App".to_owned(), "unrelated.exe".to_owned());

        assert_eq!(ensure_run_key(&key), Ok(()));
        assert_eq!(key.create_calls.get(), 0);
        assert_eq!(
            key.values.borrow().get("Unrelated App").map(String::as_str),
            Some("unrelated.exe")
        );
    }

    #[test]
    fn run_key_creation_failure_is_reported() {
        let key = MemoryRunKey::default();
        key.create_error.set(true);

        assert_eq!(ensure_run_key(&key), Err("startup_update_failed"));
        assert!(!key.exists.get());
        assert!(key.values.borrow().is_empty());
    }
}
