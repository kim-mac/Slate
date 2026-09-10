use crate::{
    desktop_capture,
    launcher::{self, LauncherStatus, LABEL},
};
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

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
    use super::{capture_shortcut, launcher_shortcut};

    #[test]
    fn capture_and_launcher_shortcuts_are_distinct() {
        assert_ne!(capture_shortcut(), launcher_shortcut());
    }
}
