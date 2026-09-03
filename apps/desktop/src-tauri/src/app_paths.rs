use std::path::{Path, PathBuf};

pub const APP_IDENTIFIER: &str = "com.aiclipmemory.desktop";
pub const CLIP_DATABASE_FILENAME: &str = "clips.sqlite3";

pub fn clip_database_path(data_directory: &Path) -> PathBuf {
    clip_database_path_from_app_data_dir(&data_directory.join(APP_IDENTIFIER))
}

pub fn clip_database_path_from_app_data_dir(application_data_directory: &Path) -> PathBuf {
    application_data_directory.join(CLIP_DATABASE_FILENAME)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{
        clip_database_path, clip_database_path_from_app_data_dir, APP_IDENTIFIER,
        CLIP_DATABASE_FILENAME,
    };

    #[test]
    fn resolves_the_database_under_the_existing_tauri_application_data_directory() {
        let data_directory = Path::new("platform-data");

        assert_eq!(
            clip_database_path(data_directory),
            data_directory
                .join("com.aiclipmemory.desktop")
                .join("clips.sqlite3")
        );
    }

    #[test]
    fn gui_and_native_host_inputs_resolve_to_the_same_database_file() {
        let data_directory = Path::new("platform-data");
        let existing_gui_database = data_directory
            .join(APP_IDENTIFIER)
            .join(CLIP_DATABASE_FILENAME);

        assert_eq!(
            clip_database_path(data_directory),
            clip_database_path_from_app_data_dir(
                existing_gui_database
                    .parent()
                    .expect("the GUI database should have an app-data parent")
            )
        );
    }
}
