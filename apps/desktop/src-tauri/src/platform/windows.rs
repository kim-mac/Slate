use crate::launcher::{self, LauncherStatus, LABEL};
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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
    let Ok(window) = window else {
        launcher::set_status(app, LauncherStatus::unavailable("launcher_unavailable"));
        return;
    };
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(false) => launcher::dismiss_window(&handle, true),
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            launcher::dismiss_window(&handle, false);
        }
        _ => {}
    });

    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    let plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, received, event| {
            if received == &shortcut {
                launcher::shortcut_event(app, event.state() == ShortcutState::Pressed);
            }
        })
        .build();
    let registered = app.plugin(plugin).is_ok() && app.global_shortcut().register(shortcut).is_ok();
    launcher::set_status(
        app,
        if registered {
            LauncherStatus::available()
        } else {
            LauncherStatus::unavailable("shortcut_unavailable")
        },
    );
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
