use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    mpsc,
};

fn connected() -> (Arc<SafetyCoordinator>, u64, u64) {
    let safety = SafetyCoordinator::new();
    let main = safety.connect("main").unwrap();
    let launcher = safety.connect("launcher").unwrap();
    (safety, main, launcher)
}

#[test]
fn user_preparation_rejects_open_editors_without_freezing_or_losing_leases() {
    for label in ["main", "launcher"] {
        let (s, main, launcher) = connected();
        let generation = if label == "main" { main } else { launcher };
        for kind in [LeaseKind::Editor, LeaseKind::Confirmation] {
            let lease = s.acquire(label, generation, kind).unwrap();
            assert!(matches!(s.begin_user_preparation(), Err(SafetyError::Busy)));
            assert!(!s.status().unwrap().preparing);
            assert!(s.admit().is_ok());
            s.release(label, generation, lease).unwrap();
        }
        drop(s.begin_user_preparation().unwrap());
    }
}

#[test]
fn handoff_revalidates_participants_and_cannot_run_twice() {
    let (s, main, launcher) = connected();
    let attempt = s.begin_user_preparation().unwrap();
    acknowledge(&s, main, launcher);
    let mut guard = freeze(attempt);
    s.disconnected("launcher").unwrap();
    let calls = AtomicUsize::new(0);
    assert_eq!(
        guard.handoff(|| {
            calls.fetch_add(1, Ordering::SeqCst);
        }),
        Err(SafetyError::NotReady)
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    drop(guard);
    assert!(s.admit().is_ok());
    s.connect("launcher").unwrap();
    let launcher = s.lock().unwrap().windows["launcher"].generation;
    let attempt = s.begin_user_preparation().unwrap();
    acknowledge(&s, main, launcher);
    let mut guard = freeze(attempt);
    guard
        .handoff(|| {
            calls.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
    assert_eq!(guard.handoff(|| {}), Err(SafetyError::NotReady));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn unavailable_authority_blocks_preparation_but_preserves_editor_leases() {
    struct Unavailable;
    impl ProcessGate for Unavailable {
        fn available(&self) -> bool {
            false
        }
        fn admit(&self) -> Result<Box<dyn Send>, SafetyError> {
            Err(SafetyError::Unavailable)
        }
        fn maintenance(&self, _: std::time::Instant) -> Result<Box<dyn Send>, SafetyError> {
            Err(SafetyError::Unavailable)
        }
    }
    let safety = SafetyCoordinator::with_gate(Arc::new(Unavailable));
    let main = safety.connect("main").unwrap();
    let lease = safety.acquire("main", main, LeaseKind::Editor).unwrap();
    assert!(matches!(safety.admit(), Err(SafetyError::Unavailable)));
    assert!(matches!(
        safety.begin_preparation(),
        Err(SafetyError::Unavailable)
    ));
    assert!(!safety.status().unwrap().preparing);
    safety.release("main", main, lease).unwrap();
}
fn acknowledge(s: &SafetyCoordinator, main: u64, launcher: u64) {
    let epoch = s.status().unwrap().generation;
    s.acknowledge("main", main, epoch).unwrap();
    s.acknowledge("launcher", launcher, epoch).unwrap();
}
fn freeze(attempt: PreparationAttempt) -> PreparationGuard {
    match attempt.try_freeze() {
        Ok(guard) => guard,
        Err((error, _)) => panic!("not ready: {error:?}"),
    }
}

#[test]
fn closes_admission_atomically_and_drop_restores_it_without_deferred_work() {
    let (s, main, launcher) = connected();
    let before = s.status().unwrap().generation;
    let attempt = s.begin_preparation().unwrap();
    assert!(s.admit().is_err());
    assert_eq!(
        s.acquire("main", main, LeaseKind::Editor),
        Err(SafetyError::Preparing)
    );
    assert!(s.begin_preparation().is_err());
    acknowledge(&s, main, launcher);
    let mut guard = freeze(attempt);
    let calls = AtomicUsize::new(0);
    guard
        .run_mock(|| {
            calls.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
    assert!(guard
        .run_mock(|| {
            calls.fetch_add(1, Ordering::SeqCst);
        })
        .is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(s.admit().is_err());
    drop(guard);
    assert!(s.admit().is_ok());
    assert!(!s.status().unwrap().preparing);
    assert!(s.status().unwrap().generation > before + 1);
}

#[test]
fn every_expected_window_must_connect_and_ack_even_when_hidden() {
    let s = SafetyCoordinator::new();
    assert_eq!(s.connect("unexpected"), Err(SafetyError::UnknownWindow));
    let main = s.connect("main").unwrap();
    let attempt = s.begin_preparation().unwrap();
    let epoch = s.status().unwrap().generation;
    s.acknowledge("main", main, epoch).unwrap();
    let (_, attempt) = attempt.try_freeze().err().unwrap();
    assert!(s.connect("launcher").is_err());
    drop(attempt);
    let launcher = s.connect("launcher").unwrap();
    let attempt = s.begin_preparation().unwrap();
    s.acknowledge("main", main, s.status().unwrap().generation)
        .unwrap();
    let (_, attempt) = attempt.try_freeze().err().unwrap();
    s.acknowledge("launcher", launcher, s.status().unwrap().generation)
        .unwrap();
    drop(freeze(attempt));
}

#[test]
fn editor_and_confirmation_leases_block_and_cannot_be_retired_by_reconnect_or_stale_release() {
    for kind in [LeaseKind::Editor, LeaseKind::Confirmation] {
        let (s, main, launcher) = connected();
        let lease = s.acquire("launcher", launcher, kind).unwrap();
        assert!(s.connect("launcher").is_err());
        assert!(s.release("main", main, lease).is_err());
        let attempt = s.begin_preparation().unwrap();
        let epoch = s.status().unwrap().generation;
        assert!(s.acknowledge("launcher", launcher, epoch).is_err());
        assert!(s.release("launcher", launcher + 99, lease).is_err());
        s.release("launcher", launcher, lease).unwrap();
        assert!(s.release("launcher", launcher, lease).is_err());
        acknowledge(&s, main, launcher);
        drop(freeze(attempt));
    }
}

#[test]
fn stale_acks_and_crashed_window_generations_never_authorize_a_boundary() {
    let (s, main, launcher) = connected();
    let attempt = s.begin_preparation().unwrap();
    let old_epoch = s.status().unwrap().generation;
    acknowledge(&s, main, launcher);
    drop(attempt); // cancellation/timeout is the same owned-guard cleanup path
    let attempt = s.begin_preparation().unwrap();
    assert!(s.acknowledge("main", main, old_epoch).is_err());
    acknowledge(&s, main, launcher);
    s.disconnected("launcher").unwrap();
    assert!(s
        .acknowledge("launcher", launcher, s.status().unwrap().generation)
        .is_err());
    let (_, attempt) = attempt.try_freeze().err().unwrap();
    drop(attempt);
    let replacement = s.connect("launcher").unwrap();
    assert_ne!(replacement, launcher);
    let attempt = s.begin_preparation().unwrap();
    assert!(s
        .acknowledge("launcher", launcher, s.status().unwrap().generation)
        .is_err());
    acknowledge(&s, main, replacement);
    drop(freeze(attempt));
}

#[test]
fn concurrent_admitted_operations_drain_before_guard_can_exist() {
    let (s, main, launcher) = connected();
    let one = s.admit().unwrap();
    let other = s.admit().unwrap();
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        rx.recv().unwrap();
        drop(other);
    });
    let attempt = s.begin_preparation().unwrap();
    acknowledge(&s, main, launcher);
    let (_, attempt) = attempt.try_freeze().err().unwrap();
    drop(one);
    let (_, attempt) = attempt.try_freeze().err().unwrap();
    tx.send(()).unwrap();
    worker.join().unwrap();
    drop(freeze(attempt));
}

#[test]
fn panic_and_failed_preparation_recover_admission_and_invalidate_old_ack() {
    let (s, main, launcher) = connected();
    let epoch = s.status().unwrap().generation;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let attempt = s.begin_preparation().unwrap();
        acknowledge(&s, main, launcher);
        let _guard = freeze(attempt);
        panic!("mock preparation failure");
    }));
    assert!(result.is_err());
    assert!(s.admit().is_ok());
    assert!(s.status().unwrap().generation > epoch);
    let attempt = s.begin_preparation().unwrap();
    assert!(attempt.try_freeze().is_err());
    assert!(s.admit().is_ok());
}

#[test]
fn creation_failure_never_excludes_a_required_window() {
    let s = SafetyCoordinator::new();
    let main = s.connect("main").unwrap();
    s.launcher_creation_failed().unwrap();
    let attempt = s.begin_preparation().unwrap();
    s.acknowledge("main", main, s.status().unwrap().generation)
        .unwrap();
    assert!(attempt.try_freeze().is_err());
    let (s, _, _) = connected();
    assert!(s.launcher_creation_failed().is_err());
    s.disconnected("launcher").unwrap();
    assert!(s.launcher_creation_failed().is_err());
}

#[test]
fn mock_boundary_panic_does_not_poison_policy_and_cannot_execute_again() {
    let (s, main, launcher) = connected();
    let a = s.begin_preparation().unwrap();
    acknowledge(&s, main, launcher);
    let mut guard = freeze(a);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = guard.run_mock(|| panic!("mock boundary failure"));
    }))
    .is_err());
    assert!(guard
        .run_mock(|| panic!("boundary may only run once"))
        .is_err());
    drop(guard);
    assert!(s.admit().is_ok());
    assert!(!s.status().unwrap().preparing);
}

#[test]
fn runtime_monitor_registration_failure_is_fail_closed_even_after_acknowledgement() {
    let (s, main, launcher) = connected();
    s.require_lifecycle_monitor("launcher").unwrap();
    let a = s.begin_preparation().unwrap();
    acknowledge(&s, main, launcher);
    let (_, a) = a
        .try_freeze()
        .err()
        .expect("unobserved renderer cannot be safe");
    s.lifecycle_monitor_ready("launcher").unwrap();
    let mut guard = freeze(a);
    s.disconnected("launcher").unwrap();
    assert!(guard
        .run_mock(|| panic!("crashed participant must block boundary"))
        .is_err());
    drop(guard);
    assert!(s.admit().is_ok());
}

#[test]
fn repeated_acquisition_creates_independent_leases_and_old_connections_cannot_release_them() {
    let (s, main, _) = connected();
    let one = s.acquire("main", main, LeaseKind::Editor).unwrap();
    let two = s.acquire("main", main, LeaseKind::Editor).unwrap();
    assert_ne!(one, two);
    s.release("main", main, one).unwrap();
    assert!(s.connect("main").is_err());
    s.release("main", main, two).unwrap();
    let replacement = s.connect("main").unwrap();
    assert_ne!(replacement, main);
    let lease = s
        .acquire("main", replacement, LeaseKind::Confirmation)
        .unwrap();
    assert!(s.release("main", main, lease).is_err());
    s.release("main", replacement, lease).unwrap();
}

#[test]
fn elapsed_deadline_reopens_admission_without_waiting_or_executing_late_work() {
    let (s, main, launcher) = connected();
    let a = s.begin_preparation().unwrap();
    let epoch = s.status().unwrap().generation;
    acknowledge(&s, main, launcher);
    let future = std::time::Instant::now() + std::time::Duration::from_secs(60);
    let (error, a) = a
        .try_freeze_at(future)
        .err()
        .expect("expired attempt cannot freeze");
    assert_eq!(error, SafetyError::TimedOut);
    assert!(!s.status().unwrap().preparing);
    assert!(s.status().unwrap().generation > epoch);
    assert!(s.admit().is_ok());
    assert!(a.try_freeze().is_err());
    let retry = s.begin_preparation().unwrap();
    assert!(s.acknowledge("main", main, epoch).is_err());
    acknowledge(&s, main, launcher);
    drop(freeze(retry));
}

#[test]
fn status_observer_reports_both_transitions_with_increasing_epochs() {
    let (s, _, _) = connected();
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let recorded = events.clone();
    s.observe(Arc::new(move |status| {
        recorded.lock().unwrap().push(status)
    }))
    .unwrap();
    let attempt = s.begin_preparation().unwrap();
    drop(attempt);
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 2);
    assert!(events[0].preparing);
    assert!(!events[1].preparing);
    assert!(events[1].generation > events[0].generation);
}

#[test]
fn admitted_permits_are_bound_to_the_exact_coordinator() {
    let one = SafetyCoordinator::new();
    let two = SafetyCoordinator::new();
    let permit = one.admit().unwrap();
    assert!(permit.belongs_to(&one));
    assert!(permit.belongs_to(&one.clone()));
    assert!(!permit.belongs_to(&two));
}
