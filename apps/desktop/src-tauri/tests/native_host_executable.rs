const NATIVE_HOST_SOURCE: &str = include_str!("../src/bin/ai-clip-memory-native-host.rs");

#[test]
fn executable_reserves_stdout_for_framed_protocol_writes() {
    for forbidden in [
        "println!",
        "print!",
        "dbg!",
        "tracing::",
        "log::",
        "eprintln!",
    ] {
        assert!(
            !NATIVE_HOST_SOURCE.contains(forbidden),
            "native-host source must not contain {forbidden}"
        );
    }

    assert!(NATIVE_HOST_SOURCE.contains("run_with_storage("));
    assert!(NATIVE_HOST_SOURCE.contains("InstallationGate::for_current_user()"));
    assert!(!NATIVE_HOST_SOURCE.contains("for_current_executable"));
    assert!(NATIVE_HOST_SOURCE.contains("gate.admit()"));
    assert!(!NATIVE_HOST_SOURCE.contains("StorageState::new"));
    assert!(NATIVE_HOST_SOURCE.contains("write_response"));
    let bridge = include_str!("../src/bridge/native_host.rs");
    let wrapper = bridge.split("pub fn run_with_storage").nth(1).unwrap();
    assert!(wrapper.find("let Ok(_permit)").unwrap() < wrapper.find("StorageState::new").unwrap());
    assert!(
        wrapper.find("storage.service()").unwrap()
            < wrapper.find("run_once(reader, writer, &service)").unwrap()
    );
    assert!(bridge.contains("writer.flush()"));
}

#[test]
fn maintenance_export_dispatch_is_separate_from_native_framing_and_sql() {
    let main = NATIVE_HOST_SOURCE.split_once("fn main()").unwrap().1;
    let mode = main.find("--export-maintenance-handle").unwrap();
    let exit = main.find("std::process::exit").unwrap();
    assert!(mode < exit);
    assert!(exit < main.find("let stdin = io::stdin()").unwrap());
    assert!(exit < main.find("dirs::data_dir()").unwrap());
    let compact: String = main[..exit]
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    assert!(compact.contains("export_maintenance_handle_with(pid,|handle|"));
    assert!(main[..exit].contains("write!(output, \"{handle}\")?"));
    assert!(main[..exit].contains("output.flush()"));
    assert!(!main[..exit].contains("write_response"));
    assert!(!main[..exit].contains("run_with_storage"));
    assert!(!NATIVE_HOST_SOURCE.contains("SLATE_GATE_TEST_ROOT"));
}
