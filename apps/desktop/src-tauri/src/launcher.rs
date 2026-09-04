use serde::Serialize;
use std::sync::{Condvar, Mutex};
use tauri::{Emitter, Manager};

pub const LABEL: &str = "launcher";
const EVENT: &str = "launcher-state";
const UNAVAILABLE: &str = "launcher_unavailable";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct LauncherSnapshot {
    pub session: u64,
    pub visible: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherStatus {
    pub available: bool,
    pub shortcut: &'static str,
    pub error_code: Option<&'static str>,
}

impl LauncherStatus {
    pub fn available() -> Self {
        Self {
            available: true,
            shortcut: "Ctrl+Shift+Space",
            error_code: None,
        }
    }
    pub fn unavailable(code: &'static str) -> Self {
        Self {
            available: false,
            shortcut: "Ctrl+Shift+Space",
            error_code: Some(code),
        }
    }
}

struct LauncherPolicy {
    status: LauncherStatus,
    snapshot: LauncherSnapshot,
    ready: bool,
    pending: bool,
    pressed: bool,
    exiting: bool,
    hiding: bool,
    initializing: bool,
}
impl LauncherPolicy {
    fn new(status: LauncherStatus) -> Self {
        Self {
            status,
            snapshot: LauncherSnapshot {
                session: 0,
                visible: false,
            },
            ready: false,
            pending: false,
            pressed: false,
            exiting: false,
            hiding: false,
            initializing: false,
        }
    }
    fn snapshot(&self) -> LauncherSnapshot {
        self.snapshot
    }
    fn ready(&mut self) -> LauncherSnapshot {
        self.ready = true;
        if self.pending && !self.exiting && self.status.available {
            self.open();
        }
        self.snapshot
    }
    fn open(&mut self) {
        self.pending = false;
        if !self.snapshot.visible {
            self.snapshot.session += 1;
            self.snapshot.visible = true;
        }
    }
    fn shortcut(&mut self, pressed: bool) -> Option<LauncherSnapshot> {
        let repeated = self.pressed && pressed;
        self.pressed = pressed;
        if !pressed || repeated || self.exiting || !self.status.available {
            return None;
        }
        if !self.ready {
            self.pending = true;
            return None;
        }
        self.open();
        Some(self.snapshot)
    }
    fn hide(&mut self, session: u64) -> Option<LauncherSnapshot> {
        if !self.snapshot.visible || self.snapshot.session != session {
            return None;
        }
        self.snapshot.visible = false;
        Some(self.snapshot)
    }
    fn begin_hide(&mut self, session: u64) -> Option<LauncherSnapshot> {
        if self.hiding || !self.snapshot.visible || self.snapshot.session != session {
            return None;
        }
        self.hiding = true;
        Some(LauncherSnapshot {
            visible: false,
            ..self.snapshot
        })
    }
    fn finish_hide(&mut self, session: u64, succeeded: bool) {
        self.hiding = false;
        if succeeded {
            self.hide(session);
        }
    }
    fn exit(&mut self) {
        self.exiting = true;
        self.pending = false;
        self.snapshot.visible = false;
    }
    fn status(&self) -> LauncherStatus {
        self.status.clone()
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct LauncherBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
pub fn launcher_bounds(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
) -> Option<LauncherBounds> {
    if width == 0 || height == 0 || !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let window_width = ((640.0 * scale).round() as u32).max(1).min(width);
    let window_height = ((420.0 * scale).round() as u32).max(1).min(height);
    Some(LauncherBounds {
        x: i32::try_from(i64::from(x) + i64::from((width - window_width) / 2)).ok()?,
        y: i32::try_from(i64::from(y) + i64::from((height - window_height) / 2)).ok()?,
        width: window_width,
        height: window_height,
    })
}

pub struct LauncherController(Mutex<LauncherPolicy>, Condvar);

impl Default for LauncherController {
    fn default() -> Self {
        let mut policy = LauncherPolicy::new(LauncherStatus::unavailable(UNAVAILABLE));
        policy.initializing = true;
        Self(Mutex::new(policy), Condvar::new())
    }
}

impl LauncherController {
    fn finish_initialization(&self, status: LauncherStatus) {
        if let Ok(mut policy) = self.0.lock() {
            policy.status = status;
            policy.initializing = false;
            self.1.notify_all();
        }
    }
    fn wait_for_status(&self) -> LauncherStatus {
        self.0
            .lock()
            .and_then(|policy| self.1.wait_while(policy, |p| p.initializing))
            .map(|policy| policy.status())
            .unwrap_or_else(|_| LauncherStatus::unavailable(UNAVAILABLE))
    }
}

pub fn set_status(app: &tauri::AppHandle, status: LauncherStatus) {
    app.state::<LauncherController>()
        .finish_initialization(status);
}

// All transitions and native window effects are serialized on the event-loop
// thread. Commands do not block that thread while waiting for their result.
async fn on_main<T: Send + 'static>(
    app: tauri::AppHandle,
    action: impl FnOnce(&tauri::AppHandle) -> Result<T, &'static str> + Send + 'static,
) -> Result<T, &'static str> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(action(&handle));
    })
    .map_err(|_| UNAVAILABLE)?;
    tauri::async_runtime::spawn_blocking(move || receive.recv().map_err(|_| UNAVAILABLE))
        .await
        .map_err(|_| UNAVAILABLE)?
        .and_then(|result| result)
}

fn apply_snapshot(app: &tauri::AppHandle, snapshot: LauncherSnapshot) -> Result<(), &'static str> {
    let window = app.get_webview_window(LABEL).ok_or(UNAVAILABLE)?;
    let result = if snapshot.visible {
        crate::platform::present_launcher(app, &window)
    } else {
        window.hide().map_err(|_| UNAVAILABLE)
    };
    if result.is_err() {
        set_status(app, LauncherStatus::unavailable(UNAVAILABLE));
        if let Ok(mut policy) = app.state::<LauncherController>().0.lock() {
            policy.hide(snapshot.session);
        }
        let _ = window.hide();
        let _ = window.emit(
            EVENT,
            LauncherSnapshot {
                visible: false,
                ..snapshot
            },
        );
        return Err(UNAVAILABLE);
    }
    window.emit(EVENT, snapshot).map_err(|_| UNAVAILABLE)
}

pub fn shortcut_event(app: &tauri::AppHandle, pressed: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let snapshot = handle
            .state::<LauncherController>()
            .0
            .lock()
            .ok()
            .and_then(|mut p| p.shortcut(pressed));
        if let Some(snapshot) = snapshot {
            let _ = apply_snapshot(&handle, snapshot);
        }
    });
}

fn hide_session(app: &tauri::AppHandle, session: u64) -> Result<(), &'static str> {
    let snapshot = app
        .state::<LauncherController>()
        .0
        .lock()
        .map_err(|_| UNAVAILABLE)?
        .begin_hide(session);
    if let Some(snapshot) = snapshot {
        let result = app
            .get_webview_window(LABEL)
            .ok_or(UNAVAILABLE)
            .and_then(|window| window.hide().map_err(|_| UNAVAILABLE));
        app.state::<LauncherController>()
            .0
            .lock()
            .map_err(|_| UNAVAILABLE)?
            .finish_hide(session, result.is_ok());
        // A native hide failure leaves the frontend/session intact for retry.
        result?;
        app.get_webview_window(LABEL)
            .ok_or(UNAVAILABLE)?
            .emit(EVENT, snapshot)
            .map_err(|_| UNAVAILABLE)?;
    }
    Ok(())
}

pub fn dismiss_window(app: &tauri::AppHandle, check_focus: bool) {
    // Capture the token at event receipt, not when the queued action executes.
    let session = app
        .state::<LauncherController>()
        .0
        .lock()
        .ok()
        .map(|p| p.snapshot().session);
    let handle = app.clone();
    if let Some(session) = session {
        let _ = app.run_on_main_thread(move || {
            if check_focus
                && handle
                    .get_webview_window(LABEL)
                    .is_some_and(|w| w.is_focused().unwrap_or(false))
            {
                return;
            }
            let _ = hide_session(&handle, session);
        });
    }
}

pub fn exit(app: &tauri::AppHandle) {
    if let Ok(mut policy) = app.state::<LauncherController>().0.lock() {
        policy.exit();
    }
}

#[tauri::command]
pub async fn launcher_ready(app: tauri::AppHandle) -> Result<LauncherSnapshot, &'static str> {
    on_main(app, |app| {
        let (before, after) = {
            let state = app.state::<LauncherController>();
            let mut policy = state.0.lock().map_err(|_| UNAVAILABLE)?;
            (policy.snapshot(), policy.ready())
        };
        if before != after {
            apply_snapshot(app, after)?;
        }
        Ok(after)
    })
    .await
}

#[tauri::command]
pub async fn hide_launcher(app: tauri::AppHandle, session: u64) -> Result<(), &'static str> {
    on_main(app, move |app| hide_session(app, session)).await
}

#[tauri::command]
pub async fn get_launcher_status(app: tauri::AppHandle) -> LauncherStatus {
    // WebView initialization can pump IPC before setup finishes. Wait off the
    // event loop so a main-window status request cannot observe partial setup.
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<LauncherController>().wait_for_status()
    })
    .await
    .unwrap_or_else(|_| LauncherStatus::unavailable(UNAVAILABLE))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn available() -> LauncherPolicy {
        LauncherPolicy::new(LauncherStatus::available())
    }

    #[test]
    fn status_waits_for_initialization_instead_of_reporting_false_failure() {
        let controller = std::sync::Arc::new(LauncherController::default());
        let reader = controller.clone();
        let (send, receive) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || send.send(reader.wait_for_status()).unwrap());
        assert!(receive
            .recv_timeout(std::time::Duration::from_millis(20))
            .is_err());
        controller.finish_initialization(LauncherStatus::available());
        assert!(
            receive
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap()
                .available
        );
        thread.join().unwrap();
    }

    #[test]
    fn failed_native_hide_preserves_session_and_allows_retry() {
        let mut policy = available();
        policy.ready();
        let opened = policy.shortcut(true).unwrap();
        assert!(policy.begin_hide(opened.session).is_some());
        assert!(policy.begin_hide(opened.session).is_none());
        policy.finish_hide(opened.session, false);
        assert_eq!(policy.snapshot(), opened);
        assert!(policy.status().available);
        assert!(policy.begin_hide(opened.session).is_some());
        policy.finish_hide(opened.session, true);
        assert!(!policy.snapshot().visible);
        assert!(policy.begin_hide(opened.session).is_none());
    }

    #[test]
    fn early_activation_waits_for_ready_and_is_not_lost() {
        let mut policy = available();
        assert_eq!(policy.shortcut(true), None);
        assert_eq!(
            policy.snapshot(),
            LauncherSnapshot {
                session: 0,
                visible: false
            }
        );
        assert_eq!(
            policy.ready(),
            LauncherSnapshot {
                session: 1,
                visible: true
            }
        );
        assert_eq!(policy.ready(), policy.snapshot());
    }

    #[test]
    fn repeated_press_is_latched_and_visible_activation_reuses_session() {
        let mut policy = available();
        policy.ready();
        let first = policy.shortcut(true).unwrap();
        assert_eq!(first.session, 1);
        assert_eq!(policy.shortcut(true), None);
        assert_eq!(policy.shortcut(false), None);
        assert_eq!(policy.shortcut(true), Some(first));
    }

    #[test]
    fn stale_hide_cannot_dismiss_a_later_session() {
        let mut policy = available();
        policy.ready();
        let first = policy.shortcut(true).unwrap();
        assert_eq!(
            policy.hide(first.session),
            Some(LauncherSnapshot {
                visible: false,
                ..first
            })
        );
        // Holding the shortcut cannot reopen a dismissed window.
        assert_eq!(policy.shortcut(true), None);
        policy.shortcut(false);
        let second = policy.shortcut(true).unwrap();
        assert_eq!(second.session, first.session + 1);
        assert_eq!(policy.hide(first.session), None);
        assert!(policy.snapshot().visible);
    }

    #[test]
    fn shortcut_failure_is_safe_nonfatal_and_never_opens() {
        let mut policy = LauncherPolicy::new(LauncherStatus::unavailable("shortcut_unavailable"));
        policy.ready();
        assert_eq!(policy.shortcut(true), None);
        let status = serde_json::to_value(policy.status()).unwrap();
        assert_eq!(
            status,
            serde_json::json!({"available":false,"shortcut":"Ctrl+Shift+Space","errorCode":"shortcut_unavailable"})
        );
    }

    #[test]
    fn main_exit_cancels_pending_or_visible_openings() {
        let mut policy = available();
        policy.shortcut(true);
        policy.exit();
        assert!(!policy.ready().visible);
        policy.shortcut(false);
        assert_eq!(policy.shortcut(true), None);
        let mut visible = available();
        visible.ready();
        visible.shortcut(true);
        visible.exit();
        assert!(!visible.snapshot().visible);
    }

    #[test]
    fn lifecycle_payload_contains_no_clip_data() {
        let mut policy = available();
        policy.ready();
        let snapshot = policy.shortcut(true).unwrap();
        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            serde_json::json!({"session":1,"visible":true})
        );
    }

    #[test]
    fn bounds_use_physical_work_area_and_monitor_dpi() {
        assert_eq!(
            launcher_bounds(-1920, 40, 1920, 1040, 1.5),
            Some(LauncherBounds {
                x: -1440,
                y: 245,
                width: 960,
                height: 630
            })
        );
        assert_eq!(
            launcher_bounds(0, 0, 320, 200, 2.0),
            Some(LauncherBounds {
                x: 0,
                y: 0,
                width: 320,
                height: 200
            })
        );
        assert_eq!(
            launcher_bounds(0, 0, 1000, 1000, 1.0),
            Some(LauncherBounds {
                x: 180,
                y: 290,
                width: 640,
                height: 420
            })
        );
    }

    #[test]
    fn invalid_monitor_dimensions_or_dpi_are_rejected() {
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(launcher_bounds(0, 0, 100, 100, scale), None);
        }
        assert_eq!(launcher_bounds(0, 0, 0, 100, 1.0), None);
    }
}
