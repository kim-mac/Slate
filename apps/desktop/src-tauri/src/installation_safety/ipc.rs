//! Runtime exposes only participant handshakes. There is no preparation/install command.
use super::{LeaseKind, SafetyCoordinator, SafetyError, SafetyStatus};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Emitter, Manager, State, WebviewWindow};

const EVENT: &str = "slate:installation-safety";

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    generation: u64,
}
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lease {
    generation: u64,
    lease_id: u64,
}
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    preparing: bool,
    generation: u64,
    available: bool,
}
impl From<SafetyStatus> for Status {
    fn from(s: SafetyStatus) -> Self {
        Self {
            preparing: s.preparing,
            generation: s.generation,
            available: s.available,
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowLeaseKind {
    Editor,
    Inline,
    Confirmation,
}

fn caller(window: &WebviewWindow) -> Result<&str, &'static str> {
    match window.label() {
        "main" | "launcher" => Ok(window.label()),
        _ => Err("unknown_window"),
    }
}
fn error(error: SafetyError) -> &'static str {
    match error {
        SafetyError::UnknownWindow => "unknown_window",
        SafetyError::UninitializedWindow => "uninitialized_window",
        SafetyError::StaleGeneration => "stale_generation",
        SafetyError::Busy => "safety_busy",
        SafetyError::Preparing => "installation_preparing",
        SafetyError::InvalidLease => "invalid_lease",
        SafetyError::NotReady => "safety_not_ready",
        SafetyError::TimedOut => "safety_timed_out",
        SafetyError::Unavailable => "safety_unavailable",
    }
}

pub(crate) fn initialize(app: &tauri::AppHandle, safety: &Arc<SafetyCoordinator>) {
    let handle = app.clone();
    let _ = safety.observe(Arc::new(move |status| {
        for label in ["main", "launcher"] {
            let _ = handle.emit_to(label, EVENT, Status::from(status));
        }
    }));
    #[cfg(windows)]
    if let Some(window) = app.get_webview_window("main") {
        super::windows::observe(&window, safety);
    }
}

#[tauri::command]
pub fn connect_installation_safety(
    window: WebviewWindow,
    safety: State<'_, Arc<SafetyCoordinator>>,
) -> Result<Connection, &'static str> {
    let generation = safety.connect(caller(&window)?).map_err(error)?;
    Ok(Connection { generation })
}
#[tauri::command]
pub fn get_installation_safety_status(
    window: WebviewWindow,
    safety: State<'_, Arc<SafetyCoordinator>>,
) -> Result<Status, &'static str> {
    caller(&window)?;
    safety.status().map(Into::into).map_err(error)
}
#[tauri::command]
pub fn acquire_installation_lease(
    window: WebviewWindow,
    safety: State<'_, Arc<SafetyCoordinator>>,
    generation: u64,
    kind: WindowLeaseKind,
) -> Result<Lease, &'static str> {
    let kind = match kind {
        WindowLeaseKind::Editor => LeaseKind::Editor,
        WindowLeaseKind::Inline => LeaseKind::InlineEditor,
        WindowLeaseKind::Confirmation => LeaseKind::Confirmation,
    };
    let lease_id = safety
        .acquire(caller(&window)?, generation, kind)
        .map_err(error)?;
    Ok(Lease {
        generation,
        lease_id,
    })
}
#[tauri::command]
pub fn release_installation_lease(
    window: WebviewWindow,
    safety: State<'_, Arc<SafetyCoordinator>>,
    generation: u64,
    lease_id: u64,
) -> Result<(), &'static str> {
    safety
        .release(caller(&window)?, generation, lease_id)
        .map_err(error)
}
#[tauri::command]
pub fn acknowledge_installation_safety(
    window: WebviewWindow,
    safety: State<'_, Arc<SafetyCoordinator>>,
    window_generation: u64,
    preparation_generation: u64,
) -> Result<(), &'static str> {
    safety
        .acknowledge(caller(&window)?, window_generation, preparation_generation)
        .map_err(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wire_contract_uses_distinct_window_and_preparation_generations() {
        assert_eq!(
            serde_json::to_value(Connection { generation: 3 }).unwrap(),
            serde_json::json!({"generation":3})
        );
        assert_eq!(
            serde_json::to_value(Lease {
                generation: 3,
                lease_id: 5
            })
            .unwrap(),
            serde_json::json!({"generation":3,"leaseId":5})
        );
        assert_eq!(
            serde_json::to_value(Status {
                preparing: true,
                generation: 9,
                available: false
            })
            .unwrap(),
            serde_json::json!({"preparing":true,"generation":9,"available":false})
        );
        assert!(serde_json::from_str::<WindowLeaseKind>("\"editor\"").is_ok());
        assert!(serde_json::from_str::<WindowLeaseKind>("\"inline\"").is_ok());
        assert!(serde_json::from_str::<WindowLeaseKind>("\"confirmation\"").is_ok());
        assert!(serde_json::from_str::<WindowLeaseKind>("\"installer\"").is_err());
    }
}
