// Exercise the same effective-config guard on Windows before macOS CI is run.
#[path = "../src/macos_dev/config.rs"]
mod config;
#[path = "../src/macos_dev/policy.rs"]
mod policy;

fn effective() -> tauri::Config {
    fn merge(base: &mut serde_json::Value, overlay: serde_json::Value) {
        if let (Some(base), Some(overlay)) = (base.as_object_mut(), overlay.as_object()) {
            for (key, value) in overlay {
                merge(
                    base.entry(key).or_insert(serde_json::Value::Null),
                    value.clone(),
                );
            }
        } else {
            *base = overlay;
        }
    }
    let mut base: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    merge(
        &mut base,
        serde_json::from_str(include_str!("../tauri.macos.conf.json")).unwrap(),
    );
    serde_json::from_value(base).unwrap()
}

#[test]
fn effective_overlay_parses_and_passes_the_production_runtime_guard() {
    config::validate(&effective()).unwrap();
    let production: tauri::Config =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert!(config::validate(&production).is_err());
}

#[test]
fn unsafe_runtime_configuration_is_rejected() {
    for mutate in [
        (|c: &mut tauri::Config| c.identifier = "com.aiclipmemory.desktop".into())
            as fn(&mut tauri::Config),
        |c| c.app.windows[0].create = true,
        |c| {
            c.app.windows[0].url =
                tauri::WebviewUrl::External("https://example.invalid".parse().unwrap())
        },
        |c| c.app.windows[0].data_store_identifier = None,
        |c| c.app.windows[0].incognito = true,
        |c| c.app.windows[0].data_directory = Some("unexpected".into()),
        |c| c.bundle.macos.signing_identity = Some("Developer ID".into()),
        |c| c.bundle.macos.minimum_system_version = Some("13.0".into()),
        |c| {
            c.plugins
                .0
                .insert(
                    "updater".into(),
                    serde_json::json!({"pubkey":"unexpected", "endpoints":[]}),
                )
                .map(|_| ())
                .unwrap_or(())
        },
        |c| {
            c.plugins
                .0
                .insert(
                    "updater".into(),
                    serde_json::json!({"pubkey":"", "endpoints":["https://example.invalid"]}),
                )
                .map(|_| ())
                .unwrap_or(())
        },
    ] {
        let mut config = effective();
        mutate(&mut config);
        assert!(config::validate(&config).is_err());
    }
}
