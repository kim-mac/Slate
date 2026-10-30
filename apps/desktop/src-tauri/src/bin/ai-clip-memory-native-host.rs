#[cfg(feature = "macos-dev")]
include!("../macos_dev/inert_host.rs");

#[cfg(not(feature = "macos-dev"))]
use std::io::{self, Write};

#[cfg(not(feature = "macos-dev"))]
use ai_clip_memory_desktop_lib::app_paths::APP_IDENTIFIER;
#[cfg(not(feature = "macos-dev"))]
use ai_clip_memory_desktop_lib::bridge::native_host::{run_with_storage, write_response};
#[cfg(not(feature = "macos-dev"))]
use ai_clip_memory_desktop_lib::bridge::protocol::{BridgeErrorCode, BridgeResponse};
#[cfg(all(windows, not(feature = "macos-dev")))]
use ai_clip_memory_desktop_lib::installation_safety::gate::InstallationGate;

#[cfg(not(feature = "macos-dev"))]
fn main() {
    if cfg!(feature = "ux-dev") {
        // No protocol output, SQLite access or process-gate access in this mode.
        return;
    }
    // This separate installer mode must run before any native protocol or data
    // directory bootstrap. It emits only a handle; failure has no stdout payload.
    let mut arguments = std::env::args_os().skip(1);
    if arguments.next().as_deref() == Some(std::ffi::OsStr::new("--export-maintenance-handle")) {
        #[cfg(windows)]
        let result = (|| -> io::Result<()> {
            let pid = arguments
                .next()
                .and_then(|value| value.to_str()?.parse::<u32>().ok())
                .filter(|_| arguments.next().is_none())
                .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
            let handle = InstallationGate::for_current_user()?.export_maintenance_handle(pid)?;
            let mut output = io::stdout().lock();
            write!(output, "{handle}")?;
            output.flush()
        })();
        #[cfg(not(windows))]
        let result = Err::<(), _>(io::Error::from(io::ErrorKind::Unsupported));
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    let Some(data_directory) = dirs::data_dir() else {
        write_storage_failure(&mut writer);
        return;
    };
    #[cfg(windows)]
    let admission = InstallationGate::for_current_user().and_then(|gate| gate.admit());
    #[cfg(not(windows))]
    let admission = Ok::<_, io::Error>(());
    // The wrapper owns admission through run_once and its final response flush.
    let _ = run_with_storage(
        &mut reader,
        &mut writer,
        data_directory.join(APP_IDENTIFIER),
        admission,
    );
}

#[cfg(not(feature = "macos-dev"))]
fn write_storage_failure(writer: &mut impl Write) {
    let _ = write_response(
        writer,
        &BridgeResponse::failure(BridgeErrorCode::StorageUnavailable),
    );
}
