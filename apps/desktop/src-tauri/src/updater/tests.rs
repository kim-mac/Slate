use super::*;
use futures_util::{future::poll_fn, FutureExt};
use std::{
    collections::VecDeque,
    sync::atomic::{AtomicBool, Ordering},
    task::{Poll, Waker},
    time::{Duration, Instant},
};

struct Gate<T> {
    state: Mutex<(Option<T>, Option<Waker>)>,
    dropped: Arc<AtomicBool>,
}
impl<T> Default for Gate<T> {
    fn default() -> Self {
        Self {
            state: Mutex::new((None, None)),
            dropped: Arc::new(AtomicBool::new(false)),
        }
    }
}
struct DropAcknowledgement(Arc<AtomicBool>);
impl Drop for DropAcknowledgement {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}
impl<T: Send + 'static> Gate<T> {
    fn send(&self, value: T) {
        let mut state = self.state.lock().unwrap();
        state.0 = Some(value);
        if let Some(waker) = state.1.take() {
            waker.wake();
        }
    }
    fn future(self: &Arc<Self>) -> BoxFuture<'static, T> {
        let gate = self.clone();
        let acknowledgement = DropAcknowledgement(self.dropped.clone());
        poll_fn(move |cx| {
            let _retain_until_future_drops = &acknowledgement;
            let mut state = gate.state.lock().unwrap();
            if let Some(value) = state.0.take() {
                Poll::Ready(value)
            } else {
                state.1 = Some(cx.waker().clone());
                Poll::Pending
            }
        })
        .boxed()
    }
    fn await_dropped(&self) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while !self.dropped.load(Ordering::SeqCst) {
            assert!(
                Instant::now() < deadline,
                "cancelled driver future was not dropped"
            );
            std::thread::yield_now();
        }
    }
}
type CheckGate = Arc<Gate<Result<Option<Offer>, SafeError>>>;
type DownloadGate = Arc<Gate<Result<Vec<u8>, SafeError>>>;
#[derive(Default)]
struct TestDriver {
    checks: Mutex<VecDeque<CheckGate>>,
    downloads: Mutex<VecDeque<DownloadGate>>,
    callbacks: Mutex<Vec<ProgressCallback>>,
    enabled: bool,
}
impl Driver for TestDriver {
    fn configured(&self) -> bool {
        self.enabled
    }
    fn check(&self) -> BoxFuture<'static, Result<Option<Offer>, SafeError>> {
        self.checks
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected check")
            .future()
    }
    fn download(
        &self,
        _: Offer,
        progress: ProgressCallback,
    ) -> BoxFuture<'static, Result<Vec<u8>, SafeError>> {
        self.callbacks.lock().unwrap().push(progress);
        self.downloads
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected download")
            .future()
    }
}
fn fixture() -> (
    Arc<UpdateController>,
    Arc<TestDriver>,
    Arc<Mutex<Vec<UpdateSnapshot>>>,
) {
    let driver = Arc::new(TestDriver {
        enabled: true,
        ..Default::default()
    });
    let events = Arc::new(Mutex::new(Vec::new()));
    let receive = events.clone();
    let controller = UpdateController::new(
        "1.2.3".into(),
        driver.clone(),
        Arc::new(move |snapshot| receive.lock().unwrap().push(snapshot)),
    );
    (controller, driver, events)
}
fn queue_check(driver: &TestDriver) -> CheckGate {
    let gate = Arc::new(Gate::default());
    driver.checks.lock().unwrap().push_back(gate.clone());
    gate
}
fn queue_download(driver: &TestDriver) -> DownloadGate {
    let gate = Arc::new(Gate::default());
    driver.downloads.lock().unwrap().push_back(gate.clone());
    gate
}
fn offer(version: &str) -> Offer {
    Offer {
        version: version.into(),
        payload: Arc::new(()),
    }
}
fn await_phase(controller: &UpdateController, phase: Phase) -> UpdateSnapshot {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let snapshot = controller.snapshot();
        if snapshot.phase == phase {
            return snapshot;
        }
        assert!(
            Instant::now() < deadline,
            "wanted {phase:?}, got {snapshot:?}"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
}
fn available(controller: &Arc<UpdateController>, driver: &TestDriver) {
    let gate = queue_check(driver);
    assert_eq!(controller.check().phase, Phase::Checking);
    gate.send(Ok(Some(offer("1.3.0"))));
    await_phase(controller, Phase::Available);
}

#[derive(Default)]
struct TestInstaller {
    staged: Mutex<Vec<(String, Vec<u8>)>>,
    launches: Arc<std::sync::atomic::AtomicUsize>,
    quits: std::sync::atomic::AtomicUsize,
    launch_fails: bool,
}
struct TestStage(Arc<std::sync::atomic::AtomicUsize>, bool);
impl StagedInstall for TestStage {
    fn launch(&mut self) -> Result<(), SafeError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        if self.1 {
            Err(SafeError::HANDOFF_FAILED)
        } else {
            Ok(())
        }
    }
}
impl InstallBoundary for TestInstaller {
    fn stage(&self, version: &str, bytes: Arc<[u8]>) -> Result<Box<dyn StagedInstall>, SafeError> {
        self.staged
            .lock()
            .unwrap()
            .push((version.into(), bytes.to_vec()));
        Ok(Box::new(TestStage(
            self.launches.clone(),
            self.launch_fails,
        )))
    }
    fn quit(&self) {
        self.quits.fetch_add(1, Ordering::SeqCst);
    }
}
fn ready(controller: &Arc<UpdateController>, driver: &TestDriver) {
    available(controller, driver);
    let download = queue_download(driver);
    controller.download();
    download.send(Ok(vec![1, 2, 3]));
    await_phase(controller, Phase::Ready);
}
fn install_safety() -> Arc<crate::installation_safety::SafetyCoordinator> {
    let safety = crate::installation_safety::SafetyCoordinator::new();
    let main = safety.connect("main").unwrap();
    let launcher = safety.connect("launcher").unwrap();
    let weak = Arc::downgrade(&safety);
    safety
        .observe(Arc::new(move |state| {
            if state.preparing {
                let safety = weak.upgrade().unwrap();
                let _ = safety.acknowledge("main", main, state.generation);
                let _ = safety.acknowledge("launcher", launcher, state.generation);
            }
        }))
        .unwrap();
    safety
}

#[test]
fn explicitly_disabled_installation_still_rejects_a_verified_download() {
    let (controller, driver, _) = fixture();
    ready(&controller, &driver);
    controller
        .state
        .lock()
        .unwrap()
        .snapshot
        .installation_enabled = false;
    let install = Arc::new(TestInstaller::default());
    assert_eq!(
        controller.restart(install_safety(), install.clone()),
        Err(SafeError::INSTALLATION_DISABLED)
    );
    assert!(install.staged.lock().unwrap().is_empty());
    assert_eq!(install.launches.load(Ordering::SeqCst), 0);
    assert_eq!(install.quits.load(Ordering::SeqCst), 0);
    assert_eq!(controller.snapshot().phase, Phase::Ready);
}

#[test]
fn production_constructor_enables_only_configured_windows_installation() {
    let (controller, _, _) = fixture();
    assert_eq!(controller.snapshot().installation_enabled, cfg!(windows));
    let unconfigured = UpdateController::new(
        "0.3.0".into(),
        Arc::new(TestDriver::default()),
        Arc::new(|_| {}),
    );
    assert!(!unconfigured.snapshot().installation_enabled);
    assert_eq!(unconfigured.snapshot().phase, Phase::Unconfigured);
}

#[cfg(windows)]
#[test]
fn production_discovery_and_verified_download_never_install_without_user_restart() {
    let (controller, driver, _) = fixture();
    assert!(controller.snapshot().installation_enabled);
    let install = Arc::new(TestInstaller::default());
    assert!(controller
        .restart(install_safety(), install.clone())
        .is_err());
    available(&controller, &driver);
    assert!(driver.callbacks.lock().unwrap().is_empty());
    assert!(controller
        .restart(install_safety(), install.clone())
        .is_err());
    let download = queue_download(&driver);
    controller.download();
    assert!(controller
        .restart(install_safety(), install.clone())
        .is_err());
    download.send(Ok(vec![1, 2, 3]));
    await_phase(&controller, Phase::Ready);
    controller.dismiss();
    controller.check();
    assert!(install.staged.lock().unwrap().is_empty());
    assert_eq!(install.launches.load(Ordering::SeqCst), 0);
    assert_eq!(install.quits.load(Ordering::SeqCst), 0);
    controller
        .restart(install_safety(), install.clone())
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while install.quits.load(Ordering::SeqCst) == 0 {
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    assert_eq!(install.launches.load(Ordering::SeqCst), 1);
}

#[cfg(windows)]
#[test]
fn production_failed_authentication_or_missing_verified_inputs_never_reaches_handoff() {
    let (controller, driver, _) = fixture();
    available(&controller, &driver);
    let download = queue_download(&driver);
    controller.download();
    download.send(Err(SafeError::SIGNATURE_FAILURE));
    await_phase(&controller, Phase::Error);
    let install = Arc::new(TestInstaller::default());
    assert!(controller.state.lock().unwrap().verified_bytes.is_none());
    assert!(controller
        .restart(install_safety(), install.clone())
        .is_err());
    let retry = queue_download(&driver);
    controller.download();
    retry.send(Ok(vec![1, 2, 3]));
    await_phase(&controller, Phase::Ready);
    for missing_offer in [false, true] {
        {
            let mut state = controller.state.lock().unwrap();
            state.snapshot.phase = Phase::Ready;
            state.offer = (!missing_offer).then(|| offer("1.3.0"));
            state.verified_bytes = missing_offer.then(|| Arc::from([1_u8, 2, 3]));
        }
        assert!(controller
            .restart(install_safety(), install.clone())
            .is_err());
    }
    assert!(install.staged.lock().unwrap().is_empty());
    assert_eq!(install.launches.load(Ordering::SeqCst), 0);
    assert_eq!(install.quits.load(Ordering::SeqCst), 0);
}

#[cfg(windows)]
#[test]
fn production_editors_in_both_windows_block_installation_without_discarding_leases() {
    for label in ["main", "launcher"] {
        let (controller, driver, _) = fixture();
        ready(&controller, &driver);
        assert!(controller.snapshot().installation_enabled);
        let safety = install_safety();
        let window = safety.connect(label).unwrap();
        let lease = safety
            .acquire(label, window, crate::installation_safety::LeaseKind::Editor)
            .unwrap();
        let install = Arc::new(TestInstaller::default());
        controller.restart(safety.clone(), install.clone()).unwrap();
        let snapshot = await_phase(&controller, Phase::Ready);
        assert_eq!(snapshot.error, Some(SafeError::UNSAFE_TO_RESTART));
        assert!(!safety.status().unwrap().preparing);
        safety.release(label, window, lease).unwrap();
        assert_eq!(install.launches.load(Ordering::SeqCst), 0);
        assert_eq!(install.quits.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn user_restart_retains_verified_version_and_bytes_and_keeps_admission_closed_until_exit() {
    let (controller, driver, _) = fixture();
    ready(&controller, &driver);
    controller
        .state
        .lock()
        .unwrap()
        .snapshot
        .installation_enabled = true;
    let install = Arc::new(TestInstaller::default());
    let safety = install_safety();
    let active = safety.admit().unwrap();
    assert_eq!(
        controller
            .restart(safety.clone(), install.clone())
            .unwrap()
            .phase,
        Phase::Preparing
    );
    assert!(controller.restart(safety.clone(), install.clone()).is_err());
    assert_eq!(install.launches.load(Ordering::SeqCst), 0);
    assert!(safety.admit().is_err());
    drop(active);
    let deadline = Instant::now() + Duration::from_secs(3);
    while install.quits.load(Ordering::SeqCst) == 0 {
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    assert_eq!(
        *install.staged.lock().unwrap(),
        vec![("1.3.0".into(), vec![1, 2, 3])]
    );
    assert_eq!(install.launches.load(Ordering::SeqCst), 1);
    assert!(safety.admit().is_err());
    assert!(controller.cancel().phase == Phase::Preparing);
}

#[test]
fn failed_launch_preserves_download_reopens_admission_and_never_quits() {
    let (controller, driver, _) = fixture();
    ready(&controller, &driver);
    controller
        .state
        .lock()
        .unwrap()
        .snapshot
        .installation_enabled = true;
    let install = Arc::new(TestInstaller {
        launch_fails: true,
        ..Default::default()
    });
    let safety = install_safety();
    controller.restart(safety.clone(), install.clone()).unwrap();
    let snapshot = await_phase(&controller, Phase::Ready);
    assert_eq!(snapshot.error, Some(SafeError::HANDOFF_FAILED));
    assert!(safety.admit().is_ok());
    assert_eq!(install.quits.load(Ordering::SeqCst), 0);
    assert_eq!(controller.check().phase, Phase::Ready);
    assert!(controller.state.lock().unwrap().verified_bytes.is_some());
}

#[test]
fn restart_with_an_open_launcher_editor_does_not_freeze_or_discard_its_lease() {
    let (controller, driver, _) = fixture();
    ready(&controller, &driver);
    controller
        .state
        .lock()
        .unwrap()
        .snapshot
        .installation_enabled = true;
    let safety = install_safety();
    // The observer does not retire leases or fake readiness.
    let window = safety.connect("launcher").unwrap();
    let lease = safety
        .acquire(
            "launcher",
            window,
            crate::installation_safety::LeaseKind::Editor,
        )
        .unwrap();
    let install = Arc::new(TestInstaller::default());
    controller.restart(safety.clone(), install.clone()).unwrap();
    let snapshot = await_phase(&controller, Phase::Ready);
    assert_eq!(snapshot.error, Some(SafeError::UNSAFE_TO_RESTART));
    assert!(!safety.status().unwrap().preparing);
    safety.release("launcher", window, lease).unwrap();
    assert_eq!(install.launches.load(Ordering::SeqCst), 0);
    assert_eq!(install.quits.load(Ordering::SeqCst), 0);
}

#[test]
fn checks_are_nonblocking_and_only_accept_newer_semver() {
    for version in [
        None,
        Some("1.2.3"),
        Some("1.1.9"),
        Some("1.2.3+build"),
        Some("1.3.0-beta.1"),
        Some("1.3.0"),
    ] {
        let (controller, driver, _) = fixture();
        let gate = queue_check(&driver);
        assert_eq!(controller.check().phase, Phase::Checking);
        gate.send(Ok(version.map(offer)));
        let newer = version.is_some_and(|v| v.starts_with("1.3"));
        let state = await_phase(
            &controller,
            if newer {
                Phase::Available
            } else {
                Phase::UpToDate
            },
        );
        assert_eq!(
            state.available_version.as_deref(),
            if newer { version } else { None }
        );
    }
}
#[test]
fn absent_configuration_never_calls_the_driver() {
    let driver = Arc::new(TestDriver::default());
    let controller = UpdateController::new("1.2.3".into(), driver, Arc::new(|_| {}));
    assert_eq!(controller.check().phase, Phase::Unconfigured);
    assert_eq!(controller.download().phase, Phase::Unconfigured);
}
#[test]
fn later_preserves_the_offer_and_manual_check_restores_it_without_network() {
    let (controller, driver, _) = fixture();
    available(&controller, &driver);
    assert!(controller.dismiss().dismissed);
    assert_eq!(
        controller.snapshot().available_version.as_deref(),
        Some("1.3.0")
    );
    assert!(!controller.check().dismissed);
    assert_eq!(controller.snapshot().phase, Phase::Available);
}
#[test]
fn chunks_verification_and_verified_bytes_have_revisioned_states() {
    let (controller, driver, events) = fixture();
    available(&controller, &driver);
    let gate = queue_download(&driver);
    assert_eq!(controller.download().phase, Phase::Downloading);
    let deadline = Instant::now() + Duration::from_secs(2);
    let callback = loop {
        if let Some(callback) = driver.callbacks.lock().unwrap().first().cloned() {
            break callback;
        }
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    };
    callback(Progress::Chunk(3, Some(5)));
    assert_eq!(controller.snapshot().downloaded_bytes, 3);
    callback(Progress::Chunk(2, Some(5)));
    assert_eq!(controller.snapshot().downloaded_bytes, 5);
    callback(Progress::Verifying);
    assert_eq!(controller.snapshot().phase, Phase::Verifying);
    gate.send(Ok(vec![1, 2, 3, 4, 5]));
    let ready = await_phase(&controller, Phase::Ready);
    assert_eq!(ready.downloaded_bytes, 5);
    assert!(controller.dismiss().dismissed);
    assert_eq!(controller.check().phase, Phase::Ready);
    assert!(!controller.snapshot().dismissed);
    let events = events.lock().unwrap();
    assert!(events
        .windows(2)
        .all(|pair| pair[0].revision < pair[1].revision));
    assert!(events
        .iter()
        .all(|s| s.installation_enabled == cfg!(windows)));
}
#[test]
fn concurrent_actions_do_not_start_another_operation() {
    let (controller, driver, _) = fixture();
    let gate = queue_check(&driver);
    let initial = controller.check();
    assert_eq!(controller.check(), initial);
    assert_eq!(controller.download(), initial);
    assert_eq!(controller.dismiss(), initial);
    gate.send(Ok(Some(offer("1.3.0"))));
    await_phase(&controller, Phase::Available);
    let _gate = queue_download(&driver);
    let download = controller.download();
    assert_eq!(controller.check(), download);
    assert_eq!(controller.download(), download);
}
#[test]
fn cancelled_check_cannot_complete_over_a_new_check() {
    let (controller, driver, _) = fixture();
    let old = queue_check(&driver);
    controller.check();
    let deadline = Instant::now() + Duration::from_secs(2);
    while old.state.lock().unwrap().1.is_none() {
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    let old_generation = controller.state.lock().unwrap().generation;
    assert_eq!(controller.cancel().phase, Phase::Idle);
    old.await_dropped();
    let new = queue_check(&driver);
    controller.check();
    new.send(Ok(Some(offer("1.4.0"))));
    await_phase(&controller, Phase::Available);
    // A cancelled driver may still deliver an already-queued completion. The operation
    // generation must reject it even after the replacement operation has completed.
    controller.finish_check(old_generation, Ok(Some(offer("1.3.0"))));
    old.send(Ok(Some(offer("1.3.0"))));
    assert_eq!(
        controller.snapshot().available_version.as_deref(),
        Some("1.4.0")
    );
}
#[test]
fn cancelled_download_callbacks_cannot_change_a_retry() {
    let (controller, driver, _) = fixture();
    available(&controller, &driver);
    let old = queue_download(&driver);
    controller.download();
    let deadline = Instant::now() + Duration::from_secs(2);
    while driver.callbacks.lock().unwrap().is_empty() {
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    let callback = driver.callbacks.lock().unwrap()[0].clone();
    let old_generation = controller.state.lock().unwrap().generation;
    assert_eq!(controller.cancel().phase, Phase::Available);
    old.await_dropped();
    let new = queue_download(&driver);
    controller.download();
    callback(Progress::Chunk(999, Some(999)));
    callback(Progress::Verifying);
    assert_eq!(controller.snapshot().downloaded_bytes, 0);
    assert_eq!(controller.snapshot().phase, Phase::Downloading);
    old.send(Err(SafeError {
        code: "download_failed",
        message: "The update could not be downloaded.",
    }));
    new.send(Ok(vec![1]));
    await_phase(&controller, Phase::Ready);
    controller.finish_download(old_generation, Ok(vec![99, 99]));
    assert_eq!(
        controller.state.lock().unwrap().verified_bytes.as_deref(),
        Some([1].as_slice())
    );
}
#[test]
fn failed_check_retries_and_invalid_versions_fail_safely() {
    let (controller, driver, _) = fixture();
    let gate = queue_check(&driver);
    controller.check();
    gate.send(Err(SafeError {
        code: "offline",
        message: "Unable to connect. Check your connection and try again.",
    }));
    assert_eq!(
        await_phase(&controller, Phase::Error).error.unwrap().code,
        "offline"
    );
    let retry = queue_check(&driver);
    controller.check();
    retry.send(Ok(Some(offer("not-semver"))));
    assert_eq!(
        await_phase(&controller, Phase::Error).error.unwrap().code,
        "check_failed"
    );
    let retry = queue_check(&driver);
    controller.check();
    retry.send(Ok(None));
    await_phase(&controller, Phase::UpToDate);
}
#[test]
fn failed_download_preserves_offer_and_can_retry() {
    for code in ["download_failed", "signature_failure", "offline"] {
        let (controller, driver, _) = fixture();
        available(&controller, &driver);
        let gate = queue_download(&driver);
        controller.download();
        gate.send(Err(SafeError {
            code,
            message: "The update could not be verified.",
        }));
        let state = await_phase(&controller, Phase::Error);
        assert_eq!(state.error.unwrap().code, code);
        assert_eq!(state.available_version.as_deref(), Some("1.3.0"));
        let retry = queue_download(&driver);
        controller.download();
        retry.send(Ok(vec![1]));
        await_phase(&controller, Phase::Ready);
    }
}
#[test]
fn snapshots_serialize_only_the_public_contract() {
    let (controller, driver, _) = fixture();
    available(&controller, &driver);
    let value = serde_json::to_value(controller.snapshot()).unwrap();
    let keys: std::collections::BTreeSet<_> = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        std::collections::BTreeSet::from([
            "revision",
            "phase",
            "currentVersion",
            "availableVersion",
            "downloadedBytes",
            "totalBytes",
            "dismissed",
            "error",
            "installationEnabled"
        ])
    );
    assert_eq!(value["installationEnabled"], cfg!(windows));
}

#[test]
fn every_backend_action_is_denied_outside_main() {
    assert!(require_main("main").is_ok());
    for label in ["launcher", "", "settings", "main-child"] {
        assert!(require_main(label).is_err());
    }
}

#[test]
fn bundled_production_trust_is_accepted_with_configured_windows_installation() {
    let bundled: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    let config = tauri_driver::trusted_config(bundled["plugins"].get("updater")).unwrap();
    assert_eq!(config.pubkey, "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDU3NzYwMTcxQTcwMjhGRjMKUldUemp3S25jUUYyVjlVUG5JMStHRGwzakhWeWYzMDRTVTErVkRUWEtyZ2V4SWVmNHRJWHVHQUQK");
    assert_eq!(config.endpoints.len(), 1);
    assert_eq!(
        config.endpoints[0].as_str(),
        "https://tryslate.tech/updates/windows/latest.json"
    );
    assert!(config.require_signed_version);
    assert!(!config.allow_downgrades);
    assert!(!config.dangerous_insecure_transport_protocol);
    assert!(!config.dangerous_accept_invalid_certs);
    assert!(!config.dangerous_accept_invalid_hostnames);
    assert!(tauri_driver::trusted_config(None).is_none());
    let (controller, _, _) = fixture();
    assert_eq!(controller.snapshot().installation_enabled, cfg!(windows));
}

#[test]
fn unsafe_or_incomplete_configuration_is_unconfigured() {
    use serde_json::json;
    assert!(tauri_driver::trusted_config(None).is_none());
    for config in [
        json!(null),
        json!({}),
        json!({"pubkey": "", "endpoints": []}),
        json!({"pubkey": " ", "endpoints": ["https://example.invalid/update"]}),
        json!({"endpoints": ["http://example.invalid/update"]}),
    ] {
        assert!(tauri_driver::trusted_config(Some(&config)).is_none());
    }
    // This fictional string exercises configuration validation only. It is never
    // passed to the SDK, used for signing, or claimed to be a valid cryptographic key.
    let baseline = json!({"pubkey": "fictional-test-public-key", "endpoints": ["https://example.invalid/update"]});
    for flag in [
        "dangerousInsecureTransportProtocol",
        "dangerous-insecure-transport-protocol",
        "dangerousAcceptInvalidCerts",
        "dangerous-accept-invalid-certs",
        "dangerousAcceptInvalidHostnames",
        "dangerous-accept-invalid-hostnames",
        "allowDowngrades",
        "allow-downgrades",
    ] {
        let mut unsafe_config = baseline.clone();
        unsafe_config[flag] = json!(true);
        assert!(
            tauri_driver::trusted_config(Some(&unsafe_config)).is_none(),
            "{flag}"
        );
    }
    for endpoints in [
        json!([]),
        json!(["http://example.invalid/update"]),
        json!(["https://user:password@example.invalid/update"]),
        json!([42]),
    ] {
        let mut unsafe_config = baseline.clone();
        unsafe_config["endpoints"] = endpoints;
        assert!(tauri_driver::trusted_config(Some(&unsafe_config)).is_none());
    }
    for signed_version in [json!(null), json!(false), json!(true)] {
        let mut requested = baseline.clone();
        requested["requireSignedVersion"] = signed_version;
        let sanitized = tauri_driver::trusted_config(Some(&requested)).unwrap();
        assert!(sanitized.require_signed_version);
        assert!(!sanitized.allow_downgrades);
        assert!(!sanitized.dangerous_insecure_transport_protocol);
        assert!(!sanitized.dangerous_accept_invalid_certs);
        assert!(!sanitized.dangerous_accept_invalid_hostnames);
    }
    for url in [
        "http://example.invalid/update",
        "file:///tmp/update",
        "https://user:password@example.invalid/update",
    ] {
        assert!(!tauri_driver::secure_url(&url::Url::parse(url).unwrap()));
    }
    assert!(tauri_driver::secure_url(
        &url::Url::parse("https://example.invalid/update").unwrap()
    ));
}

#[test]
fn sdk_errors_are_mapped_to_fixed_content_free_messages() {
    use tauri_plugin_updater::Error;
    for error in [
        Error::MissingSignedVersion,
        Error::SignedVersionMismatch {
            signed: "private-path-or-url".into(),
            announced: "clipboard-secret".into(),
        },
        Error::SignatureUtf8("private-key-or-signature".into()),
    ] {
        let safe = tauri_driver::safe_error(error, true);
        assert_eq!(safe, SafeError::SIGNATURE_FAILURE);
        let serialized = serde_json::to_string(&safe).unwrap();
        assert!(!serialized.contains("private"));
        assert!(!serialized.contains("clipboard"));
    }
    assert_eq!(
        tauri_driver::safe_error(Error::ReleaseNotFound, false),
        SafeError::CHECK_FAILED
    );
    assert_eq!(
        tauri_driver::safe_error(
            Error::Network("https://private.invalid/clip-content".into()),
            true
        ),
        SafeError::DOWNLOAD_FAILED
    );
    assert_eq!(
        tauri_driver::safe_error(Error::TargetNotFound("private path".into()), false),
        SafeError::CHECK_FAILED
    );
}
