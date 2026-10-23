#[cfg(not(debug_assertions))]
compile_error!("ux-dev is unavailable in release builds");
#[cfg(not(windows))]
compile_error!("ux-dev requires Windows");
