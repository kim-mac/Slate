use std::fs;
use std::io::{self, Write};

use ai_clip_memory_desktop_lib::app_paths::clip_database_path;
use ai_clip_memory_desktop_lib::bridge::native_host::{run_once, write_response};
use ai_clip_memory_desktop_lib::bridge::protocol::{BridgeErrorCode, BridgeResponse};
use ai_clip_memory_desktop_lib::clips::ClipService;

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    let Some(data_directory) = dirs::data_dir() else {
        write_storage_failure(&mut writer);
        return;
    };
    let database_path = clip_database_path(&data_directory);
    let Some(application_data_directory) = database_path.parent() else {
        write_storage_failure(&mut writer);
        return;
    };
    if fs::create_dir_all(application_data_directory).is_err() {
        write_storage_failure(&mut writer);
        return;
    }

    let Ok(service) = ClipService::open(database_path) else {
        write_storage_failure(&mut writer);
        return;
    };
    let _ = run_once(&mut reader, &mut writer, &service);
}

fn write_storage_failure(writer: &mut impl Write) {
    let _ = write_response(
        writer,
        &BridgeResponse::failure(BridgeErrorCode::StorageUnavailable),
    );
}
