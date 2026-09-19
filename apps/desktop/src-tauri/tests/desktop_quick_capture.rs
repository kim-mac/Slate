use std::sync::Mutex;

use ai_clip_memory_desktop_lib::clips::CreateClip;
use ai_clip_memory_desktop_lib::desktop_capture::{
    capture_clipboard_selection, capture_failure_code, capture_feedback_message,
    capture_notification_body, persist_capture, CaptureController, CaptureFailure,
    CapturedSelection, ClipSink, ClipboardCaptureBackend, SourceMetadata, CAPTURE_SHORTCUT_LABEL,
};
use ai_clip_memory_desktop_lib::{clips::ClipService, storage::StorageState};

#[derive(Default)]
struct RecordingSink {
    inputs: Mutex<Vec<CreateClip>>,
    fail: bool,
}

impl ClipSink for RecordingSink {
    fn create(&self, input: CreateClip) -> Result<(), ()> {
        if self.fail {
            return Err(());
        }
        self.inputs.lock().unwrap().push(input);
        Ok(())
    }
}

fn selection(content: &str) -> CapturedSelection {
    CapturedSelection {
        content: content.to_owned(),
        source_app: Some("Notepad".to_owned()),
        source_page_title: Some("notes.txt - Notepad".to_owned()),
    }
}

#[test]
fn successful_capture_creates_exactly_one_text_clip_through_the_sink() {
    let sink = RecordingSink::default();

    persist_capture(Ok(selection("  selected text\r\n  ")), &sink)
        .expect("valid selected text should be stored");

    let inputs = sink.inputs.lock().unwrap();
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs[0].content, "  selected text\r\n  ");
    assert_eq!(inputs[0].content_type, "text");
    assert_eq!(inputs[0].source_app.as_deref(), Some("Notepad"));
    assert_eq!(
        inputs[0].source_page_title.as_deref(),
        Some("notes.txt - Notepad")
    );
    assert_eq!(inputs[0].source_url, None);
    assert_eq!(inputs[0].title, None);
}

#[test]
fn production_storage_sink_persists_through_clip_service() {
    let directory = tempfile::tempdir().unwrap();
    let storage = StorageState::new(directory.path().to_owned());

    persist_capture(Ok(selection("service boundary")), &storage).unwrap();

    let clips = storage.with_service(ClipService::list).unwrap();
    assert_eq!(clips.len(), 1);
    assert_eq!(clips[0].content, "service boundary");
    assert_eq!(clips[0].content_type, "text");
}

#[test]
fn unchanged_empty_or_whitespace_clipboards_never_create_a_clip() {
    let sink = RecordingSink::default();

    assert_eq!(
        persist_capture(Err(CaptureFailure::ClipboardSequenceUnchanged), &sink),
        Err(CaptureFailure::ClipboardSequenceUnchanged)
    );
    assert_eq!(
        persist_capture(Ok(selection("")), &sink),
        Err(CaptureFailure::ClipboardEmptyText)
    );
    assert_eq!(
        persist_capture(Ok(selection(" \r\n\t ")), &sink),
        Err(CaptureFailure::ClipboardWhitespaceOnly)
    );
    assert!(sink.inputs.lock().unwrap().is_empty());
}

#[test]
fn capture_or_storage_failure_does_not_create_a_partial_clip() {
    let sink = RecordingSink::default();
    assert_eq!(
        persist_capture(Err(CaptureFailure::Unavailable), &sink),
        Err(CaptureFailure::Unavailable)
    );
    assert!(sink.inputs.lock().unwrap().is_empty());

    let failing = RecordingSink {
        fail: true,
        ..RecordingSink::default()
    };
    assert_eq!(
        persist_capture(Ok(selection("selected")), &failing),
        Err(CaptureFailure::Storage)
    );
    assert!(failing.inputs.lock().unwrap().is_empty());
}

#[test]
fn shortcut_release_runs_once_and_blocks_repeats_until_completion() {
    let controller = CaptureController::default();

    assert!(!controller.shortcut_event(true));
    assert!(!controller.shortcut_event(true));
    assert!(controller.shortcut_event(false));
    assert!(!controller.shortcut_event(false));
    assert!(!controller.shortcut_event(true));
    assert!(!controller.shortcut_event(false));

    controller.finish();
    assert!(!controller.shortcut_event(true));
    assert!(controller.shortcut_event(false));
}

#[test]
fn release_during_an_active_capture_cannot_arm_a_later_capture() {
    let controller = CaptureController::default();

    assert!(!controller.shortcut_event(true));
    assert!(controller.shortcut_event(false));
    assert!(!controller.shortcut_event(true));
    assert!(!controller.shortcut_event(false));
    controller.finish();

    assert!(!controller.shortcut_event(false));
}

#[test]
fn capture_shortcut_is_isolated_and_avoids_save_as() {
    assert_eq!(CAPTURE_SHORTCUT_LABEL, "Ctrl+Alt+Shift+C");
    assert_ne!(CAPTURE_SHORTCUT_LABEL, "Ctrl+Shift+S");
}

#[test]
fn capture_module_contains_no_content_logging_calls() {
    for source in [
        include_str!("../src/desktop_capture.rs"),
        include_str!("../src/platform/windows_capture.rs"),
    ] {
        for forbidden in ["println!", "eprintln!", "dbg!", "tracing::", "log::"] {
            assert!(
                !source.contains(forbidden),
                "desktop capture must not log through {forbidden}"
            );
        }
    }
}

#[test]
fn windows_registers_both_launcher_and_capture_shortcuts() {
    let source = include_str!("../src/platform/windows.rs");
    assert!(source.contains(".register(launcher_shortcut())"));
    assert!(source.contains(".register(capture_shortcut())"));
    assert_eq!(source.matches("Builder::new()").count(), 1);
}

#[test]
fn windows_snapshot_owns_duplicated_formats_instead_of_a_live_ole_reference() {
    let source = include_str!("../src/platform/windows_capture.rs");
    for required in [
        "EnumClipboardFormats",
        "OleDuplicateData",
        "SetClipboardData",
    ] {
        assert!(source.contains(required));
    }
    for forbidden in ["IDataObject", "OleGetClipboard", "OleSetClipboard"] {
        assert!(!source.contains(forbidden));
    }
}

#[test]
fn feedback_is_generic_and_never_contains_captured_content() {
    assert_eq!(capture_feedback_message(Ok(())), "Saved to Slate");
    assert_eq!(
        capture_feedback_message(Err(CaptureFailure::ClipboardEmptyText)),
        "No selected text found"
    );
    assert_eq!(
        capture_feedback_message(Err(CaptureFailure::ClipboardRestoration)),
        "Couldn't restore clipboard"
    );
    assert_eq!(
        capture_feedback_message(Err(CaptureFailure::ClipboardSequenceUnchanged)),
        "No selected text found"
    );
    assert_eq!(
        capture_feedback_message(Err(CaptureFailure::Storage)),
        "Couldn't capture selection"
    );
    assert_eq!(
        capture_feedback_message(Err(CaptureFailure::Unavailable)),
        "Couldn't capture selection"
    );
}

#[test]
fn structured_failure_reasons_are_stable_and_content_free() {
    let cases = [
        (
            CaptureFailure::HotkeyKeysNotReleased,
            "hotkey_keys_not_released",
        ),
        (
            CaptureFailure::ClipboardSnapshotFailed,
            "clipboard_snapshot_failed",
        ),
        (
            CaptureFailure::ClipboardEdpApiUnavailable,
            "clipboard_edp_api_unavailable",
        ),
        (
            CaptureFailure::ClipboardEdpReadFailed { error_code: -1 },
            "clipboard_edp_read_failed",
        ),
        (
            CaptureFailure::ClipboardEdpRestoreFailed { error_code: -2 },
            "clipboard_edp_restore_failed",
        ),
        (
            CaptureFailure::ClipboardFormatReadFailed {
                format: 13,
                win32_error: 5,
            },
            "clipboard_format_read_failed",
        ),
        (
            CaptureFailure::ClipboardFormatDuplicateFailed {
                format: 13,
                win32_error: 8,
            },
            "clipboard_format_duplicate_failed",
        ),
        (
            CaptureFailure::ClipboardSequenceUnchanged,
            "clipboard_sequence_unchanged",
        ),
        (
            CaptureFailure::ClipboardNoUnicodeText,
            "clipboard_no_unicode_text",
        ),
        (CaptureFailure::ClipboardEmptyText, "clipboard_empty_text"),
        (
            CaptureFailure::ClipboardWhitespaceOnly,
            "clipboard_whitespace_only",
        ),
        (CaptureFailure::SyntheticCopyFailed, "synthetic_copy_failed"),
        (
            CaptureFailure::ClipboardRestoration,
            "clipboard_restore_failed",
        ),
        (CaptureFailure::Storage, "clip_persistence_failed"),
        (
            CaptureFailure::ForegroundChanged,
            "foreground_window_changed",
        ),
        (CaptureFailure::Unavailable, "unknown_capture_failure"),
    ];

    for (failure, expected) in cases {
        assert_eq!(capture_failure_code(failure), expected);
        assert!(!capture_failure_code(failure).contains("private selection"));
    }
    assert_eq!(
        capture_notification_body(Err(CaptureFailure::SyntheticCopyFailed), false),
        "Couldn't capture selection"
    );
    assert_eq!(
        capture_notification_body(Err(CaptureFailure::SyntheticCopyFailed), true),
        "Couldn't capture selection (synthetic_copy_failed)"
    );
    assert_eq!(
        capture_notification_body(
            Err(CaptureFailure::ClipboardFormatDuplicateFailed {
                format: 13,
                win32_error: 8,
            }),
            true,
        ),
        "Couldn't capture selection (clipboard_format_duplicate_failed; format=13; win32=8)"
    );
    let notification = capture_notification_body(
        Err(CaptureFailure::ClipboardEdpReadFailed { error_code: -1 }),
        true,
    );
    assert_eq!(
        notification,
        "Couldn't capture selection (clipboard_edp_read_failed; code=-1)"
    );
    assert!(!notification.contains("enterprise.example"));
}

struct FakeClipboard {
    changed: bool,
    text: Option<String>,
    restore_succeeds: bool,
    send_succeeds: bool,
    modifiers_released: bool,
    foreground_unchanged: bool,
    preserve_failure: Option<CaptureFailure>,
    restore_failure: Option<CaptureFailure>,
    read_count: usize,
    restore_count: usize,
    events: Vec<&'static str>,
}

impl ClipboardCaptureBackend for FakeClipboard {
    type Snapshot = String;

    fn foreground_metadata(&mut self) -> Result<SourceMetadata, CaptureFailure> {
        Ok(SourceMetadata {
            source_app: Some("Code".to_owned()),
            source_page_title: Some("main.rs - Visual Studio Code".to_owned()),
        })
    }

    fn clipboard_sequence(&mut self) -> Result<u32, CaptureFailure> {
        self.events.push("sequence");
        Ok(41)
    }

    fn preserve_clipboard(&mut self) -> Result<Self::Snapshot, CaptureFailure> {
        self.events.push("preserve");
        if let Some(failure) = self.preserve_failure {
            return Err(failure);
        }
        Ok("previous clipboard".to_owned())
    }

    fn wait_for_modifiers_released(&mut self) -> Result<(), CaptureFailure> {
        self.events.push("modifiers_released");
        self.modifiers_released
            .then_some(())
            .ok_or(CaptureFailure::HotkeyKeysNotReleased)
    }

    fn foreground_is_unchanged(&mut self) -> bool {
        self.events.push("foreground_check");
        self.foreground_unchanged
    }

    fn send_copy(&mut self) -> Result<(), CaptureFailure> {
        self.events.push("send_copy");
        self.send_succeeds
            .then_some(())
            .ok_or(CaptureFailure::SyntheticCopyFailed)
    }

    fn wait_for_clipboard_change(&mut self, before: u32) -> Result<bool, CaptureFailure> {
        assert_eq!(before, 41);
        Ok(self.changed)
    }

    fn read_text(&mut self) -> Result<Option<String>, CaptureFailure> {
        self.read_count += 1;
        Ok(self.text.clone())
    }

    fn restore_clipboard(&mut self, snapshot: Self::Snapshot) -> Result<(), CaptureFailure> {
        assert_eq!(snapshot, "previous clipboard");
        self.events.push("restore");
        self.restore_count += 1;
        if let Some(failure) = self.restore_failure {
            return Err(failure);
        }
        self.restore_succeeds
            .then_some(())
            .ok_or(CaptureFailure::ClipboardRestoration)
    }
}

fn fake_clipboard(changed: bool, text: Option<&str>) -> FakeClipboard {
    FakeClipboard {
        changed,
        text: text.map(str::to_owned),
        restore_succeeds: true,
        send_succeeds: true,
        modifiers_released: true,
        foreground_unchanged: true,
        preserve_failure: None,
        restore_failure: None,
        read_count: 0,
        restore_count: 0,
        events: Vec::new(),
    }
}

#[test]
fn changed_clipboard_is_read_exactly_and_restored_before_returning() {
    let mut clipboard = fake_clipboard(true, Some("  exact 😀\r\ntext  "));

    let captured = capture_clipboard_selection(&mut clipboard)
        .expect("changed text clipboard should be captured");

    assert_eq!(captured.content, "  exact 😀\r\ntext  ");
    assert_eq!(captured.source_app.as_deref(), Some("Code"));
    assert_eq!(clipboard.read_count, 1);
    assert_eq!(clipboard.restore_count, 1);
}

#[test]
fn unchanged_clipboard_is_not_read_and_still_runs_scoped_restoration() {
    let mut clipboard = fake_clipboard(false, Some("stale"));

    assert_eq!(
        capture_clipboard_selection(&mut clipboard),
        Err(CaptureFailure::ClipboardSequenceUnchanged)
    );
    assert_eq!(clipboard.read_count, 0);
    assert_eq!(clipboard.restore_count, 1);
}

#[test]
fn changed_empty_or_non_text_clipboard_is_restored_with_a_specific_failure() {
    for (text, expected) in [
        (None, CaptureFailure::ClipboardNoUnicodeText),
        (Some(""), CaptureFailure::ClipboardEmptyText),
        (Some(" \r\n\t "), CaptureFailure::ClipboardWhitespaceOnly),
    ] {
        let mut clipboard = fake_clipboard(true, text);
        assert_eq!(capture_clipboard_selection(&mut clipboard), Err(expected));
        assert_eq!(clipboard.restore_count, 1);
    }
}

#[test]
fn restoration_failure_prevents_capture_from_reaching_storage() {
    let mut clipboard = fake_clipboard(true, Some("selected"));
    clipboard.restore_succeeds = false;

    assert_eq!(
        capture_clipboard_selection(&mut clipboard),
        Err(CaptureFailure::ClipboardRestoration)
    );
    assert_eq!(clipboard.restore_count, 1);
}

#[test]
fn edp_snapshot_failure_aborts_before_synthetic_copy() {
    let mut clipboard = fake_clipboard(true, Some("selected"));
    clipboard.preserve_failure = Some(CaptureFailure::ClipboardEdpReadFailed { error_code: -1 });

    assert_eq!(
        capture_clipboard_selection(&mut clipboard),
        Err(CaptureFailure::ClipboardEdpReadFailed { error_code: -1 })
    );
    assert!(!clipboard.events.contains(&"send_copy"));
    assert_eq!(clipboard.restore_count, 0);
}

#[test]
fn edp_restore_failure_is_reported_as_a_restoration_failure() {
    let mut clipboard = fake_clipboard(true, Some("selected"));
    clipboard.restore_failure = Some(CaptureFailure::ClipboardEdpRestoreFailed { error_code: -2 });

    let failure = capture_clipboard_selection(&mut clipboard).unwrap_err();
    assert_eq!(
        failure,
        CaptureFailure::ClipboardEdpRestoreFailed { error_code: -2 }
    );
    assert_eq!(
        capture_feedback_message(Err(failure)),
        "Couldn't restore clipboard"
    );
}

#[test]
fn copy_injection_failure_restores_the_previous_clipboard() {
    let mut clipboard = fake_clipboard(true, Some("stale"));
    clipboard.send_succeeds = false;

    assert_eq!(
        capture_clipboard_selection(&mut clipboard),
        Err(CaptureFailure::SyntheticCopyFailed)
    );
    assert_eq!(clipboard.read_count, 0);
    assert_eq!(clipboard.restore_count, 1);
}

#[test]
fn modifier_release_is_confirmed_before_synthetic_copy() {
    let mut clipboard = fake_clipboard(true, Some("selected"));

    capture_clipboard_selection(&mut clipboard).unwrap();

    let release = clipboard
        .events
        .iter()
        .position(|event| *event == "modifiers_released")
        .unwrap();
    let preserve = clipboard
        .events
        .iter()
        .position(|event| *event == "preserve")
        .unwrap();
    let copy = clipboard
        .events
        .iter()
        .position(|event| *event == "send_copy")
        .unwrap();
    let sequence = clipboard
        .events
        .iter()
        .position(|event| *event == "sequence")
        .unwrap();
    assert!(release < preserve);
    assert!(preserve < sequence);
    assert!(sequence < copy);
}

#[test]
fn modifier_release_failure_leaves_the_clipboard_untouched() {
    let mut clipboard = fake_clipboard(true, Some("stale"));
    clipboard.modifiers_released = false;

    assert_eq!(
        capture_clipboard_selection(&mut clipboard),
        Err(CaptureFailure::HotkeyKeysNotReleased)
    );
    assert_eq!(clipboard.restore_count, 0);
    assert!(!clipboard.events.contains(&"preserve"));
    assert!(!clipboard.events.contains(&"send_copy"));
}

#[test]
fn foreground_change_aborts_before_copy_and_restores_the_snapshot() {
    let mut clipboard = fake_clipboard(true, Some("wrong window text"));
    clipboard.foreground_unchanged = false;

    assert_eq!(
        capture_clipboard_selection(&mut clipboard),
        Err(CaptureFailure::ForegroundChanged)
    );
    assert_eq!(clipboard.read_count, 0);
    assert_eq!(clipboard.restore_count, 1);
    assert!(!clipboard.events.contains(&"send_copy"));
}

#[test]
fn clip_save_failure_occurs_only_after_clipboard_restoration() {
    let mut clipboard = fake_clipboard(true, Some("selected"));
    let failing = RecordingSink {
        fail: true,
        ..RecordingSink::default()
    };

    let capture = capture_clipboard_selection(&mut clipboard);
    assert_eq!(clipboard.restore_count, 1);
    assert_eq!(
        persist_capture(capture, &failing),
        Err(CaptureFailure::Storage)
    );
    assert!(failing.inputs.lock().unwrap().is_empty());
}

struct StatefulClipboard {
    current: String,
    selected: Vec<String>,
    sequence: u32,
    restore_history: Vec<String>,
}

impl StatefulClipboard {
    fn replace_externally(&mut self, text: &str) {
        self.current = text.to_owned();
        self.sequence += 1;
    }
}

impl ClipboardCaptureBackend for StatefulClipboard {
    type Snapshot = String;

    fn foreground_metadata(&mut self) -> Result<SourceMetadata, CaptureFailure> {
        Ok(SourceMetadata {
            source_app: Some("Notepad".to_owned()),
            source_page_title: None,
        })
    }

    fn clipboard_sequence(&mut self) -> Result<u32, CaptureFailure> {
        Ok(self.sequence)
    }

    fn preserve_clipboard(&mut self) -> Result<Self::Snapshot, CaptureFailure> {
        Ok(self.current.clone())
    }

    fn wait_for_modifiers_released(&mut self) -> Result<(), CaptureFailure> {
        Ok(())
    }

    fn foreground_is_unchanged(&mut self) -> bool {
        true
    }

    fn send_copy(&mut self) -> Result<(), CaptureFailure> {
        let next = self.selected.remove(0);
        self.current = next;
        self.sequence += 1;
        Ok(())
    }

    fn wait_for_clipboard_change(&mut self, before: u32) -> Result<bool, CaptureFailure> {
        Ok(self.sequence != before)
    }

    fn read_text(&mut self) -> Result<Option<String>, CaptureFailure> {
        Ok(Some(self.current.clone()))
    }

    fn restore_clipboard(&mut self, snapshot: Self::Snapshot) -> Result<(), CaptureFailure> {
        self.current = snapshot.clone();
        self.sequence += 1;
        self.restore_history.push(snapshot);
        Ok(())
    }
}

#[test]
fn every_capture_uses_and_restores_a_fresh_external_clipboard_snapshot() {
    let mut clipboard = StatefulClipboard {
        current: "ORIGINAL_A".to_owned(),
        selected: vec![
            "CAPTURE_B".to_owned(),
            "CAPTURE_D".to_owned(),
            "CAPTURE_F".to_owned(),
            "CAPTURE_H".to_owned(),
            "CAPTURE_J".to_owned(),
        ],
        sequence: 1,
        restore_history: Vec::new(),
    };
    let sink = RecordingSink::default();

    for (external, expected_capture) in [
        ("ORIGINAL_A", "CAPTURE_B"),
        ("MANUAL_C", "CAPTURE_D"),
        ("MANUAL_E", "CAPTURE_F"),
        ("MANUAL_G", "CAPTURE_H"),
        ("MANUAL_I", "CAPTURE_J"),
    ] {
        clipboard.replace_externally(external);
        let capture = capture_clipboard_selection(&mut clipboard);
        persist_capture(capture, &sink).unwrap();
        assert_eq!(clipboard.current, external);
        assert_eq!(
            sink.inputs.lock().unwrap().last().unwrap().content,
            expected_capture
        );
    }

    assert_eq!(
        clipboard.restore_history,
        vec!["ORIGINAL_A", "MANUAL_C", "MANUAL_E", "MANUAL_G", "MANUAL_I"]
    );
    assert_eq!(sink.inputs.lock().unwrap().len(), 5);
}
