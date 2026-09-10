use std::{
    mem::size_of,
    path::Path,
    slice, thread,
    time::{Duration, Instant},
};

use windows::{
    core::PWSTR,
    Win32::{
        Foundation::{
            CloseHandle, GetLastError, GlobalFree, SetLastError, ERROR_SUCCESS, HANDLE, HGLOBAL,
            HWND,
        },
        Graphics::Gdi::{DeleteEnhMetaFile, DeleteMetaFile, DeleteObject, HENHMETAFILE, HGDIOBJ},
        System::{
            DataExchange::{
                CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
                GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
                SetClipboardData, METAFILEPICT,
            },
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
            Ole::{
                OleDuplicateData, OleInitialize, OleUninitialize, CF_BITMAP, CF_DSPBITMAP,
                CF_DSPENHMETAFILE, CF_DSPMETAFILEPICT, CF_ENHMETAFILE, CF_METAFILEPICT, CF_PALETTE,
                CF_UNICODETEXT, CLIPBOARD_FORMAT,
            },
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::{
            Input::KeyboardAndMouse::{
                GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
                KEYEVENTF_KEYUP, VK_C, VK_CONTROL, VK_MENU, VK_SHIFT,
            },
            WindowsAndMessaging::{
                GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
            },
        },
    },
};

use crate::desktop_capture::{
    CaptureFailure, CapturedSelection, ClipboardCaptureBackend, SourceMetadata,
};

const CLIPBOARD_CHANGE_TIMEOUT: Duration = Duration::from_millis(750);
const MODIFIER_RELEASE_TIMEOUT: Duration = Duration::from_secs(2);
const POLL_INTERVAL: Duration = Duration::from_millis(10);

pub struct ClipboardSnapshot {
    formats: Vec<OwnedClipboardFormat>,
    sequence: u32,
}

struct OwnedClipboardFormat {
    format: u32,
    handle: HANDLE,
}

impl OwnedClipboardFormat {
    fn transfer_to_clipboard(&mut self) -> Result<(), CaptureFailure> {
        unsafe { SetClipboardData(self.format, Some(self.handle)) }
            .map_err(|_| CaptureFailure::ClipboardRestoration)?;
        self.handle = HANDLE::default();
        Ok(())
    }
}

impl Drop for OwnedClipboardFormat {
    fn drop(&mut self) {
        if self.handle.is_invalid() {
            return;
        }
        unsafe { free_clipboard_handle(self.format, self.handle) };
    }
}

pub struct WindowsClipboardCapture {
    foreground_window: HWND,
    clipboard_owner: HWND,
    ole_initialized: bool,
}

impl WindowsClipboardCapture {
    fn new(clipboard_owner: HWND) -> Result<Self, CaptureFailure> {
        unsafe { OleInitialize(None) }.map_err(|_| CaptureFailure::Unavailable)?;
        let foreground_window = unsafe { GetForegroundWindow() };
        if foreground_window.0.is_null() {
            unsafe { OleUninitialize() };
            return Err(CaptureFailure::Unavailable);
        }
        Ok(Self {
            foreground_window,
            clipboard_owner,
            ole_initialized: true,
        })
    }

    fn foreground_unchanged(&self) -> bool {
        (unsafe { GetForegroundWindow() }) == self.foreground_window
    }

    fn wait_for_modifiers_to_release(&self) -> Result<(), CaptureFailure> {
        let deadline = Instant::now() + MODIFIER_RELEASE_TIMEOUT;
        while Instant::now() < deadline {
            if trigger_keys_released(|key| unsafe { GetAsyncKeyState(key.0.into()) } < 0) {
                return Ok(());
            }
            thread::sleep(POLL_INTERVAL);
        }
        Err(CaptureFailure::HotkeyKeysNotReleased)
    }
}

impl Drop for WindowsClipboardCapture {
    fn drop(&mut self) {
        if self.ole_initialized {
            unsafe { OleUninitialize() };
        }
    }
}

impl ClipboardCaptureBackend for WindowsClipboardCapture {
    type Snapshot = ClipboardSnapshot;

    fn foreground_metadata(&mut self) -> Result<SourceMetadata, CaptureFailure> {
        Ok(SourceMetadata {
            source_app: process_name(self.foreground_window),
            source_page_title: window_title(self.foreground_window),
        })
    }

    fn clipboard_sequence(&mut self) -> Result<u32, CaptureFailure> {
        Ok(unsafe { GetClipboardSequenceNumber() })
    }

    fn preserve_clipboard(&mut self) -> Result<Self::Snapshot, CaptureFailure> {
        open_clipboard(None).map_err(|_| CaptureFailure::ClipboardSnapshotFailed)?;
        let formats = duplicate_open_clipboard_formats();
        let close_result = unsafe { CloseClipboard() };
        close_result.map_err(|_| CaptureFailure::ClipboardSnapshotFailed)?;
        Ok(ClipboardSnapshot {
            formats: formats.map_err(|_| CaptureFailure::ClipboardSnapshotFailed)?,
            sequence: unsafe { GetClipboardSequenceNumber() },
        })
    }

    fn wait_for_modifiers_released(&mut self) -> Result<(), CaptureFailure> {
        self.wait_for_modifiers_to_release()?;
        if !self.foreground_unchanged() {
            return Err(CaptureFailure::ForegroundChanged);
        }
        Ok(())
    }

    fn foreground_is_unchanged(&mut self) -> bool {
        self.foreground_unchanged()
    }

    fn send_copy(&mut self) -> Result<(), CaptureFailure> {
        let inputs = [
            keyboard_input(VK_CONTROL, false),
            keyboard_input(VK_C, false),
            keyboard_input(VK_C, true),
            keyboard_input(VK_CONTROL, true),
        ];
        let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
        if all_input_events_sent(sent, inputs.len() as u32) {
            Ok(())
        } else {
            Err(CaptureFailure::SyntheticCopyFailed)
        }
    }

    fn wait_for_clipboard_change(&mut self, before: u32) -> Result<bool, CaptureFailure> {
        let deadline = Instant::now() + CLIPBOARD_CHANGE_TIMEOUT;
        while Instant::now() < deadline {
            if !self.foreground_unchanged() {
                return Err(CaptureFailure::ForegroundChanged);
            }
            if sequence_changed_in_samples(before, [unsafe { GetClipboardSequenceNumber() }]) {
                return Ok(true);
            }
            thread::sleep(POLL_INTERVAL);
        }
        Ok(false)
    }

    fn read_text(&mut self) -> Result<Option<String>, CaptureFailure> {
        open_clipboard(None).map_err(|_| CaptureFailure::ClipboardNoUnicodeText)?;
        let result = read_open_clipboard_text();
        let close_result = unsafe { CloseClipboard() };
        close_result.map_err(|_| CaptureFailure::ClipboardNoUnicodeText)?;
        result
    }

    fn restore_clipboard(&mut self, snapshot: Self::Snapshot) -> Result<(), CaptureFailure> {
        if unsafe { GetClipboardSequenceNumber() } == snapshot.sequence {
            return Ok(());
        }

        let expected_formats = snapshot
            .formats
            .iter()
            .map(|format| format.format)
            .collect::<Vec<_>>();
        open_clipboard(Some(self.clipboard_owner))?;
        if unsafe { EmptyClipboard() }.is_err() {
            let _ = unsafe { CloseClipboard() };
            return Err(CaptureFailure::ClipboardRestoration);
        }
        let mut transfer_failed = false;
        for mut format in snapshot.formats {
            if format.transfer_to_clipboard().is_err() {
                transfer_failed = true;
            }
        }
        let close_failed = unsafe { CloseClipboard() }.is_err();
        if transfer_failed || close_failed {
            return Err(CaptureFailure::ClipboardRestoration);
        }
        if expected_formats
            .iter()
            .any(|format| unsafe { IsClipboardFormatAvailable(*format) }.is_err())
        {
            return Err(CaptureFailure::ClipboardRestoration);
        }
        Ok(())
    }
}

pub fn capture_selected_text(app: &tauri::AppHandle) -> Result<CapturedSelection, CaptureFailure> {
    use tauri::Manager;

    let clipboard_owner = app
        .get_webview_window("main")
        .ok_or(CaptureFailure::Unavailable)?
        .hwnd()
        .map_err(|_| CaptureFailure::Unavailable)?;
    let mut backend = WindowsClipboardCapture::new(clipboard_owner)?;
    crate::desktop_capture::capture_clipboard_selection(&mut backend)
}

fn open_clipboard(owner: Option<HWND>) -> Result<(), CaptureFailure> {
    for _ in 0..10 {
        if unsafe { OpenClipboard(owner) }.is_ok() {
            return Ok(());
        }
        thread::sleep(POLL_INTERVAL);
    }
    Err(CaptureFailure::Unavailable)
}

fn duplicate_open_clipboard_formats() -> Result<Vec<OwnedClipboardFormat>, CaptureFailure> {
    let mut formats = Vec::new();
    let mut current = 0_u32;
    loop {
        unsafe { SetLastError(ERROR_SUCCESS) };
        let format = unsafe { EnumClipboardFormats(current) };
        if format == 0 {
            return if unsafe { GetLastError() } == ERROR_SUCCESS {
                Ok(formats)
            } else {
                Err(CaptureFailure::Unavailable)
            };
        }
        let source =
            unsafe { GetClipboardData(format) }.map_err(|_| CaptureFailure::Unavailable)?;
        let duplicate = unsafe {
            OleDuplicateData(
                source,
                CLIPBOARD_FORMAT(format as u16),
                windows::Win32::System::Memory::GMEM_MOVEABLE,
            )
        };
        if duplicate.is_invalid() {
            return Err(CaptureFailure::Unavailable);
        }
        formats.push(OwnedClipboardFormat {
            format,
            handle: duplicate,
        });
        current = format;
    }
}

fn trigger_keys_released(
    mut is_down: impl FnMut(windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY) -> bool,
) -> bool {
    [VK_CONTROL, VK_MENU, VK_SHIFT, VK_C]
        .into_iter()
        .all(|key| !is_down(key))
}

fn all_input_events_sent(sent: u32, expected: u32) -> bool {
    sent == expected
}

fn sequence_changed_in_samples(before: u32, samples: impl IntoIterator<Item = u32>) -> bool {
    samples.into_iter().any(|current| current != before)
}

fn read_open_clipboard_text() -> Result<Option<String>, CaptureFailure> {
    let Ok(handle) = (unsafe { GetClipboardData(CF_UNICODETEXT.0.into()) }) else {
        return Ok(None);
    };
    let global = HGLOBAL(handle.0);
    let pointer = unsafe { GlobalLock(global) };
    if pointer.is_null() {
        return Err(CaptureFailure::Unavailable);
    }
    let length = unsafe { GlobalSize(global) } / size_of::<u16>();
    let units = unsafe { slice::from_raw_parts(pointer.cast::<u16>(), length) };
    let terminator = units
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(units.len());
    let text = String::from_utf16(&units[..terminator]).map_err(|_| CaptureFailure::Unavailable);
    let _ = unsafe { GlobalUnlock(global) };
    text.map(Some)
}

fn keyboard_input(
    key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
    key_up: bool,
) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                dwFlags: if key_up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                ..Default::default()
            },
        },
    }
}

fn window_title(window: HWND) -> Option<String> {
    let length = unsafe { GetWindowTextLengthW(window) };
    if length <= 0 {
        return None;
    }
    let mut buffer = vec![0_u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(window, &mut buffer) };
    (copied > 0).then(|| String::from_utf16_lossy(&buffer[..copied as usize]))
}

fn process_name(window: HWND) -> Option<String> {
    let mut process_id = 0_u32;
    unsafe { GetWindowThreadProcessId(window, Some(&mut process_id)) };
    if process_id == 0 {
        return None;
    }
    let process =
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }.ok()?;
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
    };
    let _ = unsafe { CloseHandle(process) };
    result.ok()?;
    let executable = String::from_utf16_lossy(&buffer[..length as usize]);
    Path::new(&executable)
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

unsafe fn free_clipboard_handle(format: u32, handle: HANDLE) {
    let format = CLIPBOARD_FORMAT(format as u16);
    if matches!(format, CF_BITMAP | CF_DSPBITMAP | CF_PALETTE) {
        let _ = unsafe { DeleteObject(HGDIOBJ(handle.0)) };
    } else if matches!(format, CF_ENHMETAFILE | CF_DSPENHMETAFILE) {
        let _ = unsafe { DeleteEnhMetaFile(Some(HENHMETAFILE(handle.0))) };
    } else if matches!(format, CF_METAFILEPICT | CF_DSPMETAFILEPICT) {
        let global = HGLOBAL(handle.0);
        let pointer = unsafe { GlobalLock(global) }.cast::<METAFILEPICT>();
        if !pointer.is_null() {
            let metafile = unsafe { (*pointer).hMF };
            let _ = unsafe { GlobalUnlock(global) };
            let _ = unsafe { DeleteMetaFile(metafile) };
        }
        let _ = unsafe { GlobalFree(Some(global)) };
    } else {
        let _ = unsafe { GlobalFree(Some(HGLOBAL(handle.0))) };
    }
}

#[cfg(test)]
mod tests {
    use super::{all_input_events_sent, sequence_changed_in_samples, trigger_keys_released};
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_C, VK_CONTROL, VK_MENU, VK_SHIFT};

    #[test]
    fn every_physical_hotkey_key_must_be_released() {
        let keys = [VK_CONTROL, VK_MENU, VK_SHIFT, VK_C];
        assert!(trigger_keys_released(|_| false));
        for down in keys {
            assert!(!trigger_keys_released(|key| key == down));
        }
    }

    #[test]
    fn partial_send_input_is_rejected() {
        assert!(all_input_events_sent(4, 4));
        for sent in 0..4 {
            assert!(!all_input_events_sent(sent, 4));
        }
    }

    #[test]
    fn delayed_sequence_change_is_detected_but_unchanged_samples_are_rejected() {
        assert!(sequence_changed_in_samples(41, [41, 41, 42]));
        assert!(!sequence_changed_in_samples(41, [41, 41, 41]));
    }
}
