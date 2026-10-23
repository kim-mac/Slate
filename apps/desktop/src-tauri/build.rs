fn main() {
    if std::env::var_os("CARGO_FEATURE_UX_DEV").is_some()
        && std::env::var("PROFILE").as_deref() != Ok("debug")
    {
        panic!("ux-dev is restricted to the debug build profile");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
        && (std::path::Path::new("tests/installation_safety_contract.rs").is_file()
            || std::path::Path::new("tests/updater_security.rs").is_file())
    {
        // Integration-test names can trigger Windows installer detection. These
        // Cargo directives apply only to test targets, never application binaries.
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED,ID=1");
        println!("cargo:rustc-link-arg-tests=/MANIFESTUAC:level='asInvoker' uiAccess='false'");
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_clips",
            "merge_clips",
            "unmerge_group_member",
            "unmerge_group",
            "delete_group_member",
            "delete_group",
            "set_group_pinned",
            "rename_group",
            "create_clip",
            "update_clip",
            "delete_clip",
            "set_clip_pinned",
            "copy_clip_content",
            "open_clip_source",
            "open_extension_listing",
            "launcher_ready",
            "hide_launcher",
            "open_tin_from_launcher",
            "get_launcher_status",
            "get_autostart_enabled",
            "set_autostart_enabled",
            "get_update_status",
            "check_for_updates",
            "download_update",
            "cancel_update",
            "dismiss_update",
            "restart_to_update",
            "connect_installation_safety",
            "get_installation_safety_status",
            "acquire_installation_lease",
            "release_installation_lease",
            "acknowledge_installation_safety",
            "hide_main_after_inline_save",
        ]),
    ))
    .expect("failed to build application permissions");
}
