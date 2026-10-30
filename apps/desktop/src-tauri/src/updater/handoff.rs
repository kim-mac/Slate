//! Windows-only handoff. Authentication is performed by the pinned SDK before
//! these private APIs receive immutable bytes. No SDK install/early-exit hook.
use super::{InstallBoundary, SafeError, StagedInstall};
use crate::installation_safety::gate::{self, profile};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    os::windows::{ffi::OsStrExt, fs::OpenOptionsExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Arc,
};
use windows::{
    core::PCWSTR,
    Win32::Storage::FileSystem::{CreateDirectoryW, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ},
};

const INSTALL_ARGS: [&str; 4] = ["/P", "/UPDATE", "/NS", "/R"];

pub(super) struct WindowsInstall(tauri::AppHandle);
impl WindowsInstall {
    pub(super) fn new(app: tauri::AppHandle) -> Self {
        Self(app)
    }
}
impl InstallBoundary for WindowsInstall {
    fn stage(&self, version: &str, bytes: Arc<[u8]>) -> Result<Box<dyn StagedInstall>, SafeError> {
        // Temp is NOT a coordination authority. Its ancestry is physically pinned
        // and every new staging directory has a private DACL from first creation.
        stage_verified(&std::env::temp_dir(), version, bytes)
            .map(|staged| Box::new(staged) as Box<dyn StagedInstall>)
            .map_err(|_| SafeError::HANDOFF_FAILED)
    }
    fn quit(&self, authorization: crate::installation_safety::UpdateExitAuthorization) {
        crate::background::quit_after_update(&self.0, authorization);
    }
}
struct WindowsStage {
    path: PathBuf,
    file: File,
    expected: Arc<[u8]>,
    _pins: Vec<File>,
    child: Option<Child>,
}
fn invalid() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        "unsafe updater staging",
    )
}
fn stage_verified(root: &Path, version: &str, bytes: Arc<[u8]>) -> std::io::Result<WindowsStage> {
    let version_parsed = semver::Version::parse(version).map_err(|_| invalid())?;
    if version_parsed.to_string() != version {
        return Err(invalid());
    }
    // The release contract distributes raw NSIS EXEs, not an arbitrary archive
    // to extract/execute. NSIS stubs are x86 even when their payload is ARM64.
    let offset = bytes
        .get(0x3c..0x40)
        .and_then(|b| b.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or_else(invalid)? as usize;
    if bytes.get(..2) != Some(b"MZ")
        || bytes.get(offset..offset.checked_add(6).ok_or_else(invalid)?) != Some(b"PE\0\0\x4c\x01")
    {
        return Err(invalid());
    }
    let mut pins = gate::pin_directories(root)?;
    let root = std::fs::canonicalize(root)?;
    gate::validate_final_path(pins.last().ok_or_else(invalid)?, &root)?;
    gate::validate_filesystem(pins.last().ok_or_else(invalid)?)?;
    let directory = root.join(format!("Slate-update-{}", uuid::Uuid::new_v4()));
    let user = profile::User::current()?;
    let descriptor = user.security()?;
    let attrs = descriptor.attributes();
    let wide: Vec<u16> = directory.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe { CreateDirectoryW(PCWSTR(wide.as_ptr()), Some(&attrs)) }.map_err(|error| {
        std::io::Error::from_raw_os_error((error.code().0 as u32 & 0xffff) as i32)
    })?;
    pins.extend(gate::pin_directories(&directory)?);
    user.validate(pins.last().ok_or_else(invalid)?, true, true)?;
    gate::validate_final_path(pins.last().ok_or_else(invalid)?, &directory)?;
    let path = directory.join(format!("Slate-{version}-update.exe"));
    {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(&path)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    // Windows cannot map an image while a writable handle remains. Reopen for
    // read with neither write nor delete sharing, then compare against the exact
    // authenticated bytes. The private directory protects the reopen boundary.
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(&path)?;
    user.validate(&file, true, false)?;
    gate::validate_final_path(&file, &path)?;
    let mut stage = WindowsStage {
        path,
        file,
        expected: bytes,
        _pins: pins,
        child: None,
    };
    stage.verify_bytes()?;
    Ok(stage)
}
impl WindowsStage {
    fn verify_bytes(&mut self) -> std::io::Result<()> {
        use std::os::windows::fs::MetadataExt;
        let metadata = self.file.metadata()?;
        if !metadata.is_file()
            || metadata.file_attributes() & 0x400 != 0
            || metadata.len() != self.expected.len() as u64
        {
            return Err(invalid());
        }
        profile::User::current()?.validate(&self.file, true, false)?;
        self.file.seek(SeekFrom::Start(0))?;
        let mut actual = Vec::with_capacity(self.expected.len());
        self.file.read_to_end(&mut actual)?;
        if actual.as_slice() != self.expected.as_ref() {
            return Err(invalid());
        }
        Ok(())
    }
}
impl StagedInstall for WindowsStage {
    fn launch(&mut self) -> Result<(), SafeError> {
        if self.child.is_some() {
            return Err(SafeError::HANDOFF_FAILED);
        }
        self.verify_bytes().map_err(|_| SafeError::HANDOFF_FAILED)?;
        // No shell, UAC verb, environment override or frontend-provided arguments.
        // Keep the read-only file/ancestor pins through successful CreateProcess.
        self.child = Some(
            Command::new(&self.path)
                .args(INSTALL_ARGS)
                .current_dir(self.path.parent().ok_or(SafeError::HANDOFF_FAILED)?)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| SafeError::HANDOFF_FAILED)?,
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let parent = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .unwrap()
            .join("dist")
            .join("test");
        let root = parent.join(format!("updater-staging-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        root
    }
    fn synthetic_pe() -> Arc<[u8]> {
        // Never executed: just a bounded PE header for staging/byte pinning tests.
        let mut bytes = vec![0u8; 256];
        bytes[..2].copy_from_slice(b"MZ");
        bytes[0x3c..0x40].copy_from_slice(&0x80u32.to_le_bytes());
        bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
        bytes[0x84..0x86].copy_from_slice(&0x14cu16.to_le_bytes());
        bytes.into()
    }
    #[test]
    fn staging_pins_exact_authenticated_bytes_and_refuses_write_or_replacement() {
        let root = fixture();
        let bytes = synthetic_pe();
        let staged = stage_verified(&root, "0.2.0", bytes.clone()).unwrap();
        assert_eq!(std::fs::read(&staged.path).unwrap(), bytes.as_ref());
        assert!(std::fs::OpenOptions::new()
            .write(true)
            .open(&staged.path)
            .is_err());
        assert!(std::fs::rename(&staged.path, staged.path.with_extension("moved")).is_err());
        assert!(std::fs::rename(staged.path.parent().unwrap(), root.join("replaced")).is_err());
    }
    #[test]
    fn malformed_artifacts_versions_and_reparse_roots_never_reach_process_creation() {
        let root = fixture();
        for bytes in [
            b"not an executable".to_vec(),
            b"PK\x03\x04zip".to_vec(),
            vec![],
        ] {
            assert!(stage_verified(&root, "0.2.0", bytes.into()).is_err());
        }
        for version in ["", "v0.2.0", "../0.2.0", "0.2.0\0"] {
            assert!(stage_verified(&root, version, synthetic_pe()).is_err());
        }
        let junction = root.join("redirect");
        let output = Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&root)
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(stage_verified(&junction, "0.2.0", synthetic_pe()).is_err());
    }
    #[test]
    fn process_arguments_are_fixed_and_never_accept_webview_paths_or_shell_text() {
        assert_eq!(INSTALL_ARGS, ["/P", "/UPDATE", "/NS", "/R"]);
    }
}
