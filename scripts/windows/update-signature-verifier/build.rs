fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Scope these options to this standalone binary, never Slate or test harnesses.
        // An explicit execution level prevents manifestless installer detection.
        println!("cargo:rustc-link-arg-bin=slate-update-signature-verifier=/MANIFEST:EMBED,ID=1");
        println!(
            "cargo:rustc-link-arg-bin=slate-update-signature-verifier=/MANIFESTUAC:level='asInvoker' uiAccess='false'"
        );
    }
}
