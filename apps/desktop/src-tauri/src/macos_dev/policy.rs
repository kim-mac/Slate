//! Dependency-free policy, also exercised directly with rustc on Windows.
use std::path::{Path, PathBuf};

pub const IDENTIFIER: &str = "com.aiclipmemory.desktop.macos-dev";
pub const TITLE: &str = "Slate macOS Development";
pub const STORE_ID: [u8; 16] = [
    83, 108, 97, 116, 101, 77, 49, 68, 101, 118, 83, 116, 111, 114, 101, 49,
];

pub fn validate_build(
    os: &str,
    debug: bool,
    macos_dev: bool,
    ux_dev: bool,
) -> Result<(), &'static str> {
    if (os == "macos" && !macos_dev) || (macos_dev && (os != "macos" || !debug || ux_dev)) {
        return Err("explicit, exclusive macOS debug development profile required");
    }
    Ok(())
}
pub fn data_path(home: &Path) -> Result<PathBuf, &'static str> {
    if !home.is_absolute()
        || home
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("absolute trusted account home required");
    }
    Ok(home
        .join("Library")
        .join("Application Support")
        .join(IDENTIFIER))
}
pub fn validate_darwin(release: &str) -> Result<(), &'static str> {
    let parts: Vec<_> = release.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err("unrecognized Darwin version");
    }
    if parts[0]
        .parse::<u32>()
        .map_err(|_| "invalid Darwin version")?
        < 23
    {
        return Err("macOS 14 or newer required for isolated WKWebView storage");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_explicit_macos_debug_profile_is_accepted() {
        assert_eq!(validate_build("macos", true, true, false), Ok(()));
        for (os, debug, macos_dev, ux_dev) in [
            ("macos", true, false, false),
            ("macos", false, true, false),
            ("macos", true, true, true),
            ("windows", true, true, false),
            ("linux", true, true, false),
        ] {
            assert!(validate_build(os, debug, macos_dev, ux_dev).is_err());
        }
        assert!(validate_build("windows", false, false, false).is_ok());
        assert!(validate_build("windows", true, false, true).is_ok());
    }
    #[test]
    fn profile_has_fixed_development_suffix_and_no_caller_override() {
        let home = std::env::temp_dir();
        assert_eq!(
            data_path(&home).unwrap(),
            home.join("Library")
                .join("Application Support")
                .join(IDENTIFIER)
        );
        assert!(data_path(Path::new("relative")).is_err());
        assert!(data_path(Path::new("")).is_err());
        assert_ne!(IDENTIFIER, "com.aiclipmemory.desktop");
        assert_ne!(IDENTIFIER, "com.aiclipmemory.desktop.ux-dev");
    }
    #[test]
    fn persistent_wk_store_requires_macos_14_or_newer() {
        for value in ["23.0.0", "24.6.0", "25.1.0"] {
            assert!(validate_darwin(value).is_ok());
        }
        for value in [
            "22.6.0",
            "",
            "Darwin 24",
            "24",
            "24.x.1",
            "24.0.0\nextra",
            "-24.0.0",
        ] {
            assert!(validate_darwin(value).is_err(), "{value}");
        }
        assert_ne!(STORE_ID, [0; 16]);
    }
}
