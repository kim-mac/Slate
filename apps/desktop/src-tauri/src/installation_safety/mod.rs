//! Desktop participant safety. Preparation remains internal and installation disabled.
mod coordinator;
pub(crate) use coordinator::PreparationGuard;
pub use coordinator::{LeaseKind, OperationPermit, SafetyCoordinator, SafetyError, SafetyStatus};

#[cfg(windows)]
pub mod gate;

#[cfg(windows)]
impl coordinator::ProcessGate for gate::InstallationGate {
    fn admit(&self) -> Result<Box<dyn Send>, SafetyError> {
        self.admit()
            .map(|permit| Box::new(permit) as Box<dyn Send>)
            .map_err(gate_error)
    }
    fn maintenance(&self, deadline: std::time::Instant) -> Result<Box<dyn Send>, SafetyError> {
        self.maintenance(deadline)
            .map(|permit| Box::new(permit) as Box<dyn Send>)
            .map_err(gate_error)
    }
}
#[cfg(windows)]
fn gate_error(error: std::io::Error) -> SafetyError {
    match error.kind() {
        std::io::ErrorKind::WouldBlock => SafetyError::Busy,
        std::io::ErrorKind::TimedOut => SafetyError::TimedOut,
        _ => SafetyError::Unavailable,
    }
}
#[cfg(windows)]
impl SafetyCoordinator {
    pub(crate) fn for_current_installation() -> std::sync::Arc<Self> {
        Self::with_gate(std::sync::Arc::new(gate::UserGate::new()))
    }
}

/// Absence is an unavailable authority, never an ungated coordinator. Once an
/// anchor exists it is retained for this process; recovery cannot switch files.
#[cfg(windows)]
impl coordinator::ProcessGate for gate::UserGate {
    fn available(&self) -> bool {
        self.available()
    }
    fn prepare(&self) -> Result<(), SafetyError> {
        drop(coordinator::ProcessGate::admit(self)?);
        Ok(())
    }
    fn admit(&self) -> Result<Box<dyn Send>, SafetyError> {
        self.admit()
            .map(|permit| Box::new(permit) as Box<dyn Send>)
            .map_err(gate_error)
    }
    fn maintenance(&self, deadline: std::time::Instant) -> Result<Box<dyn Send>, SafetyError> {
        self.maintenance(deadline)
            .map(|permit| Box::new(permit) as Box<dyn Send>)
            .map_err(gate_error)
    }
}

pub(crate) mod ipc;
#[cfg(windows)]
pub(crate) mod windows;

#[cfg(all(test, windows))]
mod unavailable_storage_tests {
    use super::*;
    use std::{path::PathBuf, process::Command, sync::Arc};

    #[test]
    fn desktop_absent_authority_rejects_bootstrap_and_recovers_under_existing_editor_lease() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .unwrap()
            .join("dist")
            .join("test")
            .join("updater-maintenance-gate")
            .join(format!(
                "desktop-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        std::fs::create_dir_all(root.parent().unwrap()).unwrap();
        gate::InstallationGate::create_test_profile(&root).unwrap();
        let path = gate::InstallationGate::prepare_test_namespace(&root).unwrap();
        let who = Command::new("whoami.exe")
            .args(["/user", "/fo", "csv", "/nh"])
            .output()
            .unwrap();
        assert!(who.status.success());
        let sid = String::from_utf8(who.stdout)
            .unwrap()
            .trim()
            .rsplit(',')
            .next()
            .unwrap()
            .trim_matches('"')
            .to_owned();
        let denied = Command::new("icacls.exe")
            .arg(path.parent().unwrap())
            .args(["/deny", &format!("*{sid}:(W)")])
            .output()
            .unwrap();
        assert!(denied.status.success());
        let retry = Arc::new(gate::UserGate::for_test_root(&root).unwrap());
        let safety = SafetyCoordinator::with_gate(retry);
        let main = safety.connect("main").unwrap();
        let lease = safety.acquire("main", main, LeaseKind::Editor).unwrap();
        let data = root.join("desktop-synthetic-data");
        let storage = crate::storage::StorageState::with_safety(data.clone(), safety.clone());
        assert!(!safety.status().unwrap().available);
        assert!(storage
            .with_service(crate::clips::ClipService::list)
            .is_err());
        assert!(matches!(
            safety.begin_preparation(),
            Err(SafetyError::Unavailable)
        ));
        assert!(!data.exists());
        assert!(!path.exists());
        let repaired = Command::new("icacls.exe")
            .arg(path.parent().unwrap())
            .args(["/remove:d", &format!("*{sid}")])
            .output()
            .unwrap();
        assert!(repaired.status.success());
        assert!(storage
            .with_service(crate::clips::ClipService::list)
            .is_ok());
        assert!(safety.status().unwrap().available);
        assert!(storage.database_path().exists());
        safety.release("main", main, lease).unwrap();
    }
}
