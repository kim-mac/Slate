fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_clips",
            "create_clip",
            "update_clip",
            "delete_clip",
            "set_clip_pinned",
            "copy_clip_content",
            "open_clip_source",
            "launcher_ready",
            "hide_launcher",
            "get_launcher_status",
        ]),
    ))
    .expect("failed to build application permissions");
}
