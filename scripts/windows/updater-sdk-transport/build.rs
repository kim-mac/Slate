fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=windows.manifest");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows.manifest");
        for argument in [
            "/MANIFEST:EMBED,ID=1".to_owned(),
            "/MANIFESTUAC:NO".to_owned(),
            format!("/MANIFESTINPUT:{}", manifest.display()),
        ] {
            println!("cargo:rustc-link-arg-bin=slate-sdk-transport-test={argument}");
        }
    }
}
