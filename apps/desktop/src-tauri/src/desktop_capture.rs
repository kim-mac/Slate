use std::sync::Mutex;

use crate::{clips::CreateClip, storage::StorageState};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

pub const CAPTURE_SHORTCUT_LABEL: &str = "Ctrl+Alt+Shift+C";

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

pub fn capture_feedback_message(result: Result<(), CaptureFailure>) -> &'static str {
    match result {
        Ok(()) => "Saved to Tin",
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
        let result = persist_capture(
            crate::platform::capture_selected_text(&handle),
            &*handle.state::<StorageState>(),
        );
        let _ = handle
            .notification()
            .builder()
            .title("Tin")
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
