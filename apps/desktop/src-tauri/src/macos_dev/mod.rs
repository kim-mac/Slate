//! M1 is an explicit development profile, never a macOS production fallback.
mod config;
pub mod policy;

use std::{
    ffi::{CStr, CString, OsStr},
    fs::{self, File, OpenOptions},
    io::{self, Write},
    os::{
        fd::AsRawFd,
        unix::{ffi::OsStrExt, fs::MetadataExt, fs::OpenOptionsExt},
    },
    path::{Path, PathBuf},
};
use tauri::Manager;

fn denied(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message)
}

pub fn prepare(config: &mut tauri::Config) -> io::Result<()> {
    config::prepare_context(config, env!("SLATE_MACOS_DEV_EFFECTIVE_CONFIG"))
}

pub fn validate(config: &tauri::Config) -> io::Result<()> {
    policy::validate_build(
        std::env::consts::OS,
        cfg!(debug_assertions),
        cfg!(feature = "macos-dev"),
        cfg!(feature = "ux-dev"),
    )
    .map_err(denied)?;
    config::validate(config)
}

fn trusted_home() -> io::Result<PathBuf> {
    // Account database, not a caller-controlled HOME/data-directory override.
    let uid = unsafe { libc::geteuid() };
    if uid == 0 {
        return Err(denied("do not run development Slate as root"));
    }
    let mut pwd = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut buffer = vec![0_u8; 16 * 1024];
    let mut result = std::ptr::null_mut();
    let status = unsafe {
        libc::getpwuid_r(
            uid,
            pwd.as_mut_ptr(),
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() {
        return Err(denied("trusted account home unavailable"));
    }
    let pwd = unsafe { pwd.assume_init() };
    if pwd.pw_dir.is_null() {
        return Err(denied("trusted account home unavailable"));
    }
    let home = PathBuf::from(OsStr::from_bytes(
        unsafe { CStr::from_ptr(pwd.pw_dir) }.to_bytes(),
    ));
    // Reject aliases instead of quietly canonicalizing a caller-selected path.
    if !home.is_absolute() || fs::canonicalize(&home)? != home {
        return Err(denied("account home is redirected"));
    }
    Ok(home)
}

fn require_macos_14() -> io::Result<()> {
    let mut value = [0_u8; 128];
    let mut length = value.len();
    let status = unsafe {
        libc::sysctlbyname(
            c"kern.osrelease".as_ptr(),
            value.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    if status != 0 || length == 0 || length > value.len() {
        return Err(denied("cannot verify macOS version"));
    }
    let release = CStr::from_bytes_until_nul(&value[..length])
        .map_err(|_| denied("invalid macOS version"))?;
    policy::validate_darwin(
        release
            .to_str()
            .map_err(|_| denied("invalid macOS version"))?,
    )
    .map_err(denied)
}

fn check_directory(path: &Path, uid: u32, private: bool) -> io::Result<fs::Metadata> {
    let metadata = fs::symlink_metadata(path)?;
    let root_sticky = !private && metadata.uid() == 0 && metadata.mode() & 0o1000 != 0;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || (metadata.uid() != uid && !(metadata.uid() == 0 && !private))
        || (!root_sticky && metadata.mode() & (if private { 0o077 } else { 0o022 }) != 0)
    {
        return Err(denied(
            "unsafe development directory ownership, permissions or link",
        ));
    }
    Ok(metadata)
}

fn check_ancestry(path: &Path, uid: u32) -> io::Result<()> {
    let mut current = PathBuf::new();
    for part in path.components() {
        current.push(part.as_os_str());
        check_directory(&current, uid, false)?;
    }
    Ok(())
}

pub struct Profile {
    pub data: PathBuf,
    directory: File,
    _lock: File,
    uid: u32,
}

impl Profile {
    pub fn open() -> io::Result<Self> {
        require_macos_14()?;
        Self::open_at_home(&trusted_home()?)
    }

    fn open_at_home(home: &Path) -> io::Result<Self> {
        let uid = unsafe { libc::geteuid() };
        let data = policy::data_path(home).map_err(denied)?;
        let parent = data.parent().ok_or_else(|| denied("missing data parent"))?;
        check_ancestry(home, uid)?;
        // Only these two expected per-user parent directories may be created.
        for path in [home.join("Library"), parent.to_path_buf()] {
            use std::os::unix::fs::DirBuilderExt;
            match fs::DirBuilder::new().mode(0o700).create(&path) {
                Ok(()) => (),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
                Err(error) => return Err(error),
            }
            check_directory(&path, uid, false)?;
        }
        check_ancestry(parent, uid)?;
        let parent_fd = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(parent)?;
        let name = CString::new(policy::IDENTIFIER).unwrap();
        if unsafe { libc::mkdirat(parent_fd.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(error);
            }
        }
        check_directory(&data, uid, true)?;
        let directory = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&data)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(data.join("profile.lock"))?;
        let metadata = lock.metadata()?;
        if !metadata.is_file()
            || metadata.uid() != uid
            || metadata.nlink() != 1
            || metadata.mode() & 0o077 != 0
        {
            return Err(denied("unsafe profile lock"));
        }
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err(denied("development profile is already in use"));
        }
        let profile = Self {
            data,
            directory,
            _lock: lock,
            uid,
        };
        profile.validate_data()?;
        Ok(profile)
    }

    pub fn validate_data(&self) -> io::Result<()> {
        check_ancestry(self.data.parent().unwrap(), self.uid)?;
        let current = check_directory(&self.data, self.uid, true)?;
        let held = self.directory.metadata()?;
        if current.dev() != held.dev() || current.ino() != held.ino() {
            return Err(denied("profile directory replaced"));
        }
        for entry in fs::read_dir(&self.data)? {
            let metadata = fs::symlink_metadata(entry?.path())?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.uid() != self.uid
                || metadata.nlink() != 1
                || metadata.mode() & 0o022 != 0
            {
                return Err(denied(
                    "unexpected linked, writable or non-file profile entry",
                ));
            }
        }
        Ok(())
    }
}

pub fn write_receipt(app: &tauri::AppHandle) -> io::Result<()> {
    let profile = app.state::<Profile>();
    profile.validate_data()?;
    let receipt = serde_json::json!({
        "profile": "macos-dev", "identifier": policy::IDENTIFIER,
        "dataDirectory": profile.data, "databasePath": app.state::<crate::storage::StorageState>().database_path(),
        "wkDataStoreIdentifier": policy::STORE_ID, "minimumSystemVersion": "14.0",
        "updaterTransport": false, "updaterInstallation": false, "nativeMessagingRegistration": false,
        "autostart": false, "quickSearch": "unsupported_platform", "productionMaintenanceGate": false
    });
    let name = format!("startup-{}.json", uuid::Uuid::new_v4());
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(profile.data.join(name))?;
    file.write_all(serde_json::to_string_pretty(&receipt)?.as_bytes())?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    fn home() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }
    fn open(home: &tempfile::TempDir) -> io::Result<Profile> {
        Profile::open_at_home(&home.path().canonicalize()?)
    }

    #[test]
    fn profile_is_private_exclusive_and_reopens_after_drop() {
        let home = home();
        let profile = open(&home).unwrap();
        assert_eq!(fs::metadata(&profile.data).unwrap().mode() & 0o777, 0o700);
        assert!(open(&home).is_err());
        profile.validate_data().unwrap();
        drop(profile);
        assert!(open(&home).is_ok());
    }

    #[test]
    fn unsafe_permissions_links_and_replacement_are_rejected() {
        let home = home();
        let profile = open(&home).unwrap();
        fs::set_permissions(&profile.data, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(profile.validate_data().is_err());
        fs::set_permissions(&profile.data, fs::Permissions::from_mode(0o700)).unwrap();
        let external = home.path().join("external");
        fs::write(&external, "synthetic").unwrap();
        let linked = profile.data.join("clips.sqlite3");
        symlink(&external, &linked).unwrap();
        assert!(profile.validate_data().is_err());
        fs::remove_file(&linked).unwrap();
        fs::hard_link(&external, &linked).unwrap();
        assert!(profile.validate_data().is_err());
        fs::remove_file(&linked).unwrap();
        let old = profile.data.with_extension("moved");
        fs::rename(&profile.data, &old).unwrap();
        symlink(&old, &profile.data).unwrap();
        assert!(profile.validate_data().is_err());
        assert!(open(&home).is_err());
    }

    #[test]
    fn runtime_rejects_config_that_restores_production_or_changes_store() {
        let mut config: tauri::Config =
            serde_json::from_str(include_str!("../../tauri.macos.conf.json")).unwrap();
        // The overlay inherits the approved version from the base configuration.
        config.version = Some("0.3.1".into());
        config::prepare(&mut config).unwrap();
        assert!(validate(&config).is_ok());
        config.identifier = "com.aiclipmemory.desktop".into();
        assert!(validate(&config).is_err());
        config.identifier = policy::IDENTIFIER.into();
        config.app.windows[0].data_store_identifier = None;
        assert!(validate(&config).is_err());
        config.app.windows[0].data_store_identifier = Some(policy::STORE_ID);
        config.plugins.0.insert(
            "updater".into(),
            serde_json::json!({"pubkey":"", "endpoints":["https://example.invalid"]}),
        );
        assert!(validate(&config).is_err());
    }
}
