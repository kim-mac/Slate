use std::io::{self, Write};

use ai_clip_memory_desktop_lib::app_paths::APP_IDENTIFIER;
use ai_clip_memory_desktop_lib::bridge::native_host::{run_once, write_response};
use ai_clip_memory_desktop_lib::bridge::protocol::{BridgeErrorCode, BridgeResponse};
use ai_clip_memory_desktop_lib::storage::StorageState;

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    let Some(data_directory) = dirs::data_dir() else {
        write_storage_failure(&mut writer);
        return;
    };
    let storage = StorageState::new(data_directory.join(APP_IDENTIFIER));
    let Ok(service) = storage.service() else {
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
