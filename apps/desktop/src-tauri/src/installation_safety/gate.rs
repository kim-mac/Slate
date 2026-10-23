//! Per-user version 2 gate: byte 0 is admission, byte 1 is activity.
//! The empty file is intentional: there is no crash-sensitive header to repair.
//! Handles never share delete access; locks are released by the kernel on death.
use std::{
    fs::File,
    io,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle},
    },
    path::{Component, Path, PathBuf, Prefix},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, Instant},
};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{ERROR_LOCK_VIOLATION, GENERIC_READ, GENERIC_WRITE, HANDLE},
        Storage::FileSystem::{
            CreateDirectoryW, CreateFileW, GetDriveTypeW, GetFileInformationByHandle, GetFileType,
            GetFinalPathNameByHandleW, GetVolumeInformationByHandleW, LockFileEx, UnlockFileEx,
            BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_READONLY,
            FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
            FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
            FILE_TYPE_DISK, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY, OPEN_ALWAYS,
            OPEN_EXISTING, VOLUME_NAME_DOS,
        },
        System::IO::OVERLAPPED,
    },
};

#[path = "profile.rs"]
pub(crate) mod profile;
const NAME: &str = "maintenance-v2.lock";
const ADMISSION_RETRY: Duration = Duration::from_millis(150);
struct GateState {
    path: PathBuf,
    anchor: File,
    authority: Arc<Authority>,
    // Pin every original/canonical ancestor against replacement while in use.
    _directories: Vec<File>,
}
/// Pinned profile identity survives an unavailable private namespace. Retrying
/// never asks an environment variable or a new installation for another root.
pub(crate) struct Authority {
    root: PathBuf,
    directories: Vec<File>,
}
impl Authority {
    pub(crate) fn current_user() -> io::Result<Arc<Self>> {
        let (root, pins) = profile::permanent_root()?;
        let mut authority = Self::open(&root)?;
        authority.directories.extend(pins);
        Ok(Arc::new(authority))
    }
    fn open(root: &Path) -> io::Result<Self> {
        let mut directories = pin_directories(root)?;
        let canonical = std::fs::canonicalize(root)?;
        directories.extend(pin_directories(&canonical)?);
        let user = profile::User::current()?;
        user.validate(directories.last().ok_or_else(invalid_path)?, false, true)?;
        let expected_root = if root.as_os_str().to_string_lossy().starts_with("\\\\?\\") {
            root.to_path_buf()
        } else {
            PathBuf::from(format!("\\\\?\\{}", root.display()))
        };
        if !canonical
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&expected_root.as_os_str().to_string_lossy())
        {
            return Err(invalid_path());
        }
        validate_final_path(directories.last().ok_or_else(invalid_path)?, &canonical)?;
        validate_filesystem(directories.last().ok_or_else(invalid_path)?)?;
        Ok(Self {
            root: canonical,
            directories,
        })
    }
    #[cfg(test)]
    pub(crate) fn for_test_root(root: &Path) -> io::Result<Arc<Self>> {
        validate_fixture(root)?;
        Ok(Arc::new(Self::open(root)?))
    }
}
#[derive(Clone)]
pub struct InstallationGate {
    state: Arc<GateState>,
}
pub struct GatePermit {
    file: File,
    _state: Arc<GateState>,
    admission: bool,
    activity: bool,
}
/// Desktop startup remains available even if the authority cannot currently be
/// opened. Every operation retries this same authority and still needs admission.
pub(crate) struct UserGate {
    authority: OnceLock<Arc<Authority>>,
    anchor: OnceLock<InstallationGate>,
    available: AtomicBool,
    #[cfg(test)]
    test_root: Option<PathBuf>,
}
impl UserGate {
    pub(crate) fn new() -> Self {
        let gate = Self {
            authority: OnceLock::new(),
            anchor: OnceLock::new(),
            available: AtomicBool::new(false),
            #[cfg(test)]
            test_root: None,
        };
        let _ = gate.admit();
        gate
    }
    #[cfg(test)]
    pub(crate) fn for_test_root(root: &Path) -> io::Result<Self> {
        validate_fixture(root)?;
        let gate = Self {
            authority: OnceLock::new(),
            anchor: OnceLock::new(),
            available: AtomicBool::new(false),
            test_root: Some(root.to_path_buf()),
        };
        let _ = gate.admit();
        Ok(gate)
    }
    fn resolve(&self) -> io::Result<&InstallationGate> {
        if self.authority.get().is_none() {
            #[cfg(test)]
            let authority = match &self.test_root {
                Some(root) => Authority::for_test_root(root)?,
                None => Authority::current_user()?,
            };
            #[cfg(not(test))]
            let authority = Authority::current_user()?;
            let _ = self.authority.set(authority);
        }
        if self.anchor.get().is_none() {
            let gate = InstallationGate::open_authority(Arc::clone(
                self.authority.get().ok_or_else(invalid_path)?,
            ))?;
            let _ = self.anchor.set(gate);
        }
        self.anchor.get().ok_or_else(invalid_path)
    }
    pub(crate) fn available(&self) -> bool {
        self.available.load(Ordering::Acquire)
    }
    fn record<T>(&self, result: io::Result<T>) -> io::Result<T> {
        self.available.store(result.is_ok(), Ordering::Release);
        result
    }
    pub(crate) fn admit(&self) -> io::Result<GatePermit> {
        self.record(self.resolve().and_then(InstallationGate::admit))
    }
    pub(crate) fn maintenance(&self, deadline: Instant) -> io::Result<GatePermit> {
        self.record(self.resolve().and_then(|gate| gate.maintenance(deadline)))
    }
}
impl InstallationGate {
    /// Export an independently opened, unlocked file and all physical identity
    /// pins. The receiving process must acquire A then B itself. Pins live until
    /// that process exits, including after this exporter has exited.
    pub fn export_maintenance_handle(&self, process_id: u32) -> io::Result<u32> {
        use windows::Win32::{
            Foundation::{
                CloseHandle, DuplicateHandle, DUPLICATE_CLOSE_SOURCE, DUPLICATE_SAME_ACCESS,
            },
            System::Threading::{
                GetCurrentProcess, GetCurrentProcessId, OpenProcess, PROCESS_DUP_HANDLE,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        };
        if process_id == 0 || process_id == unsafe { GetCurrentProcessId() } {
            return Err(invalid_path());
        }
        let target = unsafe {
            OpenProcess(
                PROCESS_DUP_HANDLE | PROCESS_QUERY_LIMITED_INFORMATION,
                false,
                process_id,
            )
        }
        .map_err(win_error)?;
        struct RemoteHandles {
            target: HANDLE,
            handles: Vec<HANDLE>,
            committed: bool,
        }
        impl Drop for RemoteHandles {
            fn drop(&mut self) {
                unsafe {
                    if !self.committed {
                        for source in &self.handles {
                            let mut local = HANDLE::default();
                            if DuplicateHandle(
                                self.target,
                                *source,
                                GetCurrentProcess(),
                                &mut local,
                                0,
                                false,
                                DUPLICATE_SAME_ACCESS | DUPLICATE_CLOSE_SOURCE,
                            )
                            .is_ok()
                            {
                                let _ = CloseHandle(local);
                            }
                        }
                    }
                    let _ = CloseHandle(self.target);
                }
            }
        }
        let mut remote = RemoteHandles {
            target,
            handles: Vec::new(),
            committed: false,
        };
        if !profile::User::current()?.matches(&profile::User::for_process(target)?) {
            return Err(invalid_path());
        }
        let permit = self.permit()?;
        for file in self
            .state
            .authority
            .directories
            .iter()
            .chain(self.state._directories.iter())
            .chain(std::iter::once(&permit.file))
        {
            let mut duplicate = HANDLE::default();
            unsafe {
                DuplicateHandle(
                    GetCurrentProcess(),
                    handle(file),
                    target,
                    &mut duplicate,
                    0,
                    false,
                    DUPLICATE_SAME_ACCESS,
                )
            }
            .map_err(win_error)?;
            remote.handles.push(duplicate);
        }
        let value = remote.handles.last().ok_or_else(invalid_path)?.0 as usize;
        let value = u32::try_from(value).map_err(|_| invalid_path())?;
        if value == 0 || value == u32::MAX {
            return Err(invalid_path());
        }
        remote.committed = true;
        Ok(value)
    }
    /// The process token and Windows profile service determine the only authority.
    pub fn for_current_user() -> io::Result<Self> {
        Self::open_authority(Authority::current_user()?)
    }
    #[cfg(test)]
    pub fn for_test_root(root: &Path) -> io::Result<Self> {
        Self::open_authority(Authority::for_test_root(root)?)
    }
    /// Create a new simulated profile securely, never repair an existing root.
    #[cfg(test)]
    pub fn create_test_profile(root: &Path) -> io::Result<()> {
        let fixture_base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .ok_or_else(invalid_path)?
            .join("dist/test");
        if !std::fs::canonicalize(root.parent().ok_or_else(invalid_path)?)?
            .starts_with(std::fs::canonicalize(fixture_base)?)
        {
            return Err(invalid_path());
        }
        let descriptor = profile::User::current()?.security()?;
        let attributes = descriptor.attributes();
        let wide: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe { CreateDirectoryW(PCWSTR(wide.as_ptr()), Some(&attributes)) }.map_err(win_error)
    }
    #[cfg(test)]
    pub fn prepare_test_namespace(root: &Path) -> io::Result<PathBuf> {
        let authority = Authority::for_test_root(root)?;
        let (path, _) = Self::namespace(&authority)?;
        Ok(path)
    }
    fn namespace(authority: &Authority) -> io::Result<(PathBuf, Vec<File>)> {
        let user = profile::User::current()?;
        user.validate(
            authority.directories.last().ok_or_else(invalid_path)?,
            false,
            true,
        )?;
        let descriptor = user.security()?;
        let attributes = descriptor.attributes();
        let mut private_root = authority.root.clone();
        let mut directories = Vec::new();
        for name in [".slate-coordination", "com.aiclipmemory.desktop"] {
            private_root.push(name);
            let wide: Vec<u16> = private_root
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect();
            match unsafe { CreateDirectoryW(PCWSTR(wide.as_ptr()), Some(&attributes)) } {
                Ok(()) => (),
                Err(error) if (error.code().0 as u32 & 0xffff) == 183 => (),
                Err(error) => return Err(win_error(error)),
            }
            let directory = open_file(&private_root, true)?;
            let info = information(&directory)?;
            if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
                || info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY.0 == 0
            {
                return Err(invalid_path());
            }
            user.validate(&directory, true, true)?;
            validate_final_path(&directory, &private_root)?;
            directories.push(directory);
        }
        Ok((private_root.join(NAME), directories))
    }
    pub(crate) fn open_authority(authority: Arc<Authority>) -> io::Result<Self> {
        let (path, directories) = Self::namespace(&authority)?;
        let user = profile::User::current()?;
        let descriptor = user.security()?;
        let attributes = descriptor.attributes();
        let anchor = open_file_secure(&path, Some(&attributes))?;
        validate_file(&anchor)?;
        user.validate(&anchor, true, false)?;
        validate_final_path(&anchor, &path)?;
        validate_filesystem(&anchor)?;
        if std::fs::canonicalize(&path)? != path {
            return Err(invalid_path());
        }
        Ok(Self {
            state: Arc::new(GateState {
                path,
                anchor,
                authority,
                _directories: directories,
            }),
        })
    }
    fn permit(&self) -> io::Result<GatePermit> {
        // A new CreateFile handle for EVERY operation; never reuse the anchor.
        let file = open_file(&self.state.path, false)?;
        let actual = validate_file(&file)?;
        let expected = validate_file(&self.state.anchor)?;
        if identity(&actual) != identity(&expected) {
            return Err(invalid_path());
        }
        let user = profile::User::current()?;
        // Re-check the strict boundary, including changes to an already-open
        // object's security. Never repair or replace an unsafe object.
        user.validate(
            self.state
                .authority
                .directories
                .last()
                .ok_or_else(invalid_path)?,
            false,
            true,
        )?;
        for directory in &self.state._directories {
            user.validate(directory, true, true)?;
        }
        user.validate(&file, true, false)?;
        Ok(GatePermit {
            file,
            _state: Arc::clone(&self.state),
            admission: false,
            activity: false,
        })
    }
    pub fn admit(&self) -> io::Result<GatePermit> {
        let mut permit = self.permit()?;
        lock_until(&permit.file, 0, true, Instant::now() + ADMISSION_RETRY).map_err(|e| {
            if e.kind() == io::ErrorKind::TimedOut {
                io::Error::new(io::ErrorKind::WouldBlock, "installation admission busy")
            } else {
                e
            }
        })?;
        permit.admission = true;
        lock_until(&permit.file, 1, false, Instant::now())?;
        permit.activity = true;
        unlock(&permit.file, 0)?;
        permit.admission = false;
        Ok(permit)
    }
    pub fn maintenance(&self, deadline: Instant) -> io::Result<GatePermit> {
        self.maintenance_inner(deadline, || {})
    }
    fn maintenance_inner(
        &self,
        deadline: Instant,
        closed: impl FnOnce(),
    ) -> io::Result<GatePermit> {
        let mut permit = self.permit()?;
        lock_until(&permit.file, 0, true, deadline)?;
        permit.admission = true;
        closed();
        lock_until(&permit.file, 1, true, deadline)?;
        permit.activity = true;
        Ok(permit)
    }
    #[cfg(test)]
    pub fn maintenance_after_close(
        &self,
        deadline: Instant,
        closed: impl FnOnce(),
    ) -> io::Result<GatePermit> {
        self.maintenance_inner(deadline, closed)
    }
    #[cfg(test)]
    pub fn hold_admission(&self) -> io::Result<GatePermit> {
        let mut permit = self.permit()?;
        lock_until(&permit.file, 0, true, Instant::now())?;
        permit.admission = true;
        Ok(permit)
    }
    #[cfg(test)]
    pub fn physical_identity(&self) -> io::Result<(u32, u32, u32)> {
        Ok(identity(&information(&self.state.anchor)?))
    }
    #[cfg(test)]
    pub fn current_profile_identity_readonly() -> io::Result<(PathBuf, (u32, u32, u32))> {
        let authority = Authority::current_user()?;
        Ok((
            authority.root.clone(),
            identity(&information(
                authority.directories.last().ok_or_else(invalid_path)?,
            )?),
        ))
    }
}
#[cfg(test)]
fn validate_fixture(root: &Path) -> io::Result<()> {
    let fixture_base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .ok_or_else(invalid_path)?
        .join("dist/test");
    if !std::fs::canonicalize(root)?.starts_with(std::fs::canonicalize(fixture_base)?) {
        return Err(invalid_path());
    }
    Ok(())
}
pub(crate) fn validate_filesystem(file: &File) -> io::Result<()> {
    let mut filesystem = [0u16; 32];
    unsafe {
        GetVolumeInformationByHandleW(handle(file), None, None, None, None, Some(&mut filesystem))
    }
    .map_err(win_error)?;
    if !supported_filesystem(&filesystem) {
        return Err(invalid_path());
    }
    Ok(())
}
impl Drop for GatePermit {
    fn drop(&mut self) {
        if self.activity {
            let _ = unlock(&self.file, 1);
        }
        if self.admission {
            let _ = unlock(&self.file, 0);
        }
        // File closes even on unlock failure; the kernel releases remaining locks.
    }
}
fn invalid_path() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "invalid installation gate path",
    )
}
fn win_error(error: windows::core::Error) -> io::Error {
    io::Error::from_raw_os_error((error.code().0 as u32 & 0xffff) as i32)
}
fn handle(file: &File) -> HANDLE {
    HANDLE(file.as_raw_handle())
}
fn open_file(path: &Path, directory: bool) -> io::Result<File> {
    open_file_inner(path, directory, None)
}
fn open_file_secure(
    path: &Path,
    attributes: Option<&windows::Win32::Security::SECURITY_ATTRIBUTES>,
) -> io::Result<File> {
    open_file_inner(path, false, attributes)
}
fn open_file_inner(
    path: &Path,
    directory: bool,
    attributes: Option<&windows::Win32::Security::SECURITY_ATTRIBUTES>,
) -> io::Result<File> {
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    if name[..name.len() - 1].contains(&0) {
        return Err(invalid_path());
    }
    let access = if directory {
        // Attributes-only access does not establish read-data sharing. Include
        // directory read access so omission of SHARE_DELETE actually pins it.
        FILE_READ_ATTRIBUTES.0 | FILE_LIST_DIRECTORY.0 | 0x20000
    } else {
        GENERIC_READ.0 | GENERIC_WRITE.0
    };
    let flags = if directory {
        FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS
    } else {
        FILE_FLAG_OPEN_REPARSE_POINT
    };
    let raw = unsafe {
        CreateFileW(
            PCWSTR(name.as_ptr()),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            attributes.map(|a| a as *const _),
            if directory {
                OPEN_EXISTING
            } else {
                OPEN_ALWAYS
            },
            flags,
            None,
        )
    }
    .map_err(win_error)?;
    Ok(unsafe { File::from_raw_handle(raw.0) })
}
pub(crate) fn validate_final_path(file: &File, expected: &Path) -> io::Result<()> {
    let mut units = vec![0u16; 32768];
    let length =
        unsafe { GetFinalPathNameByHandleW(handle(file), &mut units, VOLUME_NAME_DOS) } as usize;
    if length == 0 || length >= units.len() {
        return Err(invalid_path());
    }
    use std::os::windows::ffi::OsStringExt;
    if PathBuf::from(std::ffi::OsString::from_wide(&units[..length])) != expected {
        return Err(invalid_path());
    }
    Ok(())
}
fn information(file: &File) -> io::Result<BY_HANDLE_FILE_INFORMATION> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(handle(file), &mut info) }.map_err(win_error)?;
    if unsafe { GetFileType(handle(file)) } != FILE_TYPE_DISK {
        return Err(invalid_path());
    }
    Ok(info)
}
fn validate_file(file: &File) -> io::Result<BY_HANDLE_FILE_INFORMATION> {
    let info = information(file)?;
    if info.dwFileAttributes
        & (FILE_ATTRIBUTE_REPARSE_POINT.0 | FILE_ATTRIBUTE_DIRECTORY.0 | FILE_ATTRIBUTE_READONLY.0)
        != 0
        || info.nNumberOfLinks != 1
        || !usable_identity(&info)
    {
        return Err(invalid_path());
    }
    Ok(info)
}
fn identity(info: &BY_HANDLE_FILE_INFORMATION) -> (u32, u32, u32) {
    (
        info.dwVolumeSerialNumber,
        info.nFileIndexHigh,
        info.nFileIndexLow,
    )
}
fn usable_identity(info: &BY_HANDLE_FILE_INFORMATION) -> bool {
    info.dwVolumeSerialNumber != 0 && (info.nFileIndexHigh != 0 || info.nFileIndexLow != 0)
}
fn supported_filesystem(name: &[u16]) -> bool {
    let length = name.iter().position(|c| *c == 0).unwrap_or(name.len());
    name[..length] == [b'N' as u16, b'T' as u16, b'F' as u16, b'S' as u16]
}
pub(crate) fn pin_directories(root: &Path) -> io::Result<Vec<File>> {
    if !root.is_absolute() {
        return Err(invalid_path());
    }
    let mut current = PathBuf::new();
    let mut retained = Vec::new();
    for component in root.components() {
        match component {
            Component::Prefix(prefix) => {
                if !matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) {
                    return Err(invalid_path());
                }
                current.push(component.as_os_str());
                continue;
            }
            Component::RootDir => {
                current.push(component.as_os_str());
                let drive: Vec<u16> = current.as_os_str().encode_wide().chain(Some(0)).collect();
                // DRIVE_REMOTE=4; unknown/no-root also cannot establish identity.
                if !matches!(unsafe { GetDriveTypeW(PCWSTR(drive.as_ptr())) }, 2 | 3 | 6) {
                    return Err(invalid_path());
                }
            }
            Component::Normal(_) => current.push(component.as_os_str()),
            _ => return Err(invalid_path()),
        }
        // A bare C: prefix is not an absolute directory yet.
        if !current.is_absolute() {
            continue;
        }
        let file = open_file(&current, true)?;
        let info = information(&file)?;
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
            || info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY.0 == 0
            || !usable_identity(&info)
        {
            return Err(invalid_path());
        }
        retained.push(file);
    }
    Ok(retained)
}
fn overlapped(offset: u32) -> OVERLAPPED {
    let mut overlapped = OVERLAPPED::default();
    overlapped.Anonymous.Anonymous.Offset = offset;
    overlapped
}
fn lock_until(file: &File, offset: u32, exclusive: bool, deadline: Instant) -> io::Result<()> {
    loop {
        let mut overlapped = overlapped(offset);
        let flags = if exclusive {
            LOCKFILE_FAIL_IMMEDIATELY | LOCKFILE_EXCLUSIVE_LOCK
        } else {
            LOCKFILE_FAIL_IMMEDIATELY
        };
        match unsafe { LockFileEx(handle(file), flags, None, 1, 0, &mut overlapped) } {
            Ok(()) => return Ok(()),
            Err(error) => {
                let error = win_error(error);
                if error.raw_os_error() != Some(ERROR_LOCK_VIOLATION.0 as i32) {
                    return Err(error);
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "installation activity did not drain",
                    ));
                }
                std::thread::park_timeout(remaining.min(Duration::from_millis(2)));
            }
        }
    }
}
fn unlock(file: &File, offset: u32) -> io::Result<()> {
    let mut overlapped = overlapped(offset);
    unsafe { UnlockFileEx(handle(file), None, 1, 0, &mut overlapped) }.map_err(win_error)
}

#[cfg(test)]
mod identity_tests {
    use super::*;
    #[test]
    fn ambiguous_identity_and_unestablished_filesystems_are_rejected() {
        assert!(!usable_identity(&BY_HANDLE_FILE_INFORMATION::default()));
        let info = BY_HANDLE_FILE_INFORMATION {
            dwVolumeSerialNumber: 1,
            nFileIndexLow: 1,
            ..Default::default()
        };
        assert!(usable_identity(&info));
        assert!(!usable_identity(&BY_HANDLE_FILE_INFORMATION {
            dwVolumeSerialNumber: 0,
            ..info
        }));
        assert!(!usable_identity(&BY_HANDLE_FILE_INFORMATION {
            nFileIndexLow: 0,
            ..info
        }));
        assert!(supported_filesystem(
            &"NTFS\0".encode_utf16().collect::<Vec<_>>()
        ));
        for name in ["", "ReFS\0", "FAT32\0"] {
            assert!(!supported_filesystem(
                &name.encode_utf16().collect::<Vec<_>>()
            ));
        }
    }
}
