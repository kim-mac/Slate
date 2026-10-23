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
fn ordinary_close_checks_only_retained_local_inline_leases() {
    struct Unavailable;
    impl ProcessGate for Unavailable {
        fn available(&self) -> bool {
            false
        }
        fn admit(&self) -> Result<Box<dyn Send>, SafetyError> {
            panic!("ordinary close must not enter process gate")
        }
        fn maintenance(&self, _: std::time::Instant) -> Result<Box<dyn Send>, SafetyError> {
            panic!("ordinary close must not enter process gate")
        }
    }
    let s = SafetyCoordinator::with_gate(Arc::new(Unavailable));
    assert_eq!(s.main_close_needs_save(), Ok(false));
    assert_eq!(s.with_main_close_hide(|| 42), Ok(42));
    let main = s.connect("main").unwrap();
    s.require_lifecycle_monitor("main").unwrap();
    assert_eq!(s.main_close_needs_save(), Ok(false));
    assert_eq!(s.with_main_close_hide(|| 42), Ok(42));
    let inline = s.acquire("main", main, LeaseKind::InlineEditor).unwrap();
    s.disconnected("main").unwrap();
    {
        let mut p = s.lock().unwrap();
        p.status.preparing = true;
        p.frozen = true;
    }
    assert_eq!(s.main_close_needs_save(), Ok(true));
    assert_eq!(
        s.with_main_close_hide(|| panic!("retained inline draft must not hide")),
        Err(SafetyError::Busy)
    );
    // Simulate the retained draft being explicitly resolved; registration,
    // installation authority and preparation do not govern ordinary tray hide.
    s.lock()
        .unwrap()
        .windows
        .get_mut("main")
        .unwrap()
        .leases
        .remove(&inline);
    assert_eq!(s.main_close_needs_save(), Ok(false));
    assert_eq!(s.with_main_close_hide(|| 42), Ok(42));
}

#[test]
fn ordinary_close_poisoned_policy_cannot_authorize_hide() {
    let s = SafetyCoordinator::new();
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = s.policy.lock().unwrap();
        panic!("synthetic policy failure");
    }));
    assert_eq!(s.main_close_needs_save(), Err(SafetyError::Unavailable));
    assert_eq!(
        s.with_main_close_hide(|| panic!("must not hide")),
        Err(SafetyError::Unavailable)
    );
}

#[test]
fn lost_release_reply_can_retry_only_the_last_exact_window_generation_receipt() {
    let (s, main, launcher) = connected();
    let inline = s.acquire("main", main, LeaseKind::InlineEditor).unwrap();
    let other = s.acquire("main", main, LeaseKind::Editor).unwrap();
    s.release("main", main, inline).unwrap(); // Native release succeeded; reply was lost.
    assert_eq!(s.release("main", main, inline), Ok(()));
    assert_eq!(s.lock().unwrap().windows["main"].leases.len(), 1);
    assert!(s.lock().unwrap().windows["main"]
        .leases
        .contains_key(&other));
    assert_eq!(
        s.release("launcher", launcher, inline),
        Err(SafetyError::InvalidLease)
    );
    assert_eq!(
        s.release("main", main + 99, inline),
        Err(SafetyError::StaleGeneration)
    );
    assert_eq!(
        s.release("unknown", main, inline),
        Err(SafetyError::UnknownWindow)
    );
    assert_eq!(
        s.release("main", main, other + 99),
        Err(SafetyError::InvalidLease)
    );
    assert_eq!(s.release("main", main, inline), Ok(()));
    s.release("main", main, other).unwrap();
    assert_eq!(
        s.release("main", main, inline),
        Err(SafetyError::InvalidLease)
    );
    assert_eq!(s.release("main", main, other), Ok(()));
    s.disconnected("main").unwrap();
    assert_eq!(
        s.release("main", main, other),
        Err(SafetyError::UninitializedWindow)
    );
    let replacement = s.connect("main").unwrap();
    assert_eq!(
        s.release("main", main, other),
        Err(SafetyError::StaleGeneration)
    );
    assert_eq!(
        s.release("main", replacement, other),
        Err(SafetyError::InvalidLease)
    );
}

#[test]
fn concurrent_duplicate_release_preserves_other_active_leases() {
    let (s, main, _) = connected();
    let inline = s.acquire("main", main, LeaseKind::InlineEditor).unwrap();
    let other = s.acquire("main", main, LeaseKind::Editor).unwrap();
    std::thread::scope(|scope| {
        let first = scope.spawn(|| s.release("main", main, inline));
        let second = scope.spawn(|| s.release("main", main, inline));
        assert_eq!(first.join().unwrap(), Ok(()));
        assert_eq!(second.join().unwrap(), Ok(()));
    });
    assert_eq!(s.lock().unwrap().windows["main"].leases.len(), 1);
    assert!(s.lock().unwrap().windows["main"]
        .leases
        .contains_key(&other));
    s.release("main", main, other).unwrap();
}

#[test]
fn inline_main_close_preserves_full_edit_hide_and_defers_only_inline_editor() {
    let (s, main, launcher) = connected();
    assert_eq!(s.main_close_needs_save(), Ok(false));
    let launcher_editor = s.acquire("launcher", launcher, LeaseKind::Editor).unwrap();
    assert_eq!(s.main_close_needs_save(), Ok(false));
    let editor = s.acquire("main", main, LeaseKind::Editor).unwrap();
    assert_eq!(s.main_close_needs_save(), Ok(false));
    assert_eq!(s.with_main_close_hide(|| 42), Ok(42));
    s.release("main", main, editor).unwrap();
    let confirmation = s.acquire("main", main, LeaseKind::Confirmation).unwrap();
    assert_eq!(s.main_close_needs_save(), Ok(false));
    assert_eq!(s.with_main_close_hide(|| 42), Ok(42));
    s.release("main", main, confirmation).unwrap();
    let inline = s.acquire("main", main, LeaseKind::InlineEditor).unwrap();
    assert_eq!(s.main_close_needs_save(), Ok(true));
    assert_eq!(
        s.with_main_close_hide(|| panic!("inline draft must not hide")),
        Err(SafetyError::Busy)
    );
    s.release("main", main, inline).unwrap();
    s.release("launcher", launcher, launcher_editor).unwrap();
}

#[test]
fn inline_main_hide_rechecks_registration_leases_and_ambiguous_state() {
    let s = SafetyCoordinator::new();
    assert_eq!(
        s.with_main_hide("launcher", || panic!("must not hide")),
        Err(SafetyError::UnknownWindow)
    );
    assert_eq!(
        s.with_main_hide("main", || panic!("must not hide")),
        Err(SafetyError::UninitializedWindow)
    );
    let main = s.connect("main").unwrap();
    for kind in [
        LeaseKind::Editor,
        LeaseKind::InlineEditor,
        LeaseKind::Confirmation,
    ] {
        let lease = s.acquire("main", main, kind).unwrap();
        assert_eq!(
            s.with_main_hide("main", || panic!("must not hide")),
            Err(SafetyError::Busy)
        );
        s.release("main", main, lease).unwrap();
    }
    s.require_lifecycle_monitor("main").unwrap();
    assert_eq!(
        s.with_main_hide("main", || panic!("must not hide")),
        Err(SafetyError::NotReady)
    );
    s.lifecycle_monitor_ready("main").unwrap();
    assert_eq!(s.with_main_hide("main", || 42), Ok(42));
    s.disconnected("main").unwrap();
    assert_eq!(
        s.with_main_hide("main", || panic!("must not hide")),
        Err(SafetyError::UninitializedWindow)
    );
}

#[test]
fn inline_main_hide_rejects_preparation_and_unavailable_authority() {
    let (s, _, _) = connected();
    let attempt = s.begin_preparation().unwrap();
    assert_eq!(
        s.with_main_hide("main", || panic!("must not hide")),
        Err(SafetyError::Busy)
    );
    drop(attempt);
    s.lock().unwrap().quitting = true;
    assert_eq!(
        s.with_main_hide("main", || panic!("must not hide")),
        Err(SafetyError::Busy)
    );
    struct Unavailable;
    impl ProcessGate for Unavailable {
        fn available(&self) -> bool {
            false
        }
        fn admit(&self) -> Result<Box<dyn Send>, SafetyError> {
            panic!("hide cannot acquire a process gate")
        }
        fn maintenance(&self, _: std::time::Instant) -> Result<Box<dyn Send>, SafetyError> {
            panic!("hide cannot acquire a process gate")
        }
    }
    let s = SafetyCoordinator::with_gate(Arc::new(Unavailable));
    s.connect("main").unwrap();
    assert_eq!(
        s.with_main_hide("main", || panic!("must not hide")),
        Err(SafetyError::Unavailable)
    );
}

#[test]
fn inline_main_hide_serializes_final_check_with_concurrent_editor_acquisition() {
    let (s, main, _) = connected();
    let (entered, inside) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let (acquired, result) = mpsc::channel();
    std::thread::scope(|scope| {
        let safety = s.clone();
        let hide = scope.spawn(move || {
            safety.with_main_hide("main", || {
                entered.send(()).unwrap();
                resume.recv().unwrap();
            })
        });
        inside.recv().unwrap();
        let safety = s.clone();
        let editor = scope.spawn(move || {
            acquired
                .send(safety.acquire("main", main, LeaseKind::Editor))
                .unwrap()
        });
        assert!(result
            .recv_timeout(std::time::Duration::from_millis(20))
            .is_err());
        release.send(()).unwrap();
        hide.join().unwrap().unwrap();
        editor.join().unwrap();
        let lease = result.recv().unwrap().unwrap();
        s.release("main", main, lease).unwrap();
    });
}

#[test]
fn quit_rejects_drafts_and_saves_without_stranding_normal_operation() {
    let (s, main, launcher) = connected();
    for (label, generation) in [("main", main), ("launcher", launcher)] {
        for kind in [
            LeaseKind::Editor,
            LeaseKind::InlineEditor,
            LeaseKind::Confirmation,
        ] {
            let lease = s.acquire(label, generation, kind).unwrap();
            assert_eq!(s.begin_quit(), Err(SafetyError::Busy));
            assert!(s.admit().is_ok());
            s.release(label, generation, lease).unwrap();
        }
    }
    let operation = s.admit().unwrap();
    assert_eq!(s.begin_quit(), Err(SafetyError::Busy));
    drop(operation);
    assert_eq!(s.begin_quit(), Ok(()));
    assert!(matches!(s.admit(), Err(SafetyError::Busy)));
    assert_eq!(
        s.acquire("main", main, LeaseKind::Editor),
        Err(SafetyError::Busy)
    );
    assert!(matches!(s.begin_user_preparation(), Err(SafetyError::Busy)));
}

#[test]
fn admission_and_quit_are_atomic_under_concurrent_requests() {
    for _ in 0..100 {
        let s = SafetyCoordinator::new();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        std::thread::scope(|scope| {
            let other = Arc::clone(&barrier);
            let safety = Arc::clone(&s);
            let writer = scope.spawn(move || {
                other.wait();
                safety.admit()
            });
            barrier.wait();
            let quit = s.begin_quit();
            let operation = writer.join().unwrap();
            assert!(!(quit.is_ok() && operation.is_ok()));
        });
    }
}

#[test]
fn user_preparation_rejects_open_editors_without_freezing_or_losing_leases() {
    for label in ["main", "launcher"] {
        let (s, main, launcher) = connected();
        let generation = if label == "main" { main } else { launcher };
        for kind in [
            LeaseKind::Editor,
            LeaseKind::InlineEditor,
            LeaseKind::Confirmation,
        ] {
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
    assert!(matches!(
        guard.handoff(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok::<(), ()>(())
        }),
        Err(SafetyError::NotReady)
    ));
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
            Ok::<(), ()>(())
        })
        .unwrap()
        .ok()
        .unwrap();
    assert!(matches!(
        guard.handoff(|| Ok::<(), ()>(())),
        Err(SafetyError::NotReady)
    ));
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
    for kind in [
        LeaseKind::Editor,
        LeaseKind::InlineEditor,
        LeaseKind::Confirmation,
    ] {
        let (s, main, launcher) = connected();
        let lease = s.acquire("launcher", launcher, kind).unwrap();
        assert!(s.connect("launcher").is_err());
        assert!(s.release("main", main, lease).is_err());
        let attempt = s.begin_preparation().unwrap();
        let epoch = s.status().unwrap().generation;
        assert!(s.acknowledge("launcher", launcher, epoch).is_err());
        assert!(s.release("launcher", launcher + 99, lease).is_err());
        s.release("launcher", launcher, lease).unwrap();
        // An identical retry acknowledges the one retained release receipt.
        assert_eq!(s.release("launcher", launcher, lease), Ok(()));
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

#[test]
fn authorized_update_exit_keeps_preparation_and_process_maintenance_held() {
    struct Maintenance(Arc<AtomicUsize>);
    impl Drop for Maintenance {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }
    struct Gate(Arc<AtomicUsize>);
    impl ProcessGate for Gate {
        fn admit(&self) -> Result<Box<dyn Send>, SafetyError> {
            Ok(Box::new(()))
        }
        fn maintenance(&self, _: std::time::Instant) -> Result<Box<dyn Send>, SafetyError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(Maintenance(self.0.clone())))
        }
    }
    let held = Arc::new(AtomicUsize::new(0));
    let s = SafetyCoordinator::with_gate(Arc::new(Gate(held.clone())));
    let main = s.connect("main").unwrap();
    let launcher = s.connect("launcher").unwrap();
    let attempt = s.begin_user_preparation().unwrap();
    assert_eq!(s.begin_quit(), Err(SafetyError::Busy));
    acknowledge(&s, main, launcher);
    let mut guard = freeze(attempt);
    let authorization = guard.handoff(|| Ok::<(), ()>(())).unwrap().ok().unwrap();
    assert_eq!(s.begin_quit(), Err(SafetyError::Busy));
    assert_eq!(authorization.begin_exit(), Ok(()));
    assert!(s.status().unwrap().preparing);
    assert_eq!(held.load(Ordering::SeqCst), 1);
    assert!(s.admit().is_err());
    assert!(s.acquire("main", main, LeaseKind::Editor).is_err());
    assert_eq!(s.begin_quit(), Err(SafetyError::Busy));
    assert!(matches!(
        guard.handoff(|| Ok::<(), ()>(())),
        Err(SafetyError::NotReady)
    ));
    drop(guard); // Simulates process teardown, not an early maintenance release.
    assert_eq!(held.load(Ordering::SeqCst), 0);
    assert!(s.admit().is_err()); // Exit admission stays terminal even after teardown.
}

#[test]
fn failed_handoff_issues_no_exit_authority_and_cannot_be_repeated() {
    let (s, main, launcher) = connected();
    let attempt = s.begin_user_preparation().unwrap();
    acknowledge(&s, main, launcher);
    let mut guard = freeze(attempt);
    assert!(matches!(
        guard.handoff(|| Err("launch failed")),
        Ok(Err("launch failed"))
    ));
    assert!(!s.lock().unwrap().quitting);
    assert_eq!(s.begin_quit(), Err(SafetyError::Busy));
    assert!(matches!(
        guard.handoff(|| Ok::<(), ()>(())),
        Err(SafetyError::NotReady)
    ));
    drop(guard);
    assert!(s.admit().is_ok());
    assert_eq!(s.begin_quit(), Ok(()));
}

#[test]
fn canceled_preparation_cannot_handoff_or_reuse_its_acknowledgments() {
    let (s, main, launcher) = connected();
    let attempt = s.begin_user_preparation().unwrap();
    acknowledge(&s, main, launcher);
    drop(attempt);
    assert!(!s.lock().unwrap().quitting);
    assert!(s.admit().is_ok());
    let next = s.begin_user_preparation().unwrap();
    assert!(matches!(next.try_freeze(), Err((SafetyError::NotReady, _))));
    assert!(s.admit().is_ok());
}

#[test]
fn retired_handoff_authority_cannot_exit_a_replacement_preparation() {
    let (s, main, launcher) = connected();
    let attempt = s.begin_user_preparation().unwrap();
    acknowledge(&s, main, launcher);
    let mut guard = freeze(attempt);
    let authorization = guard.handoff(|| Ok::<(), ()>(())).unwrap().ok().unwrap();
    drop(guard);
    let next = s.begin_user_preparation().unwrap();
    acknowledge(&s, main, launcher);
    let _guard = freeze(next);
    assert_eq!(authorization.begin_exit(), Err(SafetyError::NotReady));
    assert!(!s.lock().unwrap().quitting);
    assert_eq!(s.begin_quit(), Err(SafetyError::Busy));
}

#[test]
fn successful_handoff_exit_is_not_stranded_by_later_renderer_disconnect_or_deadline() {
    let (s, main, launcher) = connected();
    let attempt = s.begin_user_preparation().unwrap();
    acknowledge(&s, main, launcher);
    let mut guard = freeze(attempt);
    let authorization = guard.handoff(|| Ok::<(), ()>(())).unwrap().ok().unwrap();
    guard.deadline = std::time::Instant::now();
    s.disconnected("launcher").unwrap();
    assert_eq!(authorization.begin_exit(), Ok(()));
    assert!(s.status().unwrap().preparing);
}

#[test]
fn expired_handoff_cannot_launch_or_issue_authority_and_recovers_on_drop() {
    let (s, main, launcher) = connected();
    let attempt = s.begin_user_preparation().unwrap();
    acknowledge(&s, main, launcher);
    let mut guard = freeze(attempt);
    guard.deadline = std::time::Instant::now();
    assert!(matches!(
        guard.handoff(|| -> Result<(), ()> { panic!("must not launch") }),
        Err(SafetyError::TimedOut)
    ));
    assert!(!s.lock().unwrap().quitting);
    drop(guard);
    assert!(s.admit().is_ok());
}
