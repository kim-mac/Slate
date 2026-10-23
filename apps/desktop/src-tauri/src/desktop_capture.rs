use std::sync::Mutex;

use crate::{clips::CreateClip, storage::StorageState};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

pub const CAPTURE_SHORTCUT_LABEL: &str = "Ctrl+Alt+Shift+C";
// An explicit empty title avoids the notification plugin's product-name fallback.
// Windows supplies the installed application's Slate attribution above the body.
pub const CAPTURE_NOTIFICATION_TITLE: &str = "";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapturedSelection {
    pub content: String,
    pub source_app: Option<String>,
    pub source_page_title: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceMetadata {
    pub source_app: Option<String>,
    pub source_page_title: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CaptureFailure {
    ClipboardEdpApiUnavailable,
    ClipboardEdpReadFailed { error_code: i32 },
    ClipboardEdpRestoreFailed { error_code: i32 },
    ClipboardEmptyText,
    ClipboardFormatDuplicateFailed { format: u32, win32_error: u32 },
    ClipboardFormatReadFailed { format: u32, win32_error: u32 },
    ClipboardNoUnicodeText,
    ClipboardRestoration,
    ClipboardSequenceUnchanged,
    ClipboardSnapshotFailed,
    ClipboardWhitespaceOnly,
    ForegroundChanged,
    HotkeyKeysNotReleased,
    Storage,
    SyntheticCopyFailed,
    Unavailable,
}

pub trait ClipSink {
    fn create(&self, input: CreateClip) -> Result<(), ()>;
}

impl ClipSink for StorageState {
    fn create(&self, input: CreateClip) -> Result<(), ()> {
        self.with_service(|service| service.create(input))
            .map(|_| ())
            .map_err(|_| ())
    }
}

pub trait ClipboardCaptureBackend {
    type Snapshot;

    fn foreground_metadata(&mut self) -> Result<SourceMetadata, CaptureFailure>;
    fn clipboard_sequence(&mut self) -> Result<u32, CaptureFailure>;
    fn preserve_clipboard(&mut self) -> Result<Self::Snapshot, CaptureFailure>;
    fn wait_for_modifiers_released(&mut self) -> Result<(), CaptureFailure>;
    fn foreground_is_unchanged(&mut self) -> bool;
    fn send_copy(&mut self) -> Result<(), CaptureFailure>;
    fn wait_for_clipboard_change(&mut self, before: u32) -> Result<bool, CaptureFailure>;
    fn read_text(&mut self) -> Result<Option<String>, CaptureFailure>;
    fn restore_clipboard(&mut self, snapshot: Self::Snapshot) -> Result<(), CaptureFailure>;
}

pub fn capture_clipboard_selection(
    backend: &mut impl ClipboardCaptureBackend,
) -> Result<CapturedSelection, CaptureFailure> {
    let metadata = backend.foreground_metadata()?;
    backend.wait_for_modifiers_released()?;
    let snapshot = backend.preserve_clipboard()?;
    let mut restoration = ClipboardRestorationGuard::new(backend, snapshot);
    let result = (|| {
        let sequence = restoration.backend().clipboard_sequence()?;
        if !restoration.backend().foreground_is_unchanged() {
            return Err(CaptureFailure::ForegroundChanged);
        }
        restoration.backend().send_copy()?;
        if !restoration.backend().wait_for_clipboard_change(sequence)? {
            return Err(CaptureFailure::ClipboardSequenceUnchanged);
        }
        let content = restoration
            .backend()
            .read_text()?
            .ok_or(CaptureFailure::ClipboardNoUnicodeText)?;
        if content.is_empty() {
            return Err(CaptureFailure::ClipboardEmptyText);
        }
        if content.trim().is_empty() {
            return Err(CaptureFailure::ClipboardWhitespaceOnly);
        }
        Ok(CapturedSelection {
            content,
            source_app: metadata.source_app,
            source_page_title: metadata.source_page_title,
        })
    })();
    restoration.finish(result)
}

struct ClipboardRestorationGuard<'a, B: ClipboardCaptureBackend> {
    backend: &'a mut B,
    snapshot: Option<B::Snapshot>,
}

impl<'a, B: ClipboardCaptureBackend> ClipboardRestorationGuard<'a, B> {
    fn new(backend: &'a mut B, snapshot: B::Snapshot) -> Self {
        Self {
            backend,
            snapshot: Some(snapshot),
        }
    }

    fn backend(&mut self) -> &mut B {
        self.backend
    }

    fn finish<T>(mut self, result: Result<T, CaptureFailure>) -> Result<T, CaptureFailure> {
        let snapshot = self.snapshot.take().expect("restoration snapshot missing");
        self.backend
            .restore_clipboard(snapshot)
            .map_err(|failure| {
                if matches!(failure, CaptureFailure::ClipboardEdpRestoreFailed { .. }) {
                    failure
                } else {
                    CaptureFailure::ClipboardRestoration
                }
            })?;
        result
    }
}

impl<B: ClipboardCaptureBackend> Drop for ClipboardRestorationGuard<'_, B> {
    fn drop(&mut self) {
        if let Some(snapshot) = self.snapshot.take() {
            let _ = self.backend.restore_clipboard(snapshot);
        }
    }
}

pub fn persist_capture(
    capture: Result<CapturedSelection, CaptureFailure>,
    sink: &impl ClipSink,
) -> Result<(), CaptureFailure> {
    let captured = capture?;
    if captured.content.is_empty() {
        return Err(CaptureFailure::ClipboardEmptyText);
    }
    if captured.content.trim().is_empty() {
        return Err(CaptureFailure::ClipboardWhitespaceOnly);
    }
    sink.create(CreateClip {
        content: captured.content,
        content_type: "text".to_owned(),
        title: None,
        source_app: captured.source_app,
        source_url: None,
        source_page_title: captured.source_page_title,
    })
    .map_err(|()| CaptureFailure::Storage)
}

pub(crate) fn capture_and_persist(
    storage: &StorageState,
    capture: impl FnOnce() -> Result<CapturedSelection, CaptureFailure>,
) -> Result<(), CaptureFailure> {
    let permit = storage
        .admit_operation()
        .map_err(|_| CaptureFailure::Unavailable)?;
    struct AdmittedSink<'a> {
        storage: &'a StorageState,
        permit: Option<&'a crate::installation_safety::OperationPermit>,
    }
    impl ClipSink for AdmittedSink<'_> {
        fn create(&self, input: CreateClip) -> Result<(), ()> {
            self.storage
                .with_admitted_service(self.permit, |service| service.create(input))
                .map(|_| ())
                .map_err(|_| ())
        }
    }
    let sink = AdmittedSink {
        storage,
        permit: permit.as_ref(),
    };
    persist_capture(capture(), &sink)
}

#[cfg(test)]
mod safety_tests {
    use super::*;
    use crate::installation_safety::SafetyCoordinator;
    use std::cell::Cell;

    fn selection() -> CapturedSelection {
        CapturedSelection {
            content: "admitted selection".into(),
            source_app: None,
            source_page_title: None,
        }
    }

    #[test]
    fn closed_admission_never_touches_the_clipboard_and_does_not_queue_capture() {
        let directory = tempfile::tempdir().unwrap();
        let safety = SafetyCoordinator::new();
        let storage = StorageState::with_safety(directory.path().into(), safety.clone());
        let attempt = safety.begin_preparation().unwrap();
        let called = Cell::new(false);
        assert!(capture_and_persist(&storage, || {
            called.set(true);
            Ok(selection())
        })
        .is_err());
        assert!(!called.get());
        drop(attempt);
        assert!(!called.get());
        assert!(storage.with_service(|s| s.list()).unwrap().is_empty());
    }

    #[test]
    fn admitted_capture_holds_permit_through_restoration_and_persists_after_closure() {
        let directory = tempfile::tempdir().unwrap();
        let safety = SafetyCoordinator::new();
        let main = safety.connect("main").unwrap();
        let launcher = safety.connect("launcher").unwrap();
        let storage = StorageState::with_safety(directory.path().into(), safety.clone());
        let mut attempt = None;
        let mut restored = false;
        capture_and_persist(&storage, || {
            let a = safety.begin_preparation().unwrap();
            let epoch = safety.status().unwrap().generation;
            safety.acknowledge("main", main, epoch).unwrap();
            safety.acknowledge("launcher", launcher, epoch).unwrap();
            let (_, a) = a
                .try_freeze()
                .err()
                .expect("capture lifecycle must drain first");
            // The entire platform capture closure owns the permit, including the
            // ClipboardRestorationGuard's finish/Drop before returning selection.
            restored = true;
            assert!(safety.admit().is_err());
            attempt = Some(a);
            Ok(selection())
        })
        .unwrap();
        assert!(restored);
        let a = attempt.take().unwrap();
        let guard = match a.try_freeze() {
            Ok(g) => g,
            Err(_) => panic!("capture must drain"),
        };
        assert!(storage.with_service(|s| s.list()).is_err());
        drop(guard);
        assert_eq!(
            storage.with_service(|s| s.list()).unwrap()[0].content,
            "admitted selection"
        );
    }

    #[test]
    fn capture_panic_releases_operation_permit() {
        let directory = tempfile::tempdir().unwrap();
        let safety = SafetyCoordinator::new();
        let storage = StorageState::with_safety(directory.path().into(), safety.clone());
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = capture_and_persist(&storage, || panic!("capture backend panic"));
        }))
        .is_err());
        let main = safety.connect("main").unwrap();
        let launcher = safety.connect("launcher").unwrap();
        let a = safety.begin_preparation().unwrap();
        let epoch = safety.status().unwrap().generation;
        safety.acknowledge("main", main, epoch).unwrap();
        safety.acknowledge("launcher", launcher, epoch).unwrap();
        assert!(a.try_freeze().is_ok());
    }

    struct ProbedBackend<F: FnMut(&'static str)>(F);
    impl<F: FnMut(&'static str)> ClipboardCaptureBackend for ProbedBackend<F> {
        type Snapshot = ();
        fn foreground_metadata(&mut self) -> Result<SourceMetadata, CaptureFailure> {
            (self.0)("foreground");
            Ok(SourceMetadata {
                source_app: None,
                source_page_title: None,
            })
        }
        fn clipboard_sequence(&mut self) -> Result<u32, CaptureFailure> {
            (self.0)("sequence");
            Ok(1)
        }
        fn preserve_clipboard(&mut self) -> Result<(), CaptureFailure> {
            (self.0)("snapshot");
            Ok(())
        }
        fn wait_for_modifiers_released(&mut self) -> Result<(), CaptureFailure> {
            (self.0)("modifiers");
            Ok(())
        }
        fn foreground_is_unchanged(&mut self) -> bool {
            (self.0)("check-foreground");
            true
        }
        fn send_copy(&mut self) -> Result<(), CaptureFailure> {
            (self.0)("copy");
            Ok(())
        }
        fn wait_for_clipboard_change(&mut self, _: u32) -> Result<bool, CaptureFailure> {
            (self.0)("changed");
            Ok(true)
        }
        fn read_text(&mut self) -> Result<Option<String>, CaptureFailure> {
            (self.0)("read");
            Ok(Some("admitted selection".into()))
        }
        fn restore_clipboard(&mut self, _: ()) -> Result<(), CaptureFailure> {
            (self.0)("restore");
            Ok(())
        }
    }

    #[test]
    fn real_capture_pipeline_remains_admitted_at_every_stage_including_clipboard_restore() {
        let directory = tempfile::tempdir().unwrap();
        let safety = SafetyCoordinator::new();
        let main = safety.connect("main").unwrap();
        let launcher = safety.connect("launcher").unwrap();
        let storage = StorageState::with_safety(directory.path().into(), safety.clone());
        let mut attempt = None;
        let mut stages = Vec::new();
        let mut backend = ProbedBackend(|stage| {
            if attempt.is_none() {
                let a = safety.begin_preparation().unwrap();
                let epoch = safety.status().unwrap().generation;
                safety.acknowledge("main", main, epoch).unwrap();
                safety.acknowledge("launcher", launcher, epoch).unwrap();
                attempt = Some(a);
            }
            let a = attempt.take().unwrap();
            let (_, a) = a
                .try_freeze()
                .err()
                .expect("platform lifecycle is still admitted");
            attempt = Some(a);
            stages.push(stage);
        });
        capture_and_persist(&storage, || capture_clipboard_selection(&mut backend)).unwrap();
        assert_eq!(stages.first(), Some(&"foreground"));
        assert_eq!(stages.last(), Some(&"restore"));
        assert_eq!(stages.len(), 9);
        let a = attempt.take().unwrap();
        let guard = match a.try_freeze() {
            Ok(guard) => guard,
            Err(_) => panic!("capture drained"),
        };
        drop(guard);
        assert_eq!(
            storage.with_service(|s| s.list()).unwrap()[0].content,
            "admitted selection"
        );
    }
}

pub fn capture_feedback_message(result: Result<(), CaptureFailure>) -> &'static str {
    match result {
        Ok(()) => "Saved to Slate",
        Err(
            CaptureFailure::ClipboardRestoration | CaptureFailure::ClipboardEdpRestoreFailed { .. },
        ) => "Couldn't restore clipboard",
        Err(
            CaptureFailure::ClipboardEmptyText
            | CaptureFailure::ClipboardNoUnicodeText
            | CaptureFailure::ClipboardSequenceUnchanged
            | CaptureFailure::ClipboardWhitespaceOnly,
        ) => "No selected text found",
        Err(
            CaptureFailure::ClipboardSnapshotFailed
            | CaptureFailure::ClipboardEdpApiUnavailable
            | CaptureFailure::ClipboardEdpReadFailed { .. }
            | CaptureFailure::ClipboardFormatDuplicateFailed { .. }
            | CaptureFailure::ClipboardFormatReadFailed { .. }
            | CaptureFailure::ForegroundChanged
            | CaptureFailure::HotkeyKeysNotReleased
            | CaptureFailure::Storage
            | CaptureFailure::SyntheticCopyFailed
            | CaptureFailure::Unavailable,
        ) => "Couldn't capture selection",
    }
}

pub const fn capture_failure_code(failure: CaptureFailure) -> &'static str {
    match failure {
        CaptureFailure::HotkeyKeysNotReleased => "hotkey_keys_not_released",
        CaptureFailure::ClipboardEdpApiUnavailable => "clipboard_edp_api_unavailable",
        CaptureFailure::ClipboardEdpReadFailed { .. } => "clipboard_edp_read_failed",
        CaptureFailure::ClipboardEdpRestoreFailed { .. } => "clipboard_edp_restore_failed",
        CaptureFailure::ClipboardSnapshotFailed => "clipboard_snapshot_failed",
        CaptureFailure::ClipboardFormatReadFailed { .. } => "clipboard_format_read_failed",
        CaptureFailure::ClipboardFormatDuplicateFailed { .. } => {
            "clipboard_format_duplicate_failed"
        }
        CaptureFailure::ClipboardSequenceUnchanged => "clipboard_sequence_unchanged",
        CaptureFailure::ClipboardNoUnicodeText => "clipboard_no_unicode_text",
        CaptureFailure::ClipboardEmptyText => "clipboard_empty_text",
        CaptureFailure::ClipboardWhitespaceOnly => "clipboard_whitespace_only",
        CaptureFailure::SyntheticCopyFailed => "synthetic_copy_failed",
        CaptureFailure::ClipboardRestoration => "clipboard_restore_failed",
        CaptureFailure::Storage => "clip_persistence_failed",
        CaptureFailure::ForegroundChanged => "foreground_window_changed",
        CaptureFailure::Unavailable => "unknown_capture_failure",
    }
}

pub fn capture_notification_body(
    result: Result<(), CaptureFailure>,
    include_reason: bool,
) -> String {
    let generic = capture_feedback_message(result);
    match result {
        Err(failure) if include_reason => {
            let diagnostic = match failure {
                CaptureFailure::ClipboardFormatReadFailed {
                    format,
                    win32_error,
                }
                | CaptureFailure::ClipboardFormatDuplicateFailed {
                    format,
                    win32_error,
                } => format!(
                    "{}; format={format}; win32={win32_error}",
                    capture_failure_code(failure)
                ),
                CaptureFailure::ClipboardEdpReadFailed { error_code }
                | CaptureFailure::ClipboardEdpRestoreFailed { error_code } => {
                    format!("{}; code={error_code}", capture_failure_code(failure))
                }
                _ => capture_failure_code(failure).to_owned(),
            };
            format!("{generic} ({diagnostic})")
        }
        _ => generic.to_owned(),
    }
}

pub(crate) fn shortcut_event(app: &tauri::AppHandle, pressed: bool) {
    let controller = app.state::<CaptureController>();
    if !controller.shortcut_event(pressed) {
        return;
    }

    let handle = app.clone();
    std::thread::spawn(move || {
        let result = capture_and_persist(&*handle.state::<StorageState>(), || {
            crate::platform::capture_selected_text(&handle)
        });
        let _ = handle
            .notification()
            .builder()
            .title(CAPTURE_NOTIFICATION_TITLE)
            .body(capture_notification_body(result, cfg!(debug_assertions)))
            .show();
        handle.state::<CaptureController>().finish();
    });
}

#[derive(Default)]
struct CapturePolicy {
    pressed: bool,
    running: bool,
}

#[derive(Default)]
pub struct CaptureController(Mutex<CapturePolicy>);

impl CaptureController {
    pub fn shortcut_event(&self, pressed: bool) -> bool {
        let Ok(mut policy) = self.0.lock() else {
            return false;
        };
        if pressed {
            policy.pressed = true;
            return false;
        }
        if !policy.pressed {
            return false;
        }
        policy.pressed = false;
        if policy.running {
            return false;
        }
        policy.running = true;
        true
    }

    pub fn finish(&self) {
        if let Ok(mut policy) = self.0.lock() {
            policy.running = false;
        }
    }
}
