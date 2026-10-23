use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::app_paths::{
    clip_database_path_from_app_data_dir, storage_marker_path_from_app_data_dir,
};
use crate::clips::ClipService;
use crate::installation_safety::{OperationPermit, SafetyCoordinator};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StorageBootstrapError {
    EstablishedDatabaseMissing,
    Unavailable,
}

pub struct StorageState {
    application_data_directory: PathBuf,
    service: Mutex<Option<ClipService>>,
    safety: Option<Arc<SafetyCoordinator>>,
}

impl StorageState {
    pub fn with_safety(
        application_data_directory: PathBuf,
        safety: Arc<SafetyCoordinator>,
    ) -> Self {
        Self {
            application_data_directory,
            service: Mutex::new(None),
            safety: Some(safety),
        }
    }
    pub fn new(application_data_directory: PathBuf) -> Self {
        Self {
            application_data_directory,
            service: Mutex::new(None),
            safety: None,
        }
    }

    pub fn database_path(&self) -> PathBuf {
        clip_database_path_from_app_data_dir(&self.application_data_directory)
    }

    pub fn marker_path(&self) -> PathBuf {
        storage_marker_path_from_app_data_dir(&self.application_data_directory)
    }

    pub fn with_service<T>(
        &self,
        operation: impl FnOnce(&ClipService) -> rusqlite::Result<T>,
    ) -> Result<T, StorageBootstrapError> {
        let _permit = self.admit_operation()?;
        self.with_service_inner(operation)
    }

    pub(crate) fn admit_operation(&self) -> Result<Option<OperationPermit>, StorageBootstrapError> {
        self.safety
            .as_ref()
            .map(|safety| {
                safety
                    .admit()
                    .map_err(|_| StorageBootstrapError::Unavailable)
            })
            .transpose()
    }

    /// A capture admitted before closure must finish persistence without re-admission.
    /// The permit must belong to this exact desktop coordinator and cannot be forged.
    pub(crate) fn with_admitted_service<T>(
        &self,
        permit: Option<&OperationPermit>,
        operation: impl FnOnce(&ClipService) -> rusqlite::Result<T>,
    ) -> Result<T, StorageBootstrapError> {
        if let Some(safety) = &self.safety {
            if !permit.is_some_and(|permit| permit.belongs_to(safety)) {
                return Err(StorageBootstrapError::Unavailable);
            }
        }
        self.with_service_inner(operation)
    }

    fn with_service_inner<T>(
        &self,
        operation: impl FnOnce(&ClipService) -> rusqlite::Result<T>,
    ) -> Result<T, StorageBootstrapError> {
        let service = self.cached_service()?;
        match operation(&service) {
            Ok(value) => Ok(value),
            Err(_) => {
                if let Ok(mut cached) = self.service.lock() {
                    *cached = None;
                }
                match (
                    self.marker_path().try_exists(),
                    self.database_path().try_exists(),
                ) {
                    (Ok(true), Ok(false)) => Err(StorageBootstrapError::EstablishedDatabaseMissing),
                    _ => Err(StorageBootstrapError::Unavailable),
                }
            }
        }
    }

    pub fn service(&self) -> Result<ClipService, StorageBootstrapError> {
        // Compatibility only for the native host/synthetic ungated storage. A bare
        // ClipService could outlive its permit and bypass desktop operation accounting.
        if self.safety.is_some() {
            return Err(StorageBootstrapError::Unavailable);
        }
        self.cached_service()
    }

    fn cached_service(&self) -> Result<ClipService, StorageBootstrapError> {
        let mut cached = self
            .service
            .lock()
            .map_err(|_| StorageBootstrapError::Unavailable)?;
        if let Some(service) = cached.as_ref() {
            return Ok(service.clone());
        }
        let service = bootstrap(&self.application_data_directory)?;
        *cached = Some(service.clone());
        Ok(service)
    }
}

#[cfg(test)]
mod safety_tests {
    use super::*;
    use crate::installation_safety::SafetyCoordinator;
    use std::sync::{mpsc, Arc};

    #[test]
    fn preparation_blocks_existing_database_migrations() {
        let directory = tempfile::tempdir().unwrap();
        let safety = SafetyCoordinator::new();
        let storage = StorageState::with_safety(directory.path().into(), safety.clone());
        let connection = rusqlite::Connection::open(storage.database_path()).unwrap();
        let attempt = safety.begin_preparation().unwrap();
        assert!(storage.with_service(ClipService::list).is_err());
        let version: u32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 0);
        drop(attempt);
        storage.with_service(ClipService::list).unwrap();
        let version: u32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 3);
    }

    #[test]
    fn only_the_matching_admitted_permit_can_persist_after_admission_closes() {
        let directory = tempfile::tempdir().unwrap();
        let safety = SafetyCoordinator::new();
        let storage = StorageState::with_safety(directory.path().into(), safety.clone());
        let foreign = SafetyCoordinator::new().admit().unwrap();
        let admitted = safety.admit().unwrap();
        let attempt = safety.begin_preparation().unwrap();
        assert!(storage
            .with_admitted_service(None, ClipService::list)
            .is_err());
        assert!(storage
            .with_admitted_service(Some(&foreign), ClipService::list)
            .is_err());
        assert!(!storage.database_path().exists());
        assert!(storage
            .with_admitted_service(Some(&admitted), ClipService::list)
            .is_ok());
        drop(admitted);
        drop(attempt);
    }

    #[test]
    fn preparation_rejects_bootstrap_before_creating_any_storage() {
        let directory = tempfile::tempdir().unwrap();
        let app_data = directory.path().join("not-created");
        let safety = SafetyCoordinator::new();
        let storage = StorageState::with_safety(app_data.clone(), safety.clone());
        let attempt = safety.begin_preparation().unwrap();
        assert!(storage.with_service(ClipService::list).is_err());
        assert!(!app_data.exists());
        // A bare service must never escape the desktop operation barrier.
        assert!(storage.service().is_err());
        drop(attempt);
        assert!(storage.with_service(ClipService::list).is_ok());
        assert!(app_data.exists());
        assert!(storage.service().is_err());
    }

    #[test]
    fn preparation_waits_for_entire_storage_closure_not_only_cache_lock() {
        let directory = tempfile::tempdir().unwrap();
        let safety = SafetyCoordinator::new();
        let main = safety.connect("main").unwrap();
        let launcher = safety.connect("launcher").unwrap();
        let storage = Arc::new(StorageState::with_safety(
            directory.path().to_owned(),
            safety.clone(),
        ));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let worker_storage = storage.clone();
        let worker = std::thread::spawn(move || {
            worker_storage.with_service(|service| {
                entered_tx.send(()).unwrap();
                finish_rx.recv().unwrap();
                service.list()
            })
        });
        entered_rx.recv().unwrap();
        let attempt = safety.begin_preparation().unwrap();
        let epoch = safety.status().unwrap().generation;
        safety.acknowledge("main", main, epoch).unwrap();
        safety.acknowledge("launcher", launcher, epoch).unwrap();
        let (_, attempt) = attempt
            .try_freeze()
            .err()
            .expect("active closure must block readiness");
        assert!(storage.with_service(ClipService::list).is_err());
        finish_tx.send(()).unwrap();
        worker.join().unwrap().unwrap();
        assert!(attempt.try_freeze().is_ok());
    }
}

fn bootstrap(application_data_directory: &Path) -> Result<ClipService, StorageBootstrapError> {
    let database_path = clip_database_path_from_app_data_dir(application_data_directory);
    let marker_path = storage_marker_path_from_app_data_dir(application_data_directory);
    let database_exists = database_path
        .try_exists()
        .map_err(|_| StorageBootstrapError::Unavailable)?;
    let marker_exists = marker_path
        .try_exists()
        .map_err(|_| StorageBootstrapError::Unavailable)?;
    if marker_exists && !database_exists {
        return Err(StorageBootstrapError::EstablishedDatabaseMissing);
    }
    if !database_exists {
        fs::create_dir_all(application_data_directory)
            .map_err(|_| StorageBootstrapError::Unavailable)?;
    }
    let service = if database_exists {
        ClipService::open_existing(&database_path)
    } else {
        ClipService::open(&database_path)
    }
    .map_err(|_| StorageBootstrapError::Unavailable)?;
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(marker_path)
    {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(StorageBootstrapError::Unavailable),
    }
    Ok(service)
}
