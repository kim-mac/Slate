//! Installer-only checks. No protocol output, database access, or process termination.
use super::gate::{self, profile};
use std::path::{Path, PathBuf};
use windows::Win32::System::RestartManager::RM_PROCESS_INFO;
pub const DESKTOP: &str = "ai-clip-memory-desktop.exe";
pub const NATIVE_HOST: &str = "ai-clip-memory-native-host.exe";
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(i32)]
pub enum MaintenanceResult {
    Ready = 0,
    Desktop = 10,
    NativeHost = 11,
    Authority = 20,
    Target = 21,
    Start = 30,
    Register = 31,
    List = 32,
    End = 33,
    Bounds = 34,
    Identity = 35,
    OtherProcess = 36,
    Arguments = 40,
}
impl MaintenanceResult {
    pub fn exit_code(self) -> i32 {
        self as i32
    }
}
#[derive(Debug)]
pub enum MaintenanceRequest {
    Validate {
        pid: u32,
        handle: u32,
    },
    Check {
        pid: u32,
        handle: u32,
        directory: PathBuf,
    },
}
/// Parse before resolving production authority, so malformed requests cannot
/// touch the real profile. Numeric inputs are decimal digits only.
pub fn parse_request(
    arguments: &[std::ffi::OsString],
) -> Result<MaintenanceRequest, MaintenanceResult> {
    let invalid = || MaintenanceResult::Arguments;
    let mode = arguments
        .first()
        .and_then(|arg| arg.to_str())
        .ok_or_else(invalid)?;
    if !matches!(
        (mode, arguments.len()),
        ("--validate-maintenance-handle", 3) | ("--check-maintenance-processes", 4)
    ) {
        return Err(invalid());
    }
    let number = |value: &std::ffi::OsString| {
        let text = value.to_str().ok_or_else(invalid)?;
        if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(invalid());
        }
        text.parse::<u32>()
            .ok()
            .filter(|value| *value != 0 && *value != u32::MAX)
            .ok_or_else(invalid)
    };
    let pid = number(&arguments[1])?;
    let handle = number(&arguments[2])?;
    if mode == "--validate-maintenance-handle" {
        Ok(MaintenanceRequest::Validate { pid, handle })
    } else {
        if arguments[3].is_empty() {
            return Err(invalid());
        }
        Ok(MaintenanceRequest::Check {
            pid,
            handle,
            directory: PathBuf::from(&arguments[3]),
        })
    }
}
impl MaintenanceRequest {
    pub fn execute(&self, gate: &gate::InstallationGate) -> MaintenanceResult {
        match self {
            Self::Validate { pid, handle } => validate_maintenance_handle(gate, *pid, *handle),
            Self::Check {
                pid,
                handle,
                directory,
            } => check_maintenance_processes(gate, *pid, *handle, directory),
        }
    }
}
/// Validate the original retained receiver handle. Never exports a replacement,
/// changes a byte lock, or closes a receiver handle.
pub fn validate_maintenance_handle(
    gate: &gate::InstallationGate,
    pid: u32,
    handle: u32,
) -> MaintenanceResult {
    match gate.validated_maintenance_handle(pid, handle) {
        Ok(_) => MaintenanceResult::Ready,
        Err(_) => MaintenanceResult::Authority,
    }
}
/// Both authority and target directory pins live through the complete RM and
/// process identity check. The caller continues to own its retained gate handle.
pub fn check_maintenance_processes(
    gate: &gate::InstallationGate,
    pid: u32,
    handle: u32,
    directory: &Path,
) -> MaintenanceResult {
    let _authority = match gate.validated_maintenance_handle(pid, handle) {
        Ok(file) => file,
        Err(_) => return MaintenanceResult::Authority,
    };
    let target = match InstallationTarget::open(directory) {
        Ok(target) => target,
        Err(_) => return MaintenanceResult::Target,
    };
    let paths = [target.root.join(DESKTOP), target.root.join(NATIVE_HOST)];
    let records = match resource_records(&mut WindowsRm, &paths) {
        Ok(records) => records,
        Err(error) => return error,
    };
    // Finish every identity check; ambiguity/foreign users take precedence over a
    // friendly application-specific prompt.
    let mut result = MaintenanceResult::Ready;
    for record in &records {
        let current = classify(
            record,
            process_identity(&mut WindowsProcess, record.Process.dwProcessId),
            &target.root,
        );
        result = merge_result(result, current);
    }
    result
}
fn merge_result(a: MaintenanceResult, b: MaintenanceResult) -> MaintenanceResult {
    fn priority(result: MaintenanceResult) -> u8 {
        match result {
            MaintenanceResult::Identity => 4,
            MaintenanceResult::OtherProcess => 3,
            MaintenanceResult::NativeHost => 2,
            MaintenanceResult::Desktop => 1,
            _ => 0,
        }
    }
    if priority(b) > priority(a) {
        b
    } else {
        a
    }
}
enum ProcessIdentity {
    Gone,
    Unknown,
    Exited {
        creation: u64,
    },
    Live {
        creation: u64,
        image: PathBuf,
        same_user: bool,
    },
}
fn classify(record: &RM_PROCESS_INFO, actual: ProcessIdentity, root: &Path) -> MaintenanceResult {
    let expected = filetime(record.Process.ProcessStartTime);
    match actual {
        ProcessIdentity::Gone => MaintenanceResult::Ready,
        ProcessIdentity::Exited { creation } if creation == expected => MaintenanceResult::Ready,
        ProcessIdentity::Live {
            creation,
            image,
            same_user,
        } if creation == expected => {
            if same_user && same_path(&image, &root.join(DESKTOP)) {
                MaintenanceResult::Desktop
            } else if same_user && same_path(&image, &root.join(NATIVE_HOST)) {
                MaintenanceResult::NativeHost
            } else {
                MaintenanceResult::OtherProcess
            }
        }
        _ => MaintenanceResult::Identity,
    }
}
fn same_path(a: &Path, b: &Path) -> bool {
    a.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
}
fn filetime(time: windows::Win32::Foundation::FILETIME) -> u64 {
    (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
}

trait RmApi {
    fn start(&mut self, session: &mut u32) -> u32;
    fn register(&mut self, session: u32, paths: &[PathBuf]) -> u32;
    fn list(
        &mut self,
        session: u32,
        buffer: &mut [RM_PROCESS_INFO],
        needed: &mut u32,
        count: &mut u32,
    ) -> u32;
    fn end(&mut self, session: u32) -> u32;
}
struct Session<'a, A: RmApi> {
    api: &'a mut A,
    handle: u32,
    ended: bool,
}
impl<A: RmApi> Drop for Session<'_, A> {
    fn drop(&mut self) {
        if !self.ended {
            let _ = self.api.end(self.handle);
        }
    }
}
fn resource_records(
    api: &mut impl RmApi,
    paths: &[PathBuf],
) -> Result<Vec<RM_PROCESS_INFO>, MaintenanceResult> {
    let mut handle = 0;
    if api.start(&mut handle) != 0 {
        return Err(MaintenanceResult::Start);
    }
    let mut session = Session {
        api,
        handle,
        ended: false,
    };
    let result = (|| {
        if session.api.register(handle, paths) != 0 {
            return Err(MaintenanceResult::Register);
        }
        let mut buffer = Vec::new();
        let mut growth = 0;
        loop {
            let mut count = buffer.len() as u32;
            let mut needed = 0;
            let status = session
                .api
                .list(handle, &mut buffer, &mut needed, &mut count);
            if status == 0 {
                if count as usize > buffer.len() || needed as usize > buffer.len() {
                    return Err(MaintenanceResult::Bounds);
                }
                buffer.truncate(count as usize);
                return Ok(buffer);
            }
            if status != 234 {
                return Err(MaintenanceResult::List);
            }
            if growth >= 4 || needed == 0 || needed > 1024 || needed as usize <= buffer.len() {
                return Err(MaintenanceResult::Bounds);
            }
            buffer.resize(needed as usize, RM_PROCESS_INFO::default());
            growth += 1;
        }
    })();
    let ended = session.api.end(handle);
    session.ended = true;
    if ended != 0 {
        Err(MaintenanceResult::End)
    } else {
        result
    }
}
struct WindowsRm;
impl RmApi for WindowsRm {
    fn start(&mut self, session: &mut u32) -> u32 {
        let mut key = [0u16; 33];
        unsafe {
            windows::Win32::System::RestartManager::RmStartSession(
                session,
                None,
                windows::core::PWSTR(key.as_mut_ptr()),
            )
        }
        .0
    }
    fn register(&mut self, session: u32, paths: &[PathBuf]) -> u32 {
        use std::os::windows::ffi::OsStrExt;
        let names: Vec<Vec<u16>> = paths
            .iter()
            .map(|path| path.as_os_str().encode_wide().chain(Some(0)).collect())
            .collect();
        let pointers: Vec<_> = names
            .iter()
            .map(|name| windows::core::PCWSTR(name.as_ptr()))
            .collect();
        unsafe {
            windows::Win32::System::RestartManager::RmRegisterResources(
                session,
                Some(&pointers),
                None,
                None,
            )
        }
        .0
    }
    fn list(
        &mut self,
        session: u32,
        buffer: &mut [RM_PROCESS_INFO],
        needed: &mut u32,
        count: &mut u32,
    ) -> u32 {
        let mut reasons = 0;
        let pointer = if buffer.is_empty() {
            None
        } else {
            Some(buffer.as_mut_ptr())
        };
        unsafe {
            windows::Win32::System::RestartManager::RmGetList(
                session,
                needed,
                count,
                pointer,
                &mut reasons,
            )
        }
        .0
    }
    fn end(&mut self, session: u32) -> u32 {
        unsafe { windows::Win32::System::RestartManager::RmEndSession(session) }.0
    }
}

trait ProcessApi {
    type Handle;
    fn open(&mut self, pid: u32) -> Result<Option<Self::Handle>, ()>;
    fn creation(&mut self, handle: &Self::Handle) -> Result<u64, ()>;
    fn exited(&mut self, handle: &Self::Handle) -> Result<bool, ()>;
    fn image(&mut self, handle: &Self::Handle) -> Result<PathBuf, ()>;
    fn same_user(&mut self, handle: &Self::Handle) -> Result<bool, ()>;
}
fn process_identity(api: &mut impl ProcessApi, pid: u32) -> ProcessIdentity {
    let result = (|| {
        if pid == 0 {
            return Err(());
        }
        let Some(handle) = api.open(pid)? else {
            return Ok(ProcessIdentity::Gone);
        };
        let creation = api.creation(&handle)?;
        if creation == 0 {
            return Err(());
        }
        if api.exited(&handle)? {
            return Ok(ProcessIdentity::Exited { creation });
        }
        let image = api.image(&handle)?;
        let same_user = api.same_user(&handle)?;
        Ok(ProcessIdentity::Live {
            creation,
            image,
            same_user,
        })
    })();
    result.unwrap_or(ProcessIdentity::Unknown)
}
struct ProcessHandle(windows::Win32::Foundation::HANDLE);
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
struct WindowsProcess;
impl ProcessApi for WindowsProcess {
    type Handle = ProcessHandle;
    fn open(&mut self, pid: u32) -> Result<Option<ProcessHandle>, ()> {
        use windows::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
        };
        match unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                false,
                pid,
            )
        } {
            Ok(handle) => Ok(Some(ProcessHandle(handle))),
            // ERROR_INVALID_PARAMETER is the documented nonexistent PID result.
            Err(error) if error.code().0 as u32 & 0xffff == 87 => Ok(None),
            Err(_) => Err(()),
        }
    }
    fn creation(&mut self, handle: &ProcessHandle) -> Result<u64, ()> {
        let mut created = Default::default();
        let mut exited = Default::default();
        let mut kernel = Default::default();
        let mut user = Default::default();
        unsafe {
            windows::Win32::System::Threading::GetProcessTimes(
                handle.0,
                &mut created,
                &mut exited,
                &mut kernel,
                &mut user,
            )
        }
        .map_err(|_| ())?;
        Ok(filetime(created))
    }
    fn exited(&mut self, handle: &ProcessHandle) -> Result<bool, ()> {
        use windows::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
        match unsafe { windows::Win32::System::Threading::WaitForSingleObject(handle.0, 0) } {
            WAIT_OBJECT_0 => Ok(true),
            WAIT_TIMEOUT => Ok(false),
            _ => Err(()),
        }
    }
    fn image(&mut self, handle: &ProcessHandle) -> Result<PathBuf, ()> {
        use windows::{
            core::PWSTR,
            Win32::System::Threading::{QueryFullProcessImageNameW, PROCESS_NAME_WIN32},
        };
        let mut name = vec![0u16; 32768];
        let mut length = name.len() as u32;
        unsafe {
            QueryFullProcessImageNameW(
                handle.0,
                PROCESS_NAME_WIN32,
                PWSTR(name.as_mut_ptr()),
                &mut length,
            )
        }
        .map_err(|_| ())?;
        if length == 0 || length as usize >= name.len() {
            return Err(());
        }
        Ok(PathBuf::from(
            String::from_utf16(&name[..length as usize]).map_err(|_| ())?,
        ))
    }
    fn same_user(&mut self, handle: &ProcessHandle) -> Result<bool, ()> {
        Ok(profile::User::current()
            .map_err(|_| ())?
            .matches(&profile::User::for_process(handle.0).map_err(|_| ())?))
    }
}

struct InstallationTarget {
    root: PathBuf,
    _pins: Vec<std::fs::File>,
}
impl InstallationTarget {
    fn open(path: &Path) -> std::io::Result<Self> {
        let denied = || std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        let text = path.to_str().ok_or_else(denied)?;
        let text = text.strip_prefix(r"\\?\").unwrap_or(text);
        if text.len() > 32700
            || text.as_bytes().get(1) != Some(&b':')
            || !text.as_bytes()[0].is_ascii_alphabetic()
            || !text[2..].starts_with(['\\', '/'])
        {
            return Err(denied());
        }
        for name in text[3..].split(['\\', '/']) {
            let base = name.split('.').next().unwrap_or("").to_ascii_uppercase();
            if name.is_empty()
                || name == "."
                || name == ".."
                || name.ends_with(['.', ' '])
                || name.chars().any(|c| c < ' ' || r#"<>:"|?*"#.contains(c))
                || matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                || (base.len() == 4
                    && (base.starts_with("COM") || base.starts_with("LPT"))
                    && matches!(base.as_bytes()[3], b'1'..=b'9'))
            {
                return Err(denied());
            }
        }
        let root = PathBuf::from(text.replace('/', r"\"));
        let mut existing = root.as_path();
        loop {
            match std::fs::symlink_metadata(existing) {
                Ok(_) => break,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    existing = existing.parent().ok_or_else(denied)?
                }
                Err(error) => return Err(error),
            }
        }
        let pins = gate::pin_directories(existing)?;
        let last = pins.last().ok_or_else(denied)?;
        let canonical = std::fs::canonicalize(existing)?;
        let expected = PathBuf::from(format!(r"\\?\{}", existing.display()));
        if !same_path(&canonical, &expected) {
            return Err(denied());
        }
        gate::validate_final_path(last, &canonical)?;
        gate::validate_filesystem(last)?;
        profile::User::current()?.validate_owned_directory(last)?;
        Ok(Self { root, _pins: pins })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::RestartManager::{RmStatusStopped, RM_PROCESS_INFO};

    #[test]
    fn stopped_status_does_not_authorize_a_live_process() {
        let record = RM_PROCESS_INFO {
            AppStatus: RmStatusStopped.0 as u32,
            ..Default::default()
        };
        let live = ProcessIdentity::Live {
            creation: 17,
            image: PathBuf::from(r"C:\test\ai-clip-memory-desktop.exe"),
            same_user: true,
        };
        assert_eq!(
            classify(&record, live, Path::new(r"C:\test")),
            MaintenanceResult::Identity
        );
    }

    #[test]
    fn creation_mismatch_and_inaccessible_identity_fail_closed() {
        let record = record(17);
        assert_eq!(
            classify(&record, ProcessIdentity::Unknown, Path::new(r"C:\test")),
            MaintenanceResult::Identity
        );
        assert_eq!(
            classify(
                &record,
                ProcessIdentity::Exited { creation: 18 },
                Path::new(r"C:\test")
            ),
            MaintenanceResult::Identity
        );
    }

    #[test]
    fn verified_live_images_and_exited_records_have_exact_results() {
        let mut record = record(17);
        record.AppStatus = RmStatusStopped.0 as u32;
        for (name, expected) in [
            (DESKTOP, MaintenanceResult::Desktop),
            (NATIVE_HOST, MaintenanceResult::NativeHost),
            ("other.exe", MaintenanceResult::OtherProcess),
        ] {
            let live = ProcessIdentity::Live {
                creation: 17,
                image: Path::new(r"C:\test").join(name),
                same_user: true,
            };
            assert_eq!(classify(&record, live, Path::new(r"C:\test")), expected);
        }
        assert_eq!(
            classify(
                &record,
                ProcessIdentity::Exited { creation: 17 },
                Path::new(r"C:\test")
            ),
            MaintenanceResult::Ready
        );
        assert_eq!(
            classify(&record, ProcessIdentity::Gone, Path::new(r"C:\test")),
            MaintenanceResult::Ready
        );
        let foreign = ProcessIdentity::Live {
            creation: 17,
            image: Path::new(r"C:\test").join(DESKTOP),
            same_user: false,
        };
        assert_eq!(
            classify(&record, foreign, Path::new(r"C:\test")),
            MaintenanceResult::OtherProcess
        );
    }

    fn record(creation: u32) -> RM_PROCESS_INFO {
        let mut record = RM_PROCESS_INFO::default();
        record.Process.dwProcessId = 123;
        record.Process.ProcessStartTime.dwLowDateTime = creation;
        record
    }

    #[derive(Default)]
    struct FakeRm {
        start: u32,
        register: u32,
        end: u32,
        ended: u32,
        replies: std::collections::VecDeque<(u32, u32, u32)>,
        capacities: Vec<usize>,
    }
    impl RmApi for FakeRm {
        fn start(&mut self, session: &mut u32) -> u32 {
            *session = 42;
            self.start
        }
        fn register(&mut self, _: u32, _: &[PathBuf]) -> u32 {
            self.register
        }
        fn list(
            &mut self,
            _: u32,
            buffer: &mut [RM_PROCESS_INFO],
            needed: &mut u32,
            count: &mut u32,
        ) -> u32 {
            self.capacities.push(buffer.len());
            let (status, n, c) = self.replies.pop_front().unwrap_or((0, 0, 0));
            *needed = n;
            *count = c;
            for value in buffer {
                *value = record(17);
            }
            status
        }
        fn end(&mut self, _: u32) -> u32 {
            self.ended += 1;
            self.end
        }
    }
    #[test]
    fn restart_manager_retrieves_actual_records_and_ends_once() {
        let mut api = FakeRm {
            replies: [(234, 1, 0), (0, 1, 1)].into(),
            ..Default::default()
        };
        let records = resource_records(&mut api, &[]).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].Process.dwProcessId, 123);
        assert_eq!(api.capacities, [0, 1]);
        assert_eq!(api.ended, 1);
    }
    #[test]
    fn restart_manager_errors_fail_closed_and_always_end_started_session() {
        for (api, expected, ends) in [
            (
                FakeRm {
                    start: 5,
                    ..Default::default()
                },
                MaintenanceResult::Start,
                0,
            ),
            (
                FakeRm {
                    register: 5,
                    ..Default::default()
                },
                MaintenanceResult::Register,
                1,
            ),
            (
                FakeRm {
                    replies: [(5, 0, 0)].into(),
                    ..Default::default()
                },
                MaintenanceResult::List,
                1,
            ),
            (
                FakeRm {
                    end: 5,
                    ..Default::default()
                },
                MaintenanceResult::End,
                1,
            ),
            (
                FakeRm {
                    replies: [(234, 1025, 0)].into(),
                    ..Default::default()
                },
                MaintenanceResult::Bounds,
                1,
            ),
            (
                FakeRm {
                    replies: [(0, 0, 1)].into(),
                    ..Default::default()
                },
                MaintenanceResult::Bounds,
                1,
            ),
            (
                FakeRm {
                    replies: [
                        (234, 1, 0),
                        (234, 2, 0),
                        (234, 3, 0),
                        (234, 4, 0),
                        (234, 5, 0),
                    ]
                    .into(),
                    ..Default::default()
                },
                MaintenanceResult::Bounds,
                1,
            ),
        ] {
            let mut api = api;
            assert_eq!(resource_records(&mut api, &[]).unwrap_err(), expected);
            assert_eq!(api.ended, ends);
        }
    }
    struct FakeProcess {
        open: Result<Option<()>, ()>,
        creation: Result<u64, ()>,
        wait: Result<bool, ()>,
        image: Result<PathBuf, ()>,
        same_user: Result<bool, ()>,
        calls: Vec<&'static str>,
    }
    impl Default for FakeProcess {
        fn default() -> Self {
            Self {
                open: Ok(Some(())),
                creation: Ok(17),
                wait: Ok(false),
                image: Ok(Path::new(r"C:\test").join(DESKTOP)),
                same_user: Ok(true),
                calls: Vec::new(),
            }
        }
    }
    impl ProcessApi for FakeProcess {
        type Handle = ();
        fn open(&mut self, _: u32) -> Result<Option<()>, ()> {
            self.calls.push("open");
            self.open
        }
        fn creation(&mut self, _: &()) -> Result<u64, ()> {
            self.calls.push("creation");
            self.creation
        }
        fn exited(&mut self, _: &()) -> Result<bool, ()> {
            self.calls.push("wait");
            self.wait
        }
        fn image(&mut self, _: &()) -> Result<PathBuf, ()> {
            self.calls.push("image");
            self.image.clone()
        }
        fn same_user(&mut self, _: &()) -> Result<bool, ()> {
            self.calls.push("sid");
            self.same_user
        }
    }
    #[test]
    fn process_identity_source_queries_creation_and_wait_before_image_and_sid() {
        let mut api = FakeProcess::default();
        assert_eq!(
            classify(
                &record(17),
                process_identity(&mut api, 123),
                Path::new(r"C:\test")
            ),
            MaintenanceResult::Desktop
        );
        assert_eq!(api.calls, ["open", "creation", "wait", "image", "sid"]);
        for mut api in [
            FakeProcess {
                open: Err(()),
                ..Default::default()
            },
            FakeProcess {
                creation: Err(()),
                ..Default::default()
            },
            FakeProcess {
                wait: Err(()),
                ..Default::default()
            },
            FakeProcess {
                image: Err(()),
                ..Default::default()
            },
            FakeProcess {
                same_user: Err(()),
                ..Default::default()
            },
            FakeProcess {
                creation: Ok(18),
                wait: Ok(true),
                ..Default::default()
            },
        ] {
            assert_eq!(
                classify(
                    &record(17),
                    process_identity(&mut api, 123),
                    Path::new(r"C:\test")
                ),
                MaintenanceResult::Identity
            );
        }
        let mut exited = FakeProcess {
            wait: Ok(true),
            image: Err(()),
            ..Default::default()
        };
        assert_eq!(
            classify(
                &record(17),
                process_identity(&mut exited, 123),
                Path::new(r"C:\test")
            ),
            MaintenanceResult::Ready
        );
        assert_eq!(exited.calls, ["open", "creation", "wait"]);
    }
    #[test]
    fn target_paths_require_a_current_user_owned_safe_existing_ancestor() {
        let root = fixture("paths");
        assert!(InstallationTarget::open(&root).is_ok());
        assert!(InstallationTarget::open(&root.join("new").join("installation")).is_ok());
        for invalid in [
            PathBuf::from("relative"),
            root.join("..\\escape"),
            root.join("file:stream"),
            root.join("trailing."),
            root.join("CON"),
            root.join("nul.txt"),
        ] {
            assert!(
                InstallationTarget::open(&invalid).is_err(),
                "{}",
                invalid.display()
            );
        }
        let foreign = Path::new(r"C:\Windows");
        assert!(InstallationTarget::open(foreign).is_err());
        std::fs::remove_dir(&root).unwrap();
    }
    fn fixture(label: &str) -> PathBuf {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .unwrap()
            .join("dist/test/w2-maintenance-unit");
        std::fs::create_dir_all(&base).unwrap();
        let root = base.join(format!(
            "{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        super::super::gate::InstallationGate::create_test_profile(&root).unwrap();
        std::fs::canonicalize(root).unwrap()
    }
    struct Sleeper(std::process::Child);
    impl Sleeper {
        fn new() -> Self {
            use std::os::windows::process::CommandExt;
            Self(
                std::process::Command::new("powershell.exe")
                    .args([
                        "-NoProfile",
                        "-NonInteractive",
                        "-WindowStyle",
                        "Hidden",
                        "-Command",
                        "Start-Sleep -Seconds 30",
                    ])
                    .creation_flags(0x08000000)
                    .spawn()
                    .unwrap(),
            )
        }
    }
    impl Drop for Sleeper {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    #[test]
    fn native_process_handle_proves_live_stopped_record_and_actual_exit() {
        let mut sleeper = Sleeper::new();
        let mut api = WindowsProcess;
        let handle = api.open(sleeper.0.id()).unwrap().unwrap();
        let creation = api.creation(&handle).unwrap();
        let mut record = record(creation as u32);
        record.Process.ProcessStartTime.dwHighDateTime = (creation >> 32) as u32;
        record.Process.dwProcessId = sleeper.0.id();
        record.AppStatus = RmStatusStopped.0 as u32;
        assert_eq!(
            classify(
                &record,
                process_identity(&mut api, sleeper.0.id()),
                Path::new(r"C:\test")
            ),
            MaintenanceResult::OtherProcess
        );
        sleeper.0.kill().unwrap();
        sleeper.0.wait().unwrap();
        assert!(api.exited(&handle).unwrap());
        assert_eq!(
            classify(
                &record,
                process_identity(&mut api, sleeper.0.id()),
                Path::new(r"C:\test")
            ),
            MaintenanceResult::Ready
        );
        record.Process.ProcessStartTime.dwLowDateTime ^= 1;
        assert_eq!(
            classify(
                &record,
                process_identity(&mut api, sleeper.0.id()),
                Path::new(r"C:\test")
            ),
            MaintenanceResult::Identity
        );
    }
    #[test]
    fn retained_gate_validation_does_not_change_locks_or_receiver_handles() {
        let root = fixture("handle");
        let gate = gate::InstallationGate::for_test_root(&root).unwrap();
        let receiver = Sleeper::new();
        let retained = gate.export_maintenance_handle(receiver.0.id()).unwrap();
        assert_eq!(
            validate_maintenance_handle(&gate, receiver.0.id(), retained),
            MaintenanceResult::Ready
        );
        let permit = gate.maintenance(std::time::Instant::now()).unwrap();
        assert_eq!(
            validate_maintenance_handle(&gate, receiver.0.id(), retained),
            MaintenanceResult::Ready
        );
        assert_eq!(
            validate_maintenance_handle(&gate, receiver.0.id(), 0),
            MaintenanceResult::Authority
        );
        assert_eq!(
            validate_maintenance_handle(&gate, 0, retained),
            MaintenanceResult::Authority
        );
        assert_eq!(
            check_maintenance_processes(
                &gate,
                receiver.0.id(),
                retained,
                &root.join("new-install")
            ),
            MaintenanceResult::Ready
        );
        drop(permit);
        let other = fixture("other-handle");
        let other_gate = gate::InstallationGate::for_test_root(&other).unwrap();
        assert_eq!(
            validate_maintenance_handle(&other_gate, receiver.0.id(), retained),
            MaintenanceResult::Authority
        );
    }
    #[test]
    fn command_parser_accepts_only_exact_bounded_arguments() {
        let parse = |args: &[&str]| {
            parse_request(
                &args
                    .iter()
                    .map(std::ffi::OsString::from)
                    .collect::<Vec<_>>(),
            )
        };
        assert!(matches!(
            parse(&["--validate-maintenance-handle", "123", "456"]),
            Ok(MaintenanceRequest::Validate {
                pid: 123,
                handle: 456
            })
        ));
        assert!(matches!(
            parse(&["--check-maintenance-processes", "123", "456", r"C:\test"]),
            Ok(MaintenanceRequest::Check {
                pid: 123,
                handle: 456,
                ..
            })
        ));
        for args in [
            vec![],
            vec!["--unknown"],
            vec!["--validate-maintenance-handle", "1", "0"],
            vec!["--validate-maintenance-handle", "0", "1"],
            vec!["--validate-maintenance-handle", "1", "4294967295"],
            vec!["--validate-maintenance-handle", "+1", "2"],
            vec!["--validate-maintenance-handle", "1", "2", "extra"],
            vec!["--check-maintenance-processes", "1", "2"],
            vec!["--check-maintenance-processes", "1", "2", ""],
        ] {
            assert!(
                matches!(parse(&args), Err(MaintenanceResult::Arguments)),
                "{args:?}"
            );
        }
    }
    #[test]
    fn pinned_target_rejects_replacement_reparse_points_and_unsafe_acl() {
        use std::os::windows::process::CommandExt;
        let root = fixture("target-boundary");
        let target = InstallationTarget::open(&root).unwrap();
        assert!(std::fs::rename(&root, root.with_extension("moved")).is_err());
        drop(target);
        let destination = root.join("real");
        std::fs::create_dir(&destination).unwrap();
        let junction = root.join("alias");
        let command = format!(
            "mklink /J \"{}\" \"{}\"",
            junction.display(),
            destination.display()
        );
        let output = std::process::Command::new("cmd.exe")
            .args(["/D", "/C"])
            .raw_arg(&command)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(output.status.success(), "junction fixture creation failed");
        assert!(InstallationTarget::open(&junction).is_err());
        assert!(InstallationTarget::open(&junction.join("new")).is_err());
        std::fs::remove_dir(&junction).unwrap();
        let output = std::process::Command::new("icacls.exe")
            .arg(&root)
            .args(["/grant", "*S-1-1-0:(M)"])
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(InstallationTarget::open(&root).is_err());
        assert!(InstallationTarget::open(&root.join("new")).is_err());
    }
    #[test]
    fn retained_handle_rechecks_existing_gate_security() {
        use std::os::windows::process::CommandExt;
        let root = fixture("gate-security");
        let gate = gate::InstallationGate::for_test_root(&root).unwrap();
        let receiver = Sleeper::new();
        let retained = gate.export_maintenance_handle(receiver.0.id()).unwrap();
        let path = root
            .join(".slate-coordination")
            .join("com.aiclipmemory.desktop")
            .join("maintenance-v2.lock");
        let output = std::process::Command::new("icacls.exe")
            .arg(path)
            .args(["/grant", "*S-1-1-0:(R)"])
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(
            validate_maintenance_handle(&gate, receiver.0.id(), retained),
            MaintenanceResult::Authority
        );
    }
    #[test]
    fn failed_export_output_rolls_back_all_remote_directory_pins() {
        let root = fixture("export-rollback");
        let receiver = Sleeper::new();
        let gate = gate::InstallationGate::for_test_root(&root).unwrap();
        let mut calls = 0;
        let result = gate.export_maintenance_handle_with(receiver.0.id(), |handle| {
            assert_ne!(handle, 0);
            calls += 1;
            Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
        });
        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::BrokenPipe);
        assert_eq!(calls, 1);
        drop(gate);
        let renamed = root.with_extension("rolled-back");
        std::fs::rename(&root, &renamed).expect("failed output retained unreachable remote pins");
        std::fs::rename(&renamed, &root).unwrap();
    }
}
