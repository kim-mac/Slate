#![cfg(windows)]
// The integration test executable itself is the disposable child process.
#[path = "../src/installation_safety/coordinator.rs"]
#[allow(dead_code)]
mod coordinator;
#[path = "../src/installation_safety/gate.rs"]
#[allow(dead_code)]
mod gate;

use ai_clip_memory_desktop_lib::{
    app_paths::clip_database_path_from_app_data_dir, bridge::native_host::run_with_storage,
};
use gate::{InstallationGate, UserGate};
use std::{
    io::{self, BufRead, Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc},
};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

impl coordinator::ProcessGate for InstallationGate {
    fn admit(&self) -> Result<Box<dyn Send>, coordinator::SafetyError> {
        self.admit()
            .map(|p| Box::new(p) as Box<dyn Send>)
            .map_err(|_| coordinator::SafetyError::Unavailable)
    }
    fn maintenance(&self, deadline: Instant) -> Result<Box<dyn Send>, coordinator::SafetyError> {
        self.maintenance(deadline)
            .map(|p| Box::new(p) as Box<dyn Send>)
            .map_err(|e| {
                if e.kind() == io::ErrorKind::TimedOut {
                    coordinator::SafetyError::TimedOut
                } else {
                    coordinator::SafetyError::Unavailable
                }
            })
    }
}
impl coordinator::ProcessGate for UserGate {
    fn available(&self) -> bool {
        self.available()
    }
    fn prepare(&self) -> Result<(), coordinator::SafetyError> {
        drop(
            self.admit()
                .map_err(|_| coordinator::SafetyError::Unavailable)?,
        );
        Ok(())
    }
    fn admit(&self) -> Result<Box<dyn Send>, coordinator::SafetyError> {
        self.admit()
            .map(|p| Box::new(p) as Box<dyn Send>)
            .map_err(|_| coordinator::SafetyError::Unavailable)
    }
    fn maintenance(&self, deadline: Instant) -> Result<Box<dyn Send>, coordinator::SafetyError> {
        self.maintenance(deadline)
            .map(|p| Box::new(p) as Box<dyn Send>)
            .map_err(|_| coordinator::SafetyError::Unavailable)
    }
}

fn fixture() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest
        .ancestors()
        .nth(3)
        .unwrap()
        .join("dist")
        .join("test")
        .join("updater-maintenance-gate")
        .join(format!("{}-{}", std::process::id(), uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.parent().unwrap()).unwrap();
    InstallationGate::create_test_profile(&root).expect("secure fixture profile must be new");
    root
}
fn gate_path(root: &std::path::Path) -> PathBuf {
    InstallationGate::prepare_test_namespace(root).unwrap()
}

#[test]
fn concurrent_fixture_creation_uses_distinct_secure_profiles() {
    let barrier = Arc::new(std::sync::Barrier::new(16));
    let workers: Vec<_> = (0..16)
        .map(|_| {
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                (0..4).map(|_| fixture()).collect::<Vec<_>>()
            })
        })
        .collect();
    let roots: Vec<_> = workers
        .into_iter()
        .flat_map(|worker| worker.join().expect("fixture worker must succeed"))
        .collect();
    assert_eq!(roots.len(), 64);
    assert_eq!(
        roots.iter().collect::<std::collections::HashSet<_>>().len(),
        64
    );
    for root in roots {
        let gate = InstallationGate::for_test_root(&root).unwrap();
        let _activity = gate.admit().unwrap();
    }
}

#[test]
fn external_authority_is_fixed_below_the_profile_and_not_the_installation() {
    let root = fixture();
    let gate = InstallationGate::for_test_root(&root).unwrap();
    assert!(root
        .join(".slate-coordination/com.aiclipmemory.desktop/maintenance-v2.lock")
        .is_file());
    assert!(!root.join(".slate-maintenance-v1.lock").exists());
    let _activity = gate.admit().unwrap();
    let native = InstallationGate::for_test_root(&root).unwrap();
    assert!(native.maintenance(Instant::now()).is_err());
}

#[test]
fn rejects_nonordinary_hardlinked_readonly_and_missing_paths() {
    let missing = fixture().join("missing");
    assert!(InstallationGate::for_test_root(&missing).is_err());
    let root = fixture();
    std::fs::create_dir(gate_path(&root)).unwrap();
    assert!(InstallationGate::for_test_root(&root).is_err());
    let root = fixture();
    let path = gate_path(&root);
    std::fs::write(&path, []).unwrap();
    std::fs::hard_link(&path, root.join("hardlink")).unwrap();
    assert!(InstallationGate::for_test_root(&root).is_err());
    let root = fixture();
    let path = gate_path(&root);
    std::fs::write(&path, []).unwrap();
    let mut permissions = std::fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&path, permissions).unwrap();
    assert!(InstallationGate::for_test_root(&root).is_err());
}

#[test]
fn independent_operations_share_activity_and_last_drop_releases_it() {
    let root = fixture();
    let gate = InstallationGate::for_test_root(&root).unwrap();
    let one = gate.admit().expect("first real operation is admitted");
    let two = gate.admit().expect("independent shared operation coexists");
    assert!(gate.maintenance(Instant::now()).is_err());
    drop(one);
    assert!(gate.maintenance(Instant::now()).is_err());
    drop(two);
    let maintenance = gate
        .maintenance(Instant::now() + Duration::from_secs(1))
        .unwrap();
    assert!(gate.admit().is_err());
    drop(maintenance);
    assert!(gate.admit().is_ok());
}

struct Probe {
    child: Child,
    input: ChildStdin,
    events: mpsc::Receiver<String>,
}
impl Probe {
    fn spawn(root: &std::path::Path, role: &str) -> Self {
        Self::spawn_at(root, role, &std::env::current_exe().unwrap(), root)
    }
    fn spawn_at(
        root: &std::path::Path,
        role: &str,
        executable: &std::path::Path,
        cwd: &std::path::Path,
    ) -> Self {
        let mut child = Command::new(executable)
            .args([
                "--ignored",
                "--exact",
                "synthetic_child_probe",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("SLATE_GATE_TEST_ROOT", root)
            .env("SLATE_GATE_TEST_ROLE", role)
            .env("USERPROFILE", root.join(format!("fake-profile-{role}")))
            .env("APPDATA", root.join(format!("fake-roaming-{role}")))
            .env("LOCALAPPDATA", root.join(format!("fake-local-{role}")))
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let output = child.stdout.take().unwrap();
        let (tx, events) = mpsc::channel();
        std::thread::spawn(move || {
            for line in io::BufReader::new(output).lines() {
                let line = line.unwrap();
                if let Some((_, event)) = line.split_once("GATE_PROBE:") {
                    let _ = tx.send(event.into());
                }
            }
        });
        let probe = Self {
            child,
            input,
            events,
        };
        probe.expect("started");
        probe
    }
    fn send(&mut self) {
        self.input.write_all(b"x").unwrap();
        self.input.flush().unwrap();
    }
    fn expect(&self, expected: &str) {
        assert_eq!(
            self.events.recv_timeout(Duration::from_secs(10)).unwrap(),
            expected
        );
    }
    fn wait(&mut self) {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success());
                return;
            }
            assert!(
                Instant::now() < deadline,
                "owned synthetic probe did not exit"
            );
            std::thread::park_timeout(Duration::from_millis(2));
        }
    }
    fn finish(mut self) {
        self.send();
        self.wait();
    }
}
impl Drop for Probe {
    fn drop(&mut self) {
        // Unblock only this owned synthetic child on an assertion failure.
        let _ = self.input.write_all(b"xxxxxxxx");
    }
}
fn event(value: &str) {
    println!("GATE_PROBE:{value}");
    io::stdout().flush().unwrap();
}
fn barrier() {
    let mut byte = [0];
    io::stdin().read_exact(&mut byte).unwrap();
}

#[test]
fn maintenance_export_is_unlocked_and_survives_exporter_exit() {
    let root = fixture();
    let mut exporter = Probe::spawn(&root, &format!("export:{}", std::process::id()));
    exporter.send();
    let exported = exporter
        .events
        .recv_timeout(Duration::from_secs(10))
        .unwrap();
    assert!(
        exported.starts_with("handle:"),
        "expected handle export, got {exported}"
    );
    exporter.wait();
    let raw: u32 = exported.strip_prefix("handle:").unwrap().parse().unwrap();
    use std::os::windows::io::FromRawHandle;
    let file = unsafe { std::fs::File::from_raw_handle(raw as usize as *mut _) };
    let gate = InstallationGate::for_test_root(&root).unwrap();
    let operation = gate.admit().unwrap();
    let mut admission = windows::Win32::System::IO::OVERLAPPED::default();
    let mut activity = windows::Win32::System::IO::OVERLAPPED::default();
    activity.Anonymous.Anonymous.Offset = 1;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Storage::FileSystem::{
        LockFileEx, UnlockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
    };
    let handle = windows::Win32::Foundation::HANDLE(file.as_raw_handle());
    let flags = LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY;
    unsafe { LockFileEx(handle, flags, None, 1, 0, &mut admission) }.unwrap();
    assert!(
        gate.admit().is_err(),
        "exported file must close cooperating admission"
    );
    assert!(unsafe { LockFileEx(handle, flags, None, 1, 0, &mut activity) }.is_err());
    drop(operation);
    unsafe { LockFileEx(handle, flags, None, 1, 0, &mut activity) }.unwrap();
    unsafe { UnlockFileEx(handle, None, 1, 0, &mut activity) }.unwrap();
    unsafe { UnlockFileEx(handle, None, 1, 0, &mut admission) }.unwrap();
    drop(file);
    assert!(gate.admit().is_ok());
    drop(gate);
    assert!(
        std::fs::rename(&root, root.with_extension("replacement")).is_err(),
        "target-owned directory pins must outlive exporter and local gate"
    );
}

#[test]
fn maintenance_export_rejects_invalid_target_and_revalidates_security() {
    let root = fixture();
    let gate = InstallationGate::for_test_root(&root).unwrap();
    assert!(gate.export_maintenance_handle(0).is_err());
    assert!(gate.export_maintenance_handle(std::process::id()).is_err());
    assert!(gate.export_maintenance_handle(u32::MAX).is_err());
    std::fs::hard_link(gate_path(&root), root.join("unsafe-hardlink")).unwrap();
    let mut child = Probe::spawn(&fixture(), "operation");
    child.send();
    child.expect("shared");
    assert!(gate.export_maintenance_handle(child.child.id()).is_err());
    child.finish();
}

#[test]
fn maintenance_export_receiver_crash_releases_its_locks() {
    let root = fixture();
    let gate = InstallationGate::for_test_root(&root).unwrap();
    let mut owner = Probe::spawn(&root, "export-owner");
    let raw = gate.export_maintenance_handle(owner.child.id()).unwrap();
    writeln!(owner.input, "{raw}").unwrap();
    owner.input.flush().unwrap();
    owner.expect("exclusive");
    assert!(gate.admit().is_err());
    owner.child.kill().unwrap();
    owner.child.wait().unwrap();
    assert!(gate.admit().is_ok());
}

#[test]
#[ignore = "only invoked by parent tests with a unique synthetic root and pipes"]
fn synthetic_child_probe() {
    let root =
        PathBuf::from(std::env::var_os("SLATE_GATE_TEST_ROOT").expect("synthetic child only"));
    let role = std::env::var("SLATE_GATE_TEST_ROLE").unwrap();
    if role.starts_with("profile-identity") {
        event("started");
        barrier();
        let (path, identity) = InstallationGate::current_profile_identity_readonly().unwrap();
        event(&format!("profile:{path:?}:{identity:?}"));
        return;
    }
    if role == "first-create" {
        event("started");
        barrier();
        let gate = InstallationGate::for_test_root(&root).unwrap();
        event(&format!("identity:{:?}", gate.physical_identity().unwrap()));
        let _permit = gate.admit().unwrap();
        event("shared");
        barrier();
        return;
    }
    let gate = InstallationGate::for_test_root(&root).unwrap();
    event("started");
    if role == "export-owner" {
        let mut value = String::new();
        io::stdin().read_line(&mut value).unwrap();
        use std::os::windows::io::{AsRawHandle, FromRawHandle};
        let raw: u32 = value.trim().parse().unwrap();
        let file = unsafe { std::fs::File::from_raw_handle(raw as usize as *mut _) };
        use windows::Win32::Storage::FileSystem::{
            LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
        };
        for offset in [0, 1] {
            let mut overlapped = windows::Win32::System::IO::OVERLAPPED::default();
            overlapped.Anonymous.Anonymous.Offset = offset;
            unsafe {
                LockFileEx(
                    windows::Win32::Foundation::HANDLE(file.as_raw_handle()),
                    LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                    None,
                    1,
                    0,
                    &mut overlapped,
                )
            }
            .unwrap();
        }
        event("exclusive");
        barrier();
        return;
    }
    barrier();
    if let Some(pid) = role.strip_prefix("export:") {
        let value = gate
            .export_maintenance_handle(pid.parse().unwrap())
            .unwrap();
        event(&format!("handle:{value}"));
        return;
    }
    if role == "host" || role == "readonly-host" {
        if role == "readonly-host" {
            event(&format!("identity:{:?}", gate.physical_identity().unwrap()));
        }
        struct ProbeWriter(Vec<u8>);
        impl Write for ProbeWriter {
            fn write(&mut self, data: &[u8]) -> io::Result<usize> {
                self.0.extend_from_slice(data);
                Ok(data.len())
            }
            fn flush(&mut self) -> io::Result<()> {
                event("flush");
                barrier();
                Ok(())
            }
        }
        let mut writer = ProbeWriter(Vec::new());
        run_with_storage(
            &mut io::Cursor::new(valid_request()),
            &mut writer,
            root.join("host-data"),
            gate.admit(),
        )
        .unwrap();
        event(if response(&writer.0)["ok"] == true {
            "success"
        } else {
            "storage_unavailable"
        });
    } else if role == "maintenance" {
        let _permit = gate
            .maintenance_after_close(Instant::now() + Duration::from_secs(10), || event("closed"))
            .unwrap();
        event("exclusive");
        barrier();
    } else {
        match gate.admit() {
            Ok(_permit) => {
                event("shared");
                barrier();
            }
            Err(error) if role == "race" && error.kind() == io::ErrorKind::WouldBlock => {
                event("busy")
            }
            Err(error) => panic!("synthetic admission failed: {error}"),
        }
    }
}

#[test]
fn processes_share_then_maintenance_closes_admission_before_writer_drain() {
    let root = fixture();
    let gate = InstallationGate::for_test_root(&root).unwrap();
    let mut one = Probe::spawn(&root, "operation");
    one.send();
    one.expect("shared");
    let mut two = Probe::spawn(&root, "operation");
    two.send();
    two.expect("shared");
    let mut maintenance = Probe::spawn(&root, "maintenance");
    maintenance.send();
    maintenance.expect("closed");
    assert_eq!(
        gate.admit().err().unwrap().kind(),
        io::ErrorKind::WouldBlock
    );
    assert!(maintenance.events.try_recv().is_err());
    one.finish();
    assert!(maintenance.events.try_recv().is_err());
    two.finish();
    maintenance.expect("exclusive");
    assert!(gate.admit().is_err());
    maintenance.finish();
    assert!(gate.admit().is_ok());
}

#[test]
fn multiprocess_admission_races_never_cross_the_closed_maintenance_boundary() {
    for _round in 0..4 {
        let root = fixture();
        let gate = InstallationGate::for_test_root(&root).unwrap();
        let mut operations: Vec<_> = (0..4).map(|_| Probe::spawn(&root, "race")).collect();
        let mut maintenance = Probe::spawn(&root, "maintenance");
        // Every child is at its input-pipe barrier before the race is released.
        operations[0].send();
        maintenance.send();
        for operation in &mut operations[1..] {
            operation.send();
        }
        maintenance.expect("closed");
        assert_eq!(
            gate.admit().err().unwrap().kind(),
            io::ErrorKind::WouldBlock
        );
        for mut operation in operations {
            match operation
                .events
                .recv_timeout(Duration::from_secs(10))
                .unwrap()
                .as_str()
            {
                "shared" => {
                    assert!(
                        maintenance.events.try_recv().is_err(),
                        "exclusive B cannot precede a previously admitted operation's release"
                    );
                    operation.send();
                    operation.wait();
                }
                "busy" => operation.wait(),
                other => panic!("unexpected race result: {other}"),
            }
        }
        maintenance.expect("exclusive");
        maintenance.finish();
        assert!(gate.admit().is_ok());
    }
}

#[test]
fn synthetic_process_death_releases_shared_and_exclusive_kernel_locks() {
    for role in ["operation", "maintenance"] {
        let root = fixture();
        let gate = InstallationGate::for_test_root(&root).unwrap();
        let mut child = Probe::spawn(&root, role);
        child.send();
        if role == "maintenance" {
            child.expect("closed");
            child.expect("exclusive");
        } else {
            child.expect("shared");
        }
        assert!(gate.maintenance(Instant::now()).is_err());
        child.child.kill().unwrap(); // Only this owned disposable probe process.
        let deadline = Instant::now() + Duration::from_secs(10);
        while child.child.try_wait().unwrap().is_none() {
            assert!(
                Instant::now() < deadline,
                "killed owned synthetic child did not exit"
            );
            std::thread::park_timeout(Duration::from_millis(2));
        }
        assert!(gate
            .maintenance(Instant::now() + Duration::from_secs(1))
            .is_ok());
        assert!(gate.admit().is_ok());
    }
}

#[test]
fn short_admission_contention_retries_and_timeout_reopens_after_drop() {
    let gate = InstallationGate::for_test_root(&fixture()).unwrap();
    let admission = gate.hold_admission().unwrap();
    let (tx, rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let other = gate.clone();
    let thread = std::thread::spawn(move || {
        tx.send(()).unwrap();
        result_tx.send(other.admit()).unwrap();
    });
    rx.recv().unwrap();
    assert!(
        matches!(
            result_rx.recv_timeout(Duration::from_millis(20)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ),
        "short A contention must retry instead of rejecting immediately"
    );
    drop(admission);
    drop(
        result_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap(),
    );
    thread.join().unwrap();
    let activity = gate.admit().unwrap();
    assert_eq!(
        gate.maintenance(Instant::now() + Duration::from_millis(20))
            .err()
            .unwrap()
            .kind(),
        io::ErrorKind::TimedOut
    );
    assert!(
        gate.admit().is_ok(),
        "failed maintenance releases admission A"
    );
    drop(activity);
    assert!(gate
        .maintenance(Instant::now() + Duration::from_secs(1))
        .is_ok());
}

#[test]
fn retained_handles_block_replacement_and_new_aliases_fail_closed() {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{DELETE, FILE_FLAG_BACKUP_SEMANTICS};
    let root = fixture();
    let gate = InstallationGate::for_test_root(&root).unwrap();
    let path = gate_path(&root);
    // Request DELETE access without requesting deletion, preserving all fixtures
    // even if this assertion unexpectedly fails.
    assert!(std::fs::OpenOptions::new()
        .access_mode(DELETE.0)
        .share_mode(3)
        .open(&path)
        .is_err());
    assert!(std::fs::OpenOptions::new()
        .access_mode(DELETE.0)
        .share_mode(3)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0)
        .open(&root)
        .is_err());
    assert!(std::fs::rename(&path, root.join("replaced.lock")).is_err());
    let namespace = path.parent().unwrap();
    assert!(std::fs::OpenOptions::new()
        .access_mode(DELETE.0)
        .share_mode(3)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0)
        .open(namespace)
        .is_err());
    assert!(std::fs::rename(namespace, namespace.with_extension("substituted")).is_err());
    assert!(std::fs::rename(&root, root.with_extension("moved")).is_err());
    assert!(std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0)
        .open(&path)
        .is_err());
    std::fs::hard_link(&path, root.join("late-alias")).unwrap();
    assert!(gate.admit().is_err());
    let root = fixture();
    let blocked = std::fs::OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .share_mode(0)
        .open(gate_path(&root))
        .unwrap();
    assert!(InstallationGate::for_test_root(&root).is_err());
    drop(blocked);
    assert!(InstallationGate::for_test_root(&root)
        .unwrap()
        .admit()
        .is_ok());
}

#[test]
fn rejects_junction_ancestors_and_gate_reparse_points_without_elevation() {
    let root = fixture();
    let target = root.join("ordinary");
    std::fs::create_dir(&target).unwrap();
    let junction = root.join("junction");
    let output = Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&target)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "ordinary-user disposable junction creation failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(InstallationGate::for_test_root(&junction).is_err());
    let gate_junction = gate_path(&root);
    let output = Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(&gate_junction)
        .arg(&target)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(InstallationGate::for_test_root(&root).is_err());
}

fn valid_request() -> Vec<u8> {
    let body = br#"{"version":1,"type":"capture_clip","payload":{"content":"synthetic gate capture","contentType":"text","sourceApp":"Other Web","sourceUrl":"https://example.com/synthetic","sourcePageTitle":"Synthetic"}}"#;
    let mut frame = (body.len() as u32).to_ne_bytes().to_vec();
    frame.extend_from_slice(body);
    frame
}
fn response(bytes: &[u8]) -> serde_json::Value {
    let length = u32::from_ne_bytes(bytes[..4].try_into().unwrap()) as usize;
    assert_eq!(length, bytes.len() - 4);
    serde_json::from_slice(&bytes[4..]).unwrap()
}

#[test]
fn late_native_host_uses_production_wrapper_and_never_bootstraps_sqlite() {
    let root = fixture();
    let gate = InstallationGate::for_test_root(&root).unwrap();
    let _maintenance = gate
        .maintenance(Instant::now() + Duration::from_secs(1))
        .unwrap();
    let data = root.join("synthetic-data");
    let mut output = Vec::new();
    run_with_storage(
        &mut io::Cursor::new(valid_request()),
        &mut output,
        data.clone(),
        gate.admit(),
    )
    .unwrap();
    assert_eq!(
        response(&output),
        serde_json::json!({"version":1,"ok":false,"error":"storage_unavailable"})
    );
    assert!(!data.exists());
    assert!(!clip_database_path_from_app_data_dir(&data).exists());
}

struct FlushBarrier {
    bytes: Vec<u8>,
    entered: mpsc::Sender<()>,
    release: mpsc::Receiver<()>,
}
impl Write for FlushBarrier {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.bytes.extend_from_slice(data);
        Ok(data.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.entered.send(()).unwrap();
        self.release.recv().unwrap();
        Ok(())
    }
}
#[test]
fn native_permit_survives_sqlite_and_blocked_response_flush() {
    let root = fixture();
    let gate = InstallationGate::for_test_root(&root).unwrap();
    let data = root.join("synthetic-data");
    let (entered, at_flush) = mpsc::channel();
    let (release, wait) = mpsc::channel();
    let host_gate = gate.clone();
    let host_data = data.clone();
    let host = std::thread::spawn(move || {
        let mut writer = FlushBarrier {
            bytes: Vec::new(),
            entered,
            release: wait,
        };
        run_with_storage(
            &mut io::Cursor::new(valid_request()),
            &mut writer,
            host_data,
            host_gate.admit(),
        )
        .unwrap();
        writer.bytes
    });
    at_flush.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(clip_database_path_from_app_data_dir(&data).exists());
    assert!(
        gate.maintenance(Instant::now()).is_err(),
        "flush still owns shared B"
    );
    release.send(()).unwrap();
    assert_eq!(response(&host.join().unwrap())["ok"], true);
    assert!(gate
        .maintenance(Instant::now() + Duration::from_secs(1))
        .is_ok());
}

#[test]
fn multiprocess_native_late_rejection_has_no_database_or_success_response() {
    let root = fixture();
    let gate = InstallationGate::for_test_root(&root).unwrap();
    let _maintenance = gate.maintenance(Instant::now()).unwrap();
    let mut host = Probe::spawn(&root, "host");
    host.send();
    host.expect("flush");
    assert!(!root.join("host-data").exists());
    host.send();
    host.expect("storage_unavailable");
    host.wait();
    assert!(!root.join("host-data").exists());
}

#[test]
fn multiprocess_maintenance_waits_until_native_response_flush_finishes() {
    let root = fixture();
    let mut host = Probe::spawn(&root, "host");
    host.send();
    host.expect("flush");
    assert!(clip_database_path_from_app_data_dir(&root.join("host-data")).exists());
    let mut maintenance = Probe::spawn(&root, "maintenance");
    maintenance.send();
    maintenance.expect("closed");
    assert!(maintenance.events.try_recv().is_err());
    host.send();
    host.expect("success");
    host.wait();
    maintenance.expect("exclusive");
    maintenance.finish();
}

struct ObservedGate {
    real: InstallationGate,
    admission: mpsc::Sender<()>,
    maintenance: mpsc::Sender<()>,
}
impl coordinator::ProcessGate for ObservedGate {
    fn admit(&self) -> Result<Box<dyn Send>, coordinator::SafetyError> {
        let _ = self.admission.send(());
        coordinator::ProcessGate::admit(&self.real)
    }
    fn maintenance(&self, deadline: Instant) -> Result<Box<dyn Send>, coordinator::SafetyError> {
        self.real
            .maintenance_after_close(deadline, || {
                let _ = self.maintenance.send(());
            })
            .map(|p| Box::new(p) as Box<dyn Send>)
            .map_err(|_| coordinator::SafetyError::TimedOut)
    }
}
fn observed_safety(
    gate: &InstallationGate,
) -> (
    Arc<coordinator::SafetyCoordinator>,
    mpsc::Receiver<()>,
    mpsc::Receiver<()>,
    u64,
    u64,
) {
    let (admission, admitted) = mpsc::channel();
    let (maintenance, closed) = mpsc::channel();
    let safety = coordinator::SafetyCoordinator::with_gate(Arc::new(ObservedGate {
        real: gate.clone(),
        admission,
        maintenance,
    }));
    let main = safety.connect("main").unwrap();
    let launcher = safety.connect("launcher").unwrap();
    (safety, admitted, closed, main, launcher)
}
fn acknowledge(safety: &coordinator::SafetyCoordinator, main: u64, launcher: u64) {
    let generation = safety.status().unwrap().generation;
    safety.acknowledge("main", main, generation).unwrap();
    safety
        .acknowledge("launcher", launcher, generation)
        .unwrap();
}

#[test]
fn local_admission_releases_policy_before_crosswait_and_local_drain_precedes_global_close() {
    struct PausedAdmission {
        real: InstallationGate,
        entered: mpsc::Sender<()>,
        resume: std::sync::Mutex<mpsc::Receiver<()>>,
        closed: mpsc::Sender<()>,
    }
    impl coordinator::ProcessGate for PausedAdmission {
        fn admit(&self) -> Result<Box<dyn Send>, coordinator::SafetyError> {
            self.entered.send(()).unwrap();
            self.resume.lock().unwrap().recv().unwrap();
            coordinator::ProcessGate::admit(&self.real)
        }
        fn maintenance(
            &self,
            deadline: Instant,
        ) -> Result<Box<dyn Send>, coordinator::SafetyError> {
            self.real
                .maintenance_after_close(deadline, || {
                    self.closed.send(()).unwrap();
                })
                .map(|p| Box::new(p) as Box<dyn Send>)
                .map_err(|_| coordinator::SafetyError::TimedOut)
        }
    }
    let gate = InstallationGate::for_test_root(&fixture()).unwrap();
    let (entered, admitted) = mpsc::channel();
    let (resume, wait) = mpsc::channel();
    let (close_tx, closed) = mpsc::channel();
    let safety = coordinator::SafetyCoordinator::with_gate(Arc::new(PausedAdmission {
        real: gate.clone(),
        entered,
        resume: std::sync::Mutex::new(wait),
        closed: close_tx,
    }));
    let main = safety.connect("main").unwrap();
    let launcher = safety.connect("launcher").unwrap();
    let worker_safety = safety.clone();
    let worker = std::thread::spawn(move || worker_safety.admit());
    admitted.recv_timeout(Duration::from_secs(10)).unwrap();
    let attempt = safety.begin_preparation().unwrap(); // Must not wait on gate A.
    acknowledge(&safety, main, launcher);
    let (error, attempt) = attempt.try_freeze().err().unwrap();
    assert_eq!(error, coordinator::SafetyError::NotReady);
    assert!(
        closed.try_recv().is_err(),
        "local operation must drain before maintenance takes A"
    );
    assert!(safety.admit().is_err());
    resume.send(()).unwrap();
    let operation = worker.join().unwrap().unwrap();
    let (_, attempt) = attempt.try_freeze().err().unwrap();
    drop(operation);
    let guard = attempt.try_freeze().ok().unwrap();
    closed.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(gate.admit().is_err());
    drop(guard);
    assert!(gate.admit().is_ok());
}

#[test]
fn participant_failure_during_global_wait_invalidates_maintenance_guard() {
    let gate = InstallationGate::for_test_root(&fixture()).unwrap();
    let external = gate.admit().unwrap();
    let (safety, _, closed, main, launcher) = observed_safety(&gate);
    let attempt = safety.begin_preparation().unwrap();
    acknowledge(&safety, main, launcher);
    let waiter = std::thread::spawn(move || attempt.try_freeze());
    closed.recv_timeout(Duration::from_secs(1)).unwrap();
    safety.disconnected("main").unwrap();
    assert!(
        safety.status().unwrap().preparing,
        "policy stays available while global B drains"
    );
    drop(external);
    let (error, attempt) = waiter.join().unwrap().err().unwrap();
    assert_eq!(error, coordinator::SafetyError::NotReady);
    assert!(gate.admit().is_ok(), "invalid guard releases global A/B");
    drop(attempt);
    assert!(!safety.status().unwrap().preparing);
}

#[test]
fn coordinator_global_timeout_reopens_local_admission_without_late_maintenance() {
    struct TimeoutGate(InstallationGate, mpsc::Sender<()>);
    impl coordinator::ProcessGate for TimeoutGate {
        fn admit(&self) -> Result<Box<dyn Send>, coordinator::SafetyError> {
            coordinator::ProcessGate::admit(&self.0)
        }
        fn maintenance(&self, _: Instant) -> Result<Box<dyn Send>, coordinator::SafetyError> {
            self.0
                .maintenance_after_close(Instant::now() + Duration::from_millis(20), || {
                    self.1.send(()).unwrap();
                })
                .map(|p| Box::new(p) as Box<dyn Send>)
                .map_err(|_| coordinator::SafetyError::TimedOut)
        }
    }
    let gate = InstallationGate::for_test_root(&fixture()).unwrap();
    let external = gate.admit().unwrap();
    let (tx, closed) = mpsc::channel();
    let safety = coordinator::SafetyCoordinator::with_gate(Arc::new(TimeoutGate(gate.clone(), tx)));
    let main = safety.connect("main").unwrap();
    let launcher = safety.connect("launcher").unwrap();
    let attempt = safety.begin_preparation().unwrap();
    acknowledge(&safety, main, launcher);
    let waiter = std::thread::spawn(move || attempt.try_freeze());
    closed.recv_timeout(Duration::from_secs(1)).unwrap();
    let (error, attempt) = waiter.join().unwrap().err().unwrap();
    assert_eq!(error, coordinator::SafetyError::TimedOut);
    assert!(!safety.status().unwrap().preparing);
    assert!(safety.admit().is_ok());
    drop(attempt);
    drop(external);
    assert!(gate.maintenance(Instant::now()).is_ok());
}

#[test]
fn deadline_is_rechecked_after_the_global_guard_was_acquired() {
    let gate = InstallationGate::for_test_root(&fixture()).unwrap();
    let (safety, _, closed, main, launcher) = observed_safety(&gate);
    // Test-only deadline injection happens after acquiring the actual kernel
    // maintenance guard, avoiding a short worker-start scheduling deadline.
    let attempt = safety
        .begin_preparation()
        .unwrap()
        .with_test_deadline_after_global(Instant::now());
    acknowledge(&safety, main, launcher);
    let waiter = std::thread::spawn(move || attempt.try_freeze());
    closed.recv_timeout(Duration::from_secs(1)).unwrap();
    let (error, attempt) = waiter.join().unwrap().err().unwrap();
    assert_eq!(error, coordinator::SafetyError::TimedOut);
    assert!(!safety.status().unwrap().preparing);
    assert!(gate.admit().is_ok());
    drop(attempt);
}

#[test]
fn storage_and_response_errors_release_native_activity() {
    struct BrokenWriter;
    impl Write for BrokenWriter {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::ErrorKind::BrokenPipe.into())
        }
        fn flush(&mut self) -> io::Result<()> {
            Err(io::ErrorKind::BrokenPipe.into())
        }
    }
    let root = fixture();
    let gate = InstallationGate::for_test_root(&root).unwrap();
    let data = root.join("synthetic-data");
    assert!(run_with_storage(
        &mut io::Cursor::new(valid_request()),
        &mut BrokenWriter,
        data,
        gate.admit()
    )
    .is_err());
    assert!(gate.maintenance(Instant::now()).is_ok());
    let data_file = root.join("not-a-directory");
    std::fs::write(&data_file, []).unwrap();
    let mut output = Vec::new();
    run_with_storage(
        &mut io::Cursor::new(valid_request()),
        &mut output,
        data_file,
        gate.admit(),
    )
    .unwrap();
    assert_eq!(response(&output)["error"], "storage_unavailable");
    assert!(gate.maintenance(Instant::now()).is_ok());
}

#[test]
fn ordinary_and_canonical_verbatim_roots_converge_on_the_same_physical_gate() {
    let root = fixture();
    let ordinary = InstallationGate::for_test_root(&root).unwrap();
    let canonical =
        InstallationGate::for_test_root(&std::fs::canonicalize(&root).unwrap()).unwrap();
    let _shared = ordinary.admit().unwrap();
    assert!(canonical.maintenance(Instant::now()).is_err());
    assert!(InstallationGate::for_test_root(std::path::Path::new("relative-root")).is_err());
    let file = root.join("file-root");
    std::fs::write(&file, []).unwrap();
    assert!(InstallationGate::for_test_root(&file).is_err());
}

fn icacls(path: &std::path::Path, arguments: &[&str]) {
    let result = Command::new("icacls.exe")
        .arg(path)
        .args(arguments)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "fixture ACL operation failed: {} {}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}
fn current_sid() -> String {
    let result = Command::new("whoami.exe")
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .unwrap();
    assert!(result.status.success());
    String::from_utf8(result.stdout)
        .unwrap()
        .trim()
        .rsplit(',')
        .next()
        .unwrap()
        .trim_matches('"')
        .to_owned()
}

#[test]
fn simultaneous_first_creation_converges_on_one_physical_gate() {
    let root = fixture();
    let mut children: Vec<_> = (0..4)
        .map(|_| Probe::spawn(&root, "first-create"))
        .collect();
    assert!(!root.join(".slate-coordination").exists());
    for child in &mut children {
        child.send();
    }
    let mut identities = Vec::new();
    for child in &children {
        identities.push(child.events.recv_timeout(Duration::from_secs(10)).unwrap());
        child.expect("shared");
    }
    assert!(identities.iter().all(|id| id == &identities[0]));
    let gate = InstallationGate::for_test_root(&root).unwrap();
    assert_eq!(
        identities[0],
        format!("identity:{:?}", gate.physical_identity().unwrap())
    );
    assert!(gate.maintenance(Instant::now()).is_err());
    for child in children {
        child.finish();
    }
    assert!(gate.maintenance(Instant::now()).is_ok());
}

#[test]
fn token_profile_resolution_ignores_child_environment_and_cwd_without_creating_authority() {
    let root = fixture();
    let mut one = Probe::spawn(&root, "profile-identity-one");
    let other_cwd = fixture();
    let mut two = Probe::spawn_at(
        &root,
        "profile-identity-two",
        &std::env::current_exe().unwrap(),
        &other_cwd,
    );
    one.send();
    two.send();
    let first = one.events.recv_timeout(Duration::from_secs(10)).unwrap();
    let second = two.events.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(first.starts_with("profile:"));
    assert_eq!(first, second);
    one.wait();
    two.wait();
    assert!(!root.join(".slate-coordination").exists());
    assert!(!other_cwd.join(".slate-coordination").exists());
}

#[test]
fn unsafe_profile_and_private_acl_are_rejected_without_repair() {
    let root = fixture();
    icacls(&root, &["/grant", "*S-1-1-0:(W)"]);
    assert!(InstallationGate::for_test_root(&root).is_err());
    assert!(!root.join(".slate-coordination").exists());
    let root = fixture();
    let path = gate_path(&root);
    icacls(path.parent().unwrap(), &["/grant", "*S-1-1-0:(W)"]);
    assert!(InstallationGate::for_test_root(&root).is_err());
    assert!(!path.exists());
}

#[test]
fn absent_authority_keeps_leases_but_rejects_sql_and_preparation_then_recovers_same_root() {
    let root = fixture();
    let path = gate_path(&root);
    let namespace = path.parent().unwrap();
    let sid = format!("*{}:(W)", current_sid());
    icacls(namespace, &["/deny", &sid]);
    let retry = Arc::new(UserGate::for_test_root(&root).unwrap());
    let safety = coordinator::SafetyCoordinator::with_gate(retry.clone());
    assert!(!safety.status().unwrap().available);
    let main = safety.connect("main").unwrap();
    let launcher = safety.connect("launcher").unwrap();
    let lease = safety
        .acquire("main", main, coordinator::LeaseKind::Editor)
        .unwrap();
    assert!(matches!(
        safety.admit(),
        Err(coordinator::SafetyError::Unavailable)
    ));
    assert!(matches!(
        safety.begin_preparation(),
        Err(coordinator::SafetyError::Unavailable)
    ));
    let data = root.join("absent-authority-sql");
    let mut output = Vec::new();
    run_with_storage(
        &mut io::Cursor::new(valid_request()),
        &mut output,
        data.clone(),
        retry.admit(),
    )
    .unwrap();
    assert_eq!(response(&output)["error"], "storage_unavailable");
    assert!(!data.exists());
    assert!(!path.exists());
    assert!(
        std::fs::rename(&root, root.with_extension("substituted")).is_err(),
        "unavailable gate retains resolved profile pins"
    );
    let sid = format!("*{}", current_sid());
    icacls(namespace, &["/remove:d", &sid]);
    let operation = safety.admit().unwrap();
    assert!(safety.status().unwrap().available);
    drop(operation);
    let attempt = safety.begin_preparation().unwrap();
    assert_eq!(
        safety.acknowledge("main", main, safety.status().unwrap().generation),
        Err(coordinator::SafetyError::Busy)
    );
    safety.release("main", main, lease).unwrap();
    acknowledge(&safety, main, launcher);
    let guard = attempt.try_freeze().ok().unwrap();
    assert!(retry.admit().is_err());
    drop(guard);
    let mut output = Vec::new();
    run_with_storage(
        &mut io::Cursor::new(valid_request()),
        &mut output,
        data.clone(),
        retry.admit(),
    )
    .unwrap();
    assert_eq!(response(&output)["ok"], true);
    assert!(clip_database_path_from_app_data_dir(&data).exists());
}

#[test]
fn actual_file_acl_denial_recovers_without_replacing_gate_or_existing_activity() {
    let root = fixture();
    let gate = InstallationGate::for_test_root(&root).unwrap();
    let retry = UserGate::for_test_root(&root).unwrap();
    let identity = gate.physical_identity().unwrap();
    let existing = gate.admit().unwrap();
    let path = gate_path(&root);
    let sid = format!("*{}:(W)", current_sid());
    icacls(&path, &["/deny", &sid]);
    assert!(retry.admit().is_err());
    assert!(!retry.available());
    let sid = format!("*{}", current_sid());
    icacls(&path, &["/remove:d", &sid]);
    assert!(retry.admit().is_ok());
    assert_eq!(gate.physical_identity().unwrap(), identity);
    assert!(retry.maintenance(Instant::now()).is_err());
    drop(existing);
    assert!(retry.maintenance(Instant::now()).is_ok());
}

#[test]
fn acl_readonly_installation_does_not_block_external_gate_or_native_sql() {
    let root = fixture();
    let installation = root.join("readonly-installation");
    std::fs::create_dir(&installation).unwrap();
    let executable = installation.join("synthetic-probe.exe");
    // Scenario copy only: the source harness already embeds asInvoker. Never
    // rename/copy an unmanifested test to evade installer detection.
    let bytes = std::fs::read(std::env::current_exe().unwrap()).unwrap();
    assert!(String::from_utf8_lossy(&bytes).contains("level='asInvoker'"));
    std::fs::copy(std::env::current_exe().unwrap(), &executable).unwrap();
    let sid = format!("*{}:(W)", current_sid());
    icacls(&installation, &["/deny", &sid]);
    assert!(
        std::fs::write(installation.join("denied-write"), []).is_err(),
        "real directory ACL must deny creation"
    );
    let gate = InstallationGate::for_test_root(&root).unwrap();
    let mut child = Probe::spawn_at(&root, "readonly-host", &executable, &installation);
    child.send();
    child.expect(&format!("identity:{:?}", gate.physical_identity().unwrap()));
    child.expect("flush");
    assert!(gate.maintenance(Instant::now()).is_err());
    child.send();
    child.expect("success");
    child.wait();
    assert!(gate.maintenance(Instant::now()).is_ok());
    assert!(!installation.join(".slate-maintenance-v1.lock").exists());
    assert!(!installation.join(".slate-coordination").exists());
}
