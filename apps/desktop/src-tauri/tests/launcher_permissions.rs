use serde_json::{json, Value};
use std::{collections::BTreeSet, fs, path::Path};

fn config(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(name);
    serde_json::from_str(&fs::read_to_string(path).expect("configuration must exist")).unwrap()
}

fn permissions(value: &Value) -> BTreeSet<String> {
    value["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn main_has_only_library_launcher_status_autostart_and_guarded_updater_commands() {
    let main = config("capabilities/default.json");
    assert_eq!(main["windows"], json!(["main"]));
    assert_eq!(
        permissions(&main),
        BTreeSet::from(
            [
                "allow-list-clips",
                "allow-create-clip",
                "allow-update-clip",
                "allow-delete-clip",
                "allow-set-clip-pinned",
                "allow-copy-clip-content",
                "allow-open-clip-source",
                "allow-open-extension-listing",
                "allow-merge-clips",
                "allow-unmerge-group-member",
                "allow-unmerge-group",
                "allow-delete-group-member",
                "allow-delete-group",
                "allow-set-group-pinned",
                "allow-rename-group",
                "allow-get-launcher-status",
                "allow-get-autostart-enabled",
                "allow-set-autostart-enabled",
                "allow-get-update-status",
                "allow-check-for-updates",
                "allow-download-update",
                "allow-cancel-update",
                "allow-dismiss-update",
                "allow-restart-to-update",
                "allow-connect-installation-safety",
                "allow-get-installation-safety-status",
                "allow-acquire-installation-lease",
                "allow-release-installation-lease",
                "allow-acknowledge-installation-safety",
                "allow-hide-main-after-inline-save",
                "core:event:allow-listen",
                "core:event:allow-unlisten",
                "core:app:allow-version",
            ]
            .map(str::to_owned)
        )
    );
}

#[test]
fn launcher_has_only_create_update_delete_read_copy_lifecycle_and_event_subscriptions() {
    let launcher = config("capabilities/launcher.json");
    assert_eq!(launcher["windows"], json!(["launcher"]));
    assert!(!permissions(&launcher).contains("allow-hide-main-after-inline-save"));
    assert_eq!(
        permissions(&launcher),
        BTreeSet::from(
            [
                "allow-list-clips",
                "allow-create-clip",
                "allow-update-clip",
                "allow-delete-clip",
                "allow-copy-clip-content",
                "allow-open-clip-source",
                "allow-launcher-ready",
                "allow-hide-launcher",
                "allow-open-tin-from-launcher",
                "allow-connect-installation-safety",
                "allow-get-installation-safety-status",
                "allow-acquire-installation-lease",
                "allow-release-installation-lease",
                "allow-acknowledge-installation-safety",
                "core:event:allow-listen",
                "core:event:allow-unlisten",
                "core:window:allow-start-dragging",
            ]
            .map(str::to_owned)
        )
    );
}

#[test]
fn every_application_command_is_registered_in_generated_acl_metadata() {
    let manifests = config("gen/schemas/acl-manifests.json");
    let permissions = &manifests["__app-acl__"]["permissions"];
    for command in [
        "list_clips",
        "create_clip",
        "update_clip",
        "delete_clip",
        "set_clip_pinned",
        "copy_clip_content",
        "open_clip_source",
        "open_extension_listing",
        "merge_clips",
        "unmerge_group_member",
        "unmerge_group",
        "delete_group_member",
        "delete_group",
        "set_group_pinned",
        "rename_group",
        "get_launcher_status",
        "launcher_ready",
        "hide_launcher",
        "open_tin_from_launcher",
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
    ] {
        let allow = format!("allow-{}", command.replace('_', "-"));
        assert_eq!(
            permissions[&allow]["commands"]["allow"],
            json!([command]),
            "{command} must be ACL-restricted"
        );
    }
}
