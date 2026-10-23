//! Worktree-local profile. Windows ancestry handles deny replacement for app lifetime.
use std::os::windows::{
    fs::{MetadataExt, OpenOptionsExt},
    io::AsRawHandle,
};
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
};
use windows::Win32::{
    Foundation::HANDLE,
    Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION},
};

pub struct Profile {
    pub data: PathBuf,
    pub webview: PathBuf,
    _pins: Vec<File>,
}
fn denied() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "unsafe UX development profile",
    )
}
fn webview_environment_override(name: &std::ffi::OsStr) -> bool {
    name.to_string_lossy()
        .to_ascii_uppercase()
        .starts_with("WEBVIEW2_")
}
fn reject_webview_overrides() -> io::Result<()> {
    use winreg::{
        enums::{
            HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
        },
        RegKey,
    };
    if std::env::vars_os().any(|(name, _)| webview_environment_override(&name)) {
        return Err(denied());
    }
    // WebView2 can override explicit profile arguments through policy. Only read
    // names/counts; reject any override, including inaccessible/ambiguous keys.
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [KEY_WOW64_32KEY, KEY_WOW64_64KEY] {
            for name in [
                "UserDataFolder",
                "AdditionalBrowserArguments",
                "BrowserExecutableFolder",
            ] {
                let path = format!(r"Software\Policies\Microsoft\Edge\WebView2\{name}");
                match RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ | view) {
                    Ok(key) => {
                        if key.enum_values().next().is_some() {
                            return Err(denied());
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::NotFound => (),
                    Err(_) => return Err(denied()),
                }
            }
        }
    }
    Ok(())
}
fn ordinary(path: &Path, directory: bool) -> io::Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .share_mode(3)
        .custom_flags(0x00200000 | if directory { 0x02000000 } else { 0 })
        .open(path)?;
    let metadata = file.metadata()?;
    if metadata.file_attributes() & 0x400 != 0 || metadata.is_dir() != directory {
        return Err(denied());
    }
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
        .map_err(|_| denied())?;
    if !directory && info.nNumberOfLinks != 1 {
        return Err(denied());
    }
    Ok(file)
}
fn canonical_text(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .to_ascii_lowercase()
}
fn scan(path: &Path, remaining: &mut usize) -> io::Result<()> {
    if *remaining == 0 {
        return Err(denied());
    }
    *remaining -= 1;
    let metadata = fs::symlink_metadata(path)?;
    let directory = metadata.is_dir();
    let _pin = ordinary(path, directory)?;
    if directory {
        for entry in fs::read_dir(path)? {
            scan(&entry?.path(), remaining)?;
        }
    }
    Ok(())
}
impl Profile {
    pub fn open() -> io::Result<Self> {
        reject_webview_overrides()?;
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .ok_or_else(denied)?;
        if root.file_name().and_then(|v| v.to_str()) != Some("codex-inline-clip-content")
            || !root.join(".git").is_file()
        {
            return Err(denied());
        }
        Self::at(root)
    }
    fn at(root: &Path) -> io::Result<Self> {
        if !root.is_absolute() || root.to_string_lossy().starts_with(r"\\") {
            return Err(denied());
        }
        let mut pins = Vec::new();
        for ancestor in root.ancestors().collect::<Vec<_>>().into_iter().rev() {
            pins.push(ordinary(ancestor, true)?);
        }
        let mut current = root.to_path_buf();
        for part in ["dist", "test", "ux-dev", "profile-v1"] {
            current.push(part);
            match fs::create_dir(&current) {
                Ok(()) => (),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (),
                Err(e) => return Err(e),
            }
            pins.push(ordinary(&current, true)?);
        }
        if canonical_text(&fs::canonicalize(&current)?) != canonical_text(&current) {
            return Err(denied());
        }
        scan(&current, &mut 30_000)?;
        let data = current.join("data");
        let webview = current.join("webview");
        for path in [&data, &webview] {
            match fs::create_dir(path) {
                Ok(()) => (),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (),
                Err(e) => return Err(e),
            }
            pins.push(ordinary(path, true)?);
        }
        let database = data.join("clips.sqlite3");
        if !database.try_exists()? && data.join("storage-initialized-v1").try_exists()? {
            return Err(denied());
        }
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&database)
        {
            Ok(_) => (),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(e),
        }
        pins.push(ordinary(&database, false)?);
        Ok(Self {
            data,
            webview,
            _pins: pins,
        })
    }
    pub fn validate_data(&self) -> io::Result<()> {
        scan(&self.data, &mut 500)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_established_database_is_never_recreated() {
        let root = tempfile::tempdir().unwrap();
        let p = Profile::at(root.path()).unwrap();
        let data = p.data.clone();
        drop(p);
        fs::write(data.join("storage-initialized-v1"), "").unwrap();
        fs::remove_file(data.join("clips.sqlite3")).unwrap();
        assert!(Profile::at(root.path()).is_err());
        assert!(!data.join("clips.sqlite3").exists());
    }
    #[test]
    fn webview_override_detection_is_case_insensitive() {
        for name in [
            "WEBVIEW2_USER_DATA_FOLDER",
            "webview2_user_data_folder",
            "WebView2_Additional_Browser_Arguments",
        ] {
            assert!(webview_environment_override(std::ffi::OsStr::new(name)));
        }
        assert!(!webview_environment_override(std::ffi::OsStr::new(
            "APPDATA"
        )));
    }
    #[test]
    fn real_storage_bootstraps_and_persists_only_inside_the_pinned_profile() {
        use crate::{
            clips::{ClipService, CreateClip},
            installation_safety::SafetyCoordinator,
            storage::StorageState,
        };
        let root = tempfile::tempdir().unwrap();
        let p = Profile::at(root.path()).unwrap();
        let storage = StorageState::with_safety(p.data.clone(), SafetyCoordinator::new());
        let clip = storage
            .with_service(|service| {
                service.create(CreateClip {
                    content: "Synthetic UX persistence probe".into(),
                    content_type: "text".into(),
                    title: None,
                    source_app: None,
                    source_url: None,
                    source_page_title: None,
                })
            })
            .unwrap();
        assert_eq!(
            storage.with_service(ClipService::list).unwrap(),
            vec![clip.clone()]
        );
        p.validate_data().unwrap();
        drop(storage);
        drop(p);
        let p = Profile::at(root.path()).unwrap();
        let storage = StorageState::with_safety(p.data.clone(), SafetyCoordinator::new());
        assert_eq!(storage.with_service(ClipService::list).unwrap(), vec![clip]);
        assert!(p.data.join("storage-initialized-v1").is_file());
    }
    #[test]
    fn profile_persists_separate_data_and_webview_without_appdata() {
        let root = tempfile::tempdir().unwrap();
        let p = Profile::at(root.path()).unwrap();
        assert_eq!(p.data, root.path().join("dist/test/ux-dev/profile-v1/data"));
        assert_ne!(p.data, p.webview);
        fs::write(p.webview.join("synthetic-preference"), "retained").unwrap();
        drop(p);
        let again = Profile::at(root.path()).unwrap();
        assert_eq!(
            fs::read_to_string(again.webview.join("synthetic-preference")).unwrap(),
            "retained"
        );
    }
    #[test]
    fn hardlinked_database_is_rejected_without_modifying_target() {
        let root = tempfile::tempdir().unwrap();
        let p = Profile::at(root.path()).unwrap();
        let database = p.data.join("clips.sqlite3");
        drop(p);
        let original = root.path().join("unrelated-synthetic-file");
        fs::write(&original, "untouched").unwrap();
        fs::remove_file(&database).unwrap();
        fs::hard_link(&original, &database).unwrap();
        assert!(Profile::at(root.path()).is_err());
        assert_eq!(fs::read_to_string(original).unwrap(), "untouched");
    }
    #[test]
    fn live_profile_ancestry_cannot_be_renamed() {
        let root = tempfile::tempdir().unwrap();
        let p = Profile::at(root.path()).unwrap();
        assert!(fs::rename(p.data.parent().unwrap(), root.path().join("replaced")).is_err());
    }
    #[test]
    fn a_directory_in_place_of_database_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        let p = Profile::at(root.path()).unwrap();
        let database = p.data.join("clips.sqlite3");
        drop(p);
        fs::remove_file(&database).unwrap();
        fs::create_dir(&database).unwrap();
        assert!(Profile::at(root.path()).is_err());
    }
    #[test]
    fn junction_ancestor_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let result = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(root.path().join("dist"))
            .arg(target.path())
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "disposable junction creation failed"
        );
        assert!(Profile::at(root.path()).is_err());
        assert!(fs::read_dir(target.path()).unwrap().next().is_none());
        fs::remove_dir(root.path().join("dist")).unwrap();
    }
}
