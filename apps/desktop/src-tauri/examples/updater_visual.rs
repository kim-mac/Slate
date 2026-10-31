//! Debug-only native visual harness. Never calls the production application's run().
#[cfg(windows)]
mod windows_preview {
    use std::fs;
    use std::path::{Path, PathBuf};

    use rusqlite::{Connection, OpenFlags};
    use serde_json::{json, Value};
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    fn reject_links(path: &Path) -> Result<(), String> {
        for ancestor in path.ancestors() {
            match fs::symlink_metadata(ancestor) {
                Ok(metadata) => {
                    #[cfg(windows)]
                    let reparse = {
                        use std::os::windows::fs::MetadataExt;
                        metadata.file_attributes() & 0x400 != 0
                    };
                    #[cfg(not(windows))]
                    let reparse = false;
                    if metadata.file_type().is_symlink() || reparse {
                        return Err("Preview refuses symlink/reparse paths".into());
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        Ok(())
    }

    fn profile_path(root: &Path, pid: u32) -> Result<PathBuf, String> {
        let path = root
            .join("dist/test/updater-visual-review")
            .join(format!("profile-{pid}"));
        reject_links(&path)?;
        Ok(path)
    }

    struct PreviewDatabase(PathBuf);

    fn create_profile(root: &Path) -> Result<PathBuf, String> {
        let profile = profile_path(root, std::process::id())?;
        fs::create_dir_all(profile.parent().unwrap()).map_err(|error| error.to_string())?;
        // Refuse to reuse/overwrite any previous profile, even after PID reuse.
        fs::create_dir(&profile).map_err(|error| error.to_string())?;
        let database = profile.join("clips.sqlite3");
        let connection = Connection::open(&database).map_err(|error| error.to_string())?;
        connection
            .execute_batch(include_str!("../migrations/0001_create_clips.sql"))
            .map_err(|error| error.to_string())?;
        for (id, title, content) in [
            (
                "preview-1",
                "A quieter workspace",
                "Synthetic preview: keep useful ideas close at hand.",
            ),
            (
                "preview-2",
                "Release checklist",
                "Synthetic preview: review, test, then ship.",
            ),
            (
                "preview-3",
                "Reading notes",
                "Synthetic preview: local notes for a future project.",
            ),
        ] {
            connection.execute(
                "INSERT INTO clips (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, '2026-10-13T12:00:00.000Z', '2026-10-13T12:00:00.000Z')",
                [id, title, content],
            ).map_err(|error| error.to_string())?;
        }
        connection
            .pragma_update(None, "user_version", 1)
            .map_err(|error| error.to_string())?;
        fs::write(
            profile.join("ISOLATED-PREVIEW.txt"),
            "Synthetic SQLite and WebView only. No production plugins or update transport.\n",
        )
        .map_err(|error| error.to_string())?;
        Ok(profile)
    }

    #[tauri::command]
    fn list_clips(state: tauri::State<'_, PreviewDatabase>) -> Result<Vec<Value>, String> {
        reject_links(&state.0)?;
        let connection = Connection::open_with_flags(&state.0, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| error.to_string())?;
        let mut query = connection
            .prepare("SELECT id, title, content, created_at, updated_at FROM clips ORDER BY created_at DESC, id DESC")
            .map_err(|error| error.to_string())?;
        let rows = query
            .query_map([], |row| {
                Ok(json!({"kind": "clip", "clip": {
                    "id": row.get::<_, String>(0)?, "title": row.get::<_, String>(1)?,
                    "content": row.get::<_, String>(2)?, "contentType": "text", "sourceApp": "Preview",
                    "sourceUrl": null, "sourcePageTitle": null, "isPinned": false,
                    "createdAt": row.get::<_, String>(3)?, "updatedAt": row.get::<_, String>(4)?
                }}))
            })
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string());
        rows
    }

    #[tauri::command]
    fn get_launcher_status() -> Value {
        json!({"available": false, "shortcut": "Ctrl+Shift+Space", "errorCode": "preview_disabled"})
    }

    pub(super) fn run() {
        if !cfg!(debug_assertions) {
            panic!("The updater visual example is debug-only");
        }
        for key in [
            "WEBVIEW2_USER_DATA_FOLDER",
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        ] {
            assert!(
                std::env::var_os(key).is_none(),
                "Preview refuses WebView2 environment overrides"
            );
        }
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .unwrap();
        assert_eq!(root.file_name().unwrap(), "codex-desktop-updater");
        assert!(
            root.join(".git").is_file(),
            "Must run from the isolated updater worktree"
        );
        let profile = create_profile(root).expect("safe worktree-local preview profile");
        let webview = profile.join("webview");
        reject_links(&webview).expect("safe WebView profile");
        tauri::Builder::default()
            .manage(PreviewDatabase(profile.join("clips.sqlite3")))
            .invoke_handler(tauri::generate_handler![list_clips, get_launcher_status])
            .setup(move |app| {
                WebviewWindowBuilder::new(
                    app,
                    "updater-visual",
                    WebviewUrl::App("index.html".into()),
                )
                .title("Slate Updater UX Preview")
                .inner_size(1100.0, 800.0)
                .data_directory(webview.clone())
                .on_navigation(|url| {
                    url.scheme() == "http"
                        && url.host_str() == Some("127.0.0.1")
                        && url.port() == Some(1421)
                        && url.path() == "/visual-preview/"
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
                // No tray, autostart, shortcuts, native host, or updater plugin is registered.
                assert_eq!(app.config().identifier, "com.aiclipmemory.updater-visual");
                Ok(())
            })
            .run(tauri::generate_context!(
                "examples/updater-visual/tauri.conf.json"
            ))
            .expect("isolated preview runtime");
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn profile_is_bounded_to_explicit_root_and_not_appdata() {
            let temp = tempfile::tempdir().unwrap();
            assert_eq!(
                profile_path(temp.path(), 42).unwrap(),
                temp.path()
                    .join("dist/test/updater-visual-review/profile-42")
            );
        }

        #[test]
        fn synthetic_database_is_fresh_and_never_reused() {
            let temp = tempfile::tempdir().unwrap();
            let profile = create_profile(temp.path()).unwrap();
            let connection = Connection::open_with_flags(
                profile.join("clips.sqlite3"),
                OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .unwrap();
            assert_eq!(
                connection
                    .query_row("SELECT COUNT(*) FROM clips", [], |row| row.get::<_, i64>(0))
                    .unwrap(),
                3
            );
            assert!(create_profile(temp.path()).is_err());
            assert!(connection.execute("DELETE FROM clips", []).is_err());
        }

        #[cfg(windows)]
        #[test]
        fn reparse_paths_are_rejected() {
            assert!(reject_links(Path::new("C:\\Documents and Settings")).is_err());
        }
    }
}

#[cfg(windows)]
fn main() {
    windows_preview::run();
}

#[cfg(not(windows))]
fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(78)
}
