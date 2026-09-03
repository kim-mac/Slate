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

    assert!(NATIVE_HOST_SOURCE.contains("run_once"));
    assert!(NATIVE_HOST_SOURCE.contains("write_response"));
}
