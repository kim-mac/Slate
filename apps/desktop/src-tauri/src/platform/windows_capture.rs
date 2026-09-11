use std::{
    ffi::c_void,
    mem::size_of,
    path::Path,
    slice, thread,
    time::{Duration, Instant},
};

use windows::{
    core::{s, w, HRESULT, PCWSTR, PWSTR},
    Win32::{
        Foundation::{
            CloseHandle, FreeLibrary, GetLastError, GlobalFree, SetLastError, ERROR_SUCCESS,
            HANDLE, HGLOBAL, HMODULE, HWND,
        },
        Graphics::Gdi::{DeleteEnhMetaFile, DeleteMetaFile, DeleteObject, HENHMETAFILE, HGDIOBJ},
        System::{
            DataExchange::{
                CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
                GetClipboardFormatNameW, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
                OpenClipboard, SetClipboardData, METAFILEPICT,
            },
            LibraryLoader::{GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32},
            Memory::{GetProcessHeap, GlobalLock, GlobalSize, GlobalUnlock, HeapFree, HEAP_FLAGS},
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
const EDP_CLIPBOARD_FORMAT_NAME: &str = "EnterpriseDataProtectionId";
const E_NOTIMPL_CODE: i32 = 0x8000_4001_u32 as i32;

type EdpGetEnterpriseIdForClipboard = unsafe extern "system" fn(*mut PWSTR) -> HRESULT;
type EdpSetEnterpriseIdForClipboard = unsafe extern "system" fn(PCWSTR) -> HRESULT;
type EdpClearClipboardMetaData = unsafe extern "system" fn() -> HRESULT;

struct EdpClipboardState {
    enterprise_id: Option<Vec<u16>>,
}

impl EdpClipboardState {
    fn present(enterprise_id: Vec<u16>) -> Self {
        Self {
            enterprise_id: Some(enterprise_id),
        }
    }

    fn absent() -> Self {
        Self {
            enterprise_id: None,
        }
    }

    fn enterprise_id(&self) -> Option<&[u16]> {
        self.enterprise_id.as_deref()
    }
}

struct ClipboardSnapshotParts<T> {
    formats: Vec<T>,
    edp: Option<EdpClipboardState>,
}

pub struct ClipboardSnapshot {
    formats: Vec<OwnedClipboardFormat>,
    edp: Option<EdpClipboardState>,
    sequence: u32,
}

struct WindowsEdpApi {
    module: HMODULE,
    get_enterprise_id: EdpGetEnterpriseIdForClipboard,
    set_enterprise_id: EdpSetEnterpriseIdForClipboard,
    clear_metadata: EdpClearClipboardMetaData,
}

impl WindowsEdpApi {
    fn load() -> Result<Self, CaptureFailure> {
        let module =
            unsafe { LoadLibraryExW(w!("edputil.dll"), None, LOAD_LIBRARY_SEARCH_SYSTEM32) }
                .map_err(|_| CaptureFailure::ClipboardEdpApiUnavailable)?;

        let Some(get_enterprise_id) =
            (unsafe { GetProcAddress(module, s!("EdpGetEnterpriseIdForClipboard")) })
        else {
            let _ = unsafe { FreeLibrary(module) };
            return Err(CaptureFailure::ClipboardEdpApiUnavailable);
        };
        let Some(set_enterprise_id) =
            (unsafe { GetProcAddress(module, s!("EdpSetEnterpriseIdForClipboard")) })
        else {
            let _ = unsafe { FreeLibrary(module) };
            return Err(CaptureFailure::ClipboardEdpApiUnavailable);
        };
        let Some(clear_metadata) =
            (unsafe { GetProcAddress(module, s!("EdpClearClipboardMetaData")) })
        else {
            let _ = unsafe { FreeLibrary(module) };
            return Err(CaptureFailure::ClipboardEdpApiUnavailable);
        };

        Ok(Self {
            module,
            get_enterprise_id: unsafe { std::mem::transmute(get_enterprise_id) },
            set_enterprise_id: unsafe { std::mem::transmute(set_enterprise_id) },
            clear_metadata: unsafe { std::mem::transmute(clear_metadata) },
        })
    }

    fn read_state(&self) -> Result<EdpClipboardState, CaptureFailure> {
        let heap = unsafe { GetProcessHeap() }.map_err(|error| {
            CaptureFailure::ClipboardEdpReadFailed {
                error_code: error.code().0,
            }
        })?;
        let mut enterprise_id = PWSTR::null();
        let result = unsafe { (self.get_enterprise_id)(&mut enterprise_id) };
        if result.is_err() {
            return Err(CaptureFailure::ClipboardEdpReadFailed {
                error_code: result.0,
            });
        }
        if enterprise_id.is_null() {
            return Ok(EdpClipboardState::absent());
        }

        let value = unsafe { enterprise_id.as_wide() }.to_vec();
        unsafe {
            HeapFree(
                heap,
                HEAP_FLAGS(0),
                Some(enterprise_id.as_ptr().cast::<c_void>()),
            )
        }
        .map_err(|error| CaptureFailure::ClipboardEdpReadFailed {
            error_code: error.code().0,
        })?;
        Ok(EdpClipboardState::present(value))
    }

    fn restore_state(&self, state: &EdpClipboardState) -> Result<(), CaptureFailure> {
        restore_edp_semantics(
            state,
            |enterprise_id| {
                let mut nul_terminated = Vec::with_capacity(enterprise_id.len() + 1);
                nul_terminated.extend_from_slice(enterprise_id);
                nul_terminated.push(0);
                edp_restore_result(unsafe {
                    (self.set_enterprise_id)(PCWSTR(nul_terminated.as_ptr()))
                })
            },
            || edp_restore_result(unsafe { (self.clear_metadata)() }),
        )
    }
}

impl Drop for WindowsEdpApi {
    fn drop(&mut self) {
        let _ = unsafe { FreeLibrary(self.module) };
    }
}

fn restore_edp_semantics(
    state: &EdpClipboardState,
    set: impl FnOnce(&[u16]) -> Result<(), CaptureFailure>,
    clear: impl FnOnce() -> Result<(), CaptureFailure>,
) -> Result<(), CaptureFailure> {
    if let Some(enterprise_id) = state.enterprise_id() {
        set(enterprise_id)
    } else {
        clear()
    }
}

fn edp_restore_result(result: HRESULT) -> Result<(), CaptureFailure> {
    if result.is_err() {
        Err(CaptureFailure::ClipboardEdpRestoreFailed {
            error_code: result.0,
        })
    } else {
        Ok(())
    }
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
        let parts = duplicate_open_clipboard_formats();
        let close_result = unsafe { CloseClipboard() };
        close_result.map_err(|_| CaptureFailure::ClipboardSnapshotFailed)?;
        let parts = parts?;
        Ok(ClipboardSnapshot {
            formats: parts.formats,
            edp: parts.edp,
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
        restore_snapshot_parts(
            snapshot.formats,
            snapshot.edp,
            |formats| restore_ordinary_clipboard(self.clipboard_owner, formats, &expected_formats),
            restore_edp_state,
        )
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

fn duplicate_open_clipboard_formats(
) -> Result<ClipboardSnapshotParts<OwnedClipboardFormat>, CaptureFailure> {
    let mut format_ids = Vec::new();
    let mut current = 0_u32;
    loop {
        unsafe { SetLastError(ERROR_SUCCESS) };
        let format = unsafe { EnumClipboardFormats(current) };
        if format == 0 {
            if unsafe { GetLastError() } == ERROR_SUCCESS {
                break;
            } else {
                return Err(CaptureFailure::Unavailable);
            }
        }
        format_ids.push(format);
        current = format;
    }

    collect_clipboard_snapshot_parts(
        format_ids,
        clipboard_format_name,
        duplicate_open_clipboard_format,
        || WindowsEdpApi::load()?.read_state(),
    )
}

fn collect_clipboard_snapshot_parts<T>(
    formats: impl IntoIterator<Item = u32>,
    mut registered_name: impl FnMut(u32) -> Option<String>,
    mut duplicate_ordinary: impl FnMut(u32) -> Result<T, CaptureFailure>,
    mut read_edp: impl FnMut() -> Result<EdpClipboardState, CaptureFailure>,
) -> Result<ClipboardSnapshotParts<T>, CaptureFailure> {
    let mut duplicated = Vec::new();
    let mut has_edp_marker = false;
    for format in formats {
        if registered_name(format).as_deref() == Some(EDP_CLIPBOARD_FORMAT_NAME) {
            has_edp_marker = true;
        } else {
            duplicated.push(duplicate_ordinary(format)?);
        }
    }
    let edp = if has_edp_marker {
        Some(read_edp()?)
    } else {
        None
    };
    Ok(ClipboardSnapshotParts {
        formats: duplicated,
        edp,
    })
}

fn clipboard_format_name(format: u32) -> Option<String> {
    let mut buffer = [0_u16; 256];
    let length = unsafe { GetClipboardFormatNameW(format, &mut buffer) };
    (length > 0).then(|| String::from_utf16_lossy(&buffer[..length as usize]))
}

fn duplicate_open_clipboard_format(format: u32) -> Result<OwnedClipboardFormat, CaptureFailure> {
    unsafe { SetLastError(ERROR_SUCCESS) };
    let source = unsafe { GetClipboardData(format) }.map_err(|_| {
        CaptureFailure::ClipboardFormatReadFailed {
            format,
            win32_error: unsafe { GetLastError() }.0,
        }
    })?;
    unsafe { SetLastError(ERROR_SUCCESS) };
    let duplicate = unsafe {
        OleDuplicateData(
            source,
            CLIPBOARD_FORMAT(format as u16),
            windows::Win32::System::Memory::GMEM_MOVEABLE,
        )
    };
    if duplicate.is_invalid() {
        return Err(CaptureFailure::ClipboardFormatDuplicateFailed {
            format,
            win32_error: unsafe { GetLastError() }.0,
        });
    }
    Ok(OwnedClipboardFormat {
        format,
        handle: duplicate,
    })
}

fn restore_snapshot_parts<T>(
    formats: Vec<T>,
    edp: Option<EdpClipboardState>,
    restore_ordinary: impl FnOnce(Vec<T>) -> Result<(), CaptureFailure>,
    restore_edp: impl FnOnce(&EdpClipboardState) -> Result<(), CaptureFailure>,
) -> Result<(), CaptureFailure> {
    restore_ordinary(formats)?;
    if let Some(edp) = edp.as_ref() {
        restore_edp(edp)?;
    }
    Ok(())
}

fn restore_ordinary_clipboard(
    owner: HWND,
    formats: Vec<OwnedClipboardFormat>,
    expected_formats: &[u32],
) -> Result<(), CaptureFailure> {
    open_clipboard(Some(owner))?;
    if unsafe { EmptyClipboard() }.is_err() {
        let _ = unsafe { CloseClipboard() };
        return Err(CaptureFailure::ClipboardRestoration);
    }
    let mut transfer_failed = false;
    for mut format in formats {
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

fn restore_edp_state(state: &EdpClipboardState) -> Result<(), CaptureFailure> {
    let api = WindowsEdpApi::load().map_err(|_| CaptureFailure::ClipboardEdpRestoreFailed {
        error_code: E_NOTIMPL_CODE,
    })?;
    api.restore_state(state)
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
    use std::cell::RefCell;

    use super::{
        all_input_events_sent, collect_clipboard_snapshot_parts, restore_edp_semantics,
        restore_snapshot_parts, sequence_changed_in_samples, trigger_keys_released,
        EdpClipboardState, EDP_CLIPBOARD_FORMAT_NAME,
    };
    use crate::desktop_capture::CaptureFailure;
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

    #[test]
    fn edp_marker_is_detected_by_registered_name_not_numeric_id() {
        for marker_id in [49_274, 60_001] {
            let duplicated = RefCell::new(Vec::new());
            let snapshot = collect_clipboard_snapshot_parts(
                [13, marker_id],
                |format| (format == marker_id).then(|| EDP_CLIPBOARD_FORMAT_NAME.to_owned()),
                |format| {
                    duplicated.borrow_mut().push(format);
                    Ok(format)
                },
                || Ok(EdpClipboardState::present(vec![1, 2, 3])),
            )
            .unwrap();

            assert_eq!(snapshot.formats, vec![13]);
            assert!(snapshot.edp.is_some());
            assert_eq!(*duplicated.borrow(), vec![13]);
        }
    }

    #[test]
    fn similarly_numbered_or_unreadable_ordinary_formats_remain_strict() {
        let failure = collect_clipboard_snapshot_parts(
            [49_274],
            |_| Some("SomeOtherRegisteredFormat".to_owned()),
            |format| {
                Err::<u32, _>(CaptureFailure::ClipboardFormatReadFailed {
                    format,
                    win32_error: 5,
                })
            },
            || panic!("EDP reader must not run for an ordinary format"),
        )
        .err()
        .expect("ordinary unreadable format must fail");

        assert_eq!(
            failure,
            CaptureFailure::ClipboardFormatReadFailed {
                format: 49_274,
                win32_error: 5,
            }
        );
    }

    #[test]
    fn edp_api_is_not_required_when_marker_is_absent() {
        let snapshot = collect_clipboard_snapshot_parts(
            [13],
            |_| None,
            Ok,
            || panic!("EDP API must not be loaded without the marker"),
        )
        .unwrap();

        assert_eq!(snapshot.formats, vec![13]);
        assert!(snapshot.edp.is_none());
    }

    #[test]
    fn marker_with_unavailable_or_failed_edp_api_aborts_snapshot() {
        for failure in [
            CaptureFailure::ClipboardEdpApiUnavailable,
            CaptureFailure::ClipboardEdpReadFailed { error_code: -1 },
        ] {
            let result = collect_clipboard_snapshot_parts(
                [60_123],
                |_| Some(EDP_CLIPBOARD_FORMAT_NAME.to_owned()),
                Ok,
                || Err(failure),
            );
            assert_eq!(result.err().expect("EDP failure must abort"), failure);
        }
    }

    #[test]
    fn edp_semantic_state_is_preserved_separately_from_ordinary_formats() {
        let snapshot = collect_clipboard_snapshot_parts(
            [13, 60_123],
            |format| (format == 60_123).then(|| EDP_CLIPBOARD_FORMAT_NAME.to_owned()),
            Ok,
            || Ok(EdpClipboardState::absent()),
        )
        .unwrap();

        assert_eq!(snapshot.formats, vec![13]);
        assert!(snapshot.edp.unwrap().enterprise_id().is_none());
    }

    #[test]
    fn edp_metadata_is_restored_after_ordinary_formats() {
        let events = RefCell::new(Vec::new());
        restore_snapshot_parts(
            vec![13],
            Some(EdpClipboardState::present(vec![7, 8, 9])),
            |_| {
                events.borrow_mut().push("ordinary");
                Ok(())
            },
            |_| {
                events.borrow_mut().push("edp");
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(*events.borrow(), vec!["ordinary", "edp"]);
    }

    #[test]
    fn edp_restore_failure_is_preserved() {
        let failure = restore_snapshot_parts(
            Vec::<u32>::new(),
            Some(EdpClipboardState::absent()),
            |_| Ok(()),
            |_| Err(CaptureFailure::ClipboardEdpRestoreFailed { error_code: -2 }),
        )
        .unwrap_err();

        assert_eq!(
            failure,
            CaptureFailure::ClipboardEdpRestoreFailed { error_code: -2 }
        );
    }

    #[test]
    fn present_edp_id_is_set_and_absent_edp_id_is_cleared() {
        let action = RefCell::new(None);
        restore_edp_semantics(
            &EdpClipboardState::present(vec![7, 8, 9]),
            |_| {
                *action.borrow_mut() = Some("set");
                Ok(())
            },
            || {
                *action.borrow_mut() = Some("clear");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*action.borrow(), Some("set"));

        restore_edp_semantics(
            &EdpClipboardState::absent(),
            |_| panic!("absent metadata must not call set"),
            || {
                *action.borrow_mut() = Some("clear");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*action.borrow(), Some("clear"));
    }
}
