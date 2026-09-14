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
fn main_has_only_library_launcher_status_and_autostart_commands() {
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
                "allow-get-launcher-status",
                "allow-get-autostart-enabled",
                "allow-set-autostart-enabled",
            ]
            .map(str::to_owned)
        )
    );
}

#[test]
fn launcher_has_only_read_copy_lifecycle_and_event_subscriptions() {
    let launcher = config("capabilities/launcher.json");
    assert_eq!(launcher["windows"], json!(["launcher"]));
    assert_eq!(
        permissions(&launcher),
        BTreeSet::from(
            [
                "allow-list-clips",
                "allow-copy-clip-content",
                "allow-launcher-ready",
                "allow-hide-launcher",
                "core:event:allow-listen",
                "core:event:allow-unlisten",
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
        "get_launcher_status",
        "launcher_ready",
        "hide_launcher",
        "get_autostart_enabled",
        "set_autostart_enabled",
    ] {
        let allow = format!("allow-{}", command.replace('_', "-"));
        assert_eq!(
            permissions[&allow]["commands"]["allow"],
            json!([command]),
            "{command} must be ACL-restricted"
        );
    }
}
