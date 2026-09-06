use std::fs;
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::Duration;

use ai_clip_memory_desktop_lib::storage::{StorageBootstrapError, StorageState};

#[test]
fn genuine_first_run_creates_database_and_marker() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let storage = StorageState::new(directory.path().to_owned());
    storage
        .with_service(|service| service.list())
        .expect("first-run storage should initialize");
    assert!(storage.database_path().is_file());
    assert!(storage.marker_path().is_file());
}

#[test]
fn concurrent_bootstrap_shares_one_database_and_marker() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let app_data = Arc::new(directory.path().join("app-data"));
    let barrier = Arc::new(Barrier::new(3));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let app_data = Arc::clone(&app_data);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                let storage = StorageState::new(app_data.as_ref().clone());
                barrier.wait();
                storage.with_service(|service| service.list())
            })
        })
        .collect();
    barrier.wait();
    for handle in handles {
        handle
            .join()
            .expect("the bootstrap thread should not panic")
            .expect("both bootstrap attempts should succeed");
    }
    let storage = StorageState::new(app_data.as_ref().clone());
    assert!(storage.database_path().is_file());
    assert!(storage.marker_path().is_file());
}

#[test]
fn an_existing_database_without_a_marker_is_adopted() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let storage = StorageState::new(directory.path().to_owned());
    ai_clip_memory_desktop_lib::clips::ClipService::open(storage.database_path())
        .expect("the prior-version database should open");
    storage
        .with_service(|service| service.list())
        .expect("the existing database should be adopted");
    assert!(storage.marker_path().is_file());
}

#[test]
fn a_missing_established_database_is_never_recreated() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let storage = StorageState::new(directory.path().to_owned());
    fs::write(storage.marker_path(), []).expect("the marker should be created");
    let error = storage
        .with_service(|service| service.list())
        .expect_err("missing established storage should fail");
    assert_eq!(error, StorageBootstrapError::EstablishedDatabaseMissing);
    assert!(!storage.database_path().exists());
}

#[test]
fn deletion_after_initialization_is_reported_without_replacement() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let storage = StorageState::new(directory.path().to_owned());
    storage
        .with_service(|service| service.list())
        .expect("storage should initialize");
    fs::remove_file(storage.database_path()).expect("the fixture database should be removed");
    let error = storage
        .with_service(|service| service.list())
        .expect_err("a missing established database should fail immediately");
    assert_eq!(error, StorageBootstrapError::EstablishedDatabaseMissing);
    assert!(!storage.database_path().exists());
}

#[test]
fn corrupt_storage_is_left_untouched_and_can_be_retried() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let storage = StorageState::new(directory.path().to_owned());
    fs::write(storage.database_path(), b"not sqlite")
        .expect("the corrupt database fixture should be created");
    let before = fs::read(storage.database_path()).expect("fixture should be readable");
    assert!(storage.with_service(|service| service.list()).is_err());
    assert_eq!(fs::read(storage.database_path()).unwrap(), before);
    assert!(!storage.marker_path().exists());
    assert!(storage.with_service(|service| service.list()).is_err());
}

#[test]
fn transient_unavailability_does_not_poison_future_retries() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let app_data = directory.path().join("app-data");
    fs::write(&app_data, b"temporarily blocked").expect("a file should block the directory");
    let storage = StorageState::new(app_data.clone());
    assert!(storage.with_service(|service| service.list()).is_err());
    fs::remove_file(&app_data).expect("the blocker should be removable");
    storage
        .with_service(|service| service.list())
        .expect("a later retry should initialize storage");
}

#[test]
fn brief_sqlite_lock_contention_waits_and_recovers() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let storage = Arc::new(StorageState::new(directory.path().to_owned()));
    storage
        .with_service(|service| service.list())
        .expect("storage should initialize");
    let blocker = rusqlite::Connection::open(storage.database_path())
        .expect("the blocking connection should open");
    blocker
        .execute_batch("BEGIN EXCLUSIVE")
        .expect("the fixture should acquire an exclusive lock");
    let waiting_storage = Arc::clone(&storage);
    let handle = thread::spawn(move || waiting_storage.with_service(|service| service.list()));
    thread::sleep(Duration::from_millis(100));
    blocker
        .execute_batch("COMMIT")
        .expect("the fixture lock should be released");
    handle
        .join()
        .expect("the waiting thread should not panic")
        .expect("the operation should recover within the existing busy timeout");
}
