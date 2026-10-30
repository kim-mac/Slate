// M1 deliberately supports no standalone browser host, including maintenance mode.
// This entry point has no application-library imports, argument/stdin processing,
// filesystem/environment access, updater transport, registration or GUI startup.
fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(78)
}
