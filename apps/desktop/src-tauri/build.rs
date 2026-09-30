fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_clips",
            "merge_clips",
            "unmerge_group_member",
            "unmerge_group",
            "delete_group_member",
            "delete_group",
            "set_group_pinned",
            "create_clip",
            "update_clip",
            "delete_clip",
            "set_clip_pinned",
            "copy_clip_content",
            "open_clip_source",
            "launcher_ready",
            "hide_launcher",
            "open_tin_from_launcher",
            "get_launcher_status",
            "get_autostart_enabled",
            "set_autostart_enabled",
        ]),
    ))
    .expect("failed to build application permissions");
}
