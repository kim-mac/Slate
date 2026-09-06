use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::app_paths::{
    clip_database_path_from_app_data_dir, storage_marker_path_from_app_data_dir,
};
use crate::clips::ClipService;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StorageBootstrapError {
    EstablishedDatabaseMissing,
    Unavailable,
}

pub struct StorageState {
    application_data_directory: PathBuf,
    service: Mutex<Option<ClipService>>,
}

impl StorageState {
    pub fn new(application_data_directory: PathBuf) -> Self {
        Self {
            application_data_directory,
            service: Mutex::new(None),
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
        let service = self.service()?;
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
