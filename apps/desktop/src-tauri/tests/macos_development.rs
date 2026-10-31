// Exercise the same effective-config guard on Windows before macOS CI is run.
#[path = "../src/macos_dev/config.rs"]
mod config;
#[path = "../src/macos_dev/policy.rs"]
mod policy;

fn overlay() -> tauri::Config {
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

fn effective() -> tauri::Config {
    let mut config = overlay();
    config::prepare(&mut config).unwrap();
    config
}

#[test]
fn generated_context_accepts_the_macos_overlay_without_an_untyped_store_literal() {
    // The same macro as the GUI entry point must compile. On Windows, run this
    // with TAURI_CONFIG set to the actual macOS overlay and the probe flag set.
    // Native macOS CI selects that overlay automatically.
    let mut context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    if cfg!(target_os = "macos") || option_env!("SLATE_M1_CODEGEN_PROBE") == Some("1") {
        assert_eq!(context.config().identifier, policy::IDENTIFIER);
        assert_eq!(context.config().app.windows[0].data_store_identifier, None);
        config::prepare_context(
            context.config_mut(),
            option_env!("SLATE_MACOS_DEV_EFFECTIVE_CONFIG")
                .expect("build-time effective configuration required"),
        )
        .unwrap();
        config::validate(context.config()).unwrap();
        assert_eq!(
            context.config().app.windows[0].data_store_identifier,
            Some(policy::STORE_ID)
        );
        assert_eq!(
            serde_json::to_value(context.config()).unwrap(),
            serde_json::to_value(effective()).unwrap()
        );
    }
}

#[test]
fn typed_preparation_is_required_and_preserves_the_exact_persistent_store() {
    let mut config = overlay();
    assert!(config::validate(&config).is_err());
    assert_eq!(config.app.windows[0].data_store_identifier, None);
    assert_eq!(
        policy::STORE_ID,
        [83, 108, 97, 116, 101, 77, 49, 68, 101, 118, 83, 116, 111, 114, 101, 49]
    );
    let mut expected = config.clone();
    expected.app.windows[0].data_store_identifier = Some(policy::STORE_ID);
    config::prepare(&mut config).unwrap();
    assert_eq!(
        serde_json::to_value(&config).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
    let prepared = serde_json::to_value(&config).unwrap();
    assert!(config::prepare(&mut config).is_err());
    assert_eq!(serde_json::to_value(config).unwrap(), prepared);
}

#[test]
fn preparation_rejects_overrides_and_unsafe_configuration_without_mutation() {
    for mutate in [
        (|c: &mut tauri::Config| c.identifier = "com.aiclipmemory.desktop".into())
            as fn(&mut tauri::Config),
        |c| c.app.windows.clear(),
        |c| c.app.windows.push(c.app.windows[0].clone()),
        |c| c.app.windows[0].data_store_identifier = Some([0; 16]),
        |c| c.app.windows[0].data_store_identifier = Some(policy::STORE_ID),
        |c| c.app.windows[0].create = true,
        |c| c.app.windows[0].incognito = true,
        |c| c.app.windows[0].data_directory = Some("unexpected".into()),
        |c| {
            c.plugins.0.insert(
                "updater".into(),
                serde_json::json!({"pubkey":"", "endpoints":["https://example.invalid"]}),
            );
        },
    ] {
        let mut config = overlay();
        mutate(&mut config);
        let before = serde_json::to_value(&config).unwrap();
        assert!(config::prepare(&mut config).is_err());
        assert_eq!(serde_json::to_value(&config).unwrap(), before);
        let serialized = serde_json::to_string(&config).unwrap();
        let mut context = effective();
        let before = serde_json::to_value(&context).unwrap();
        assert!(config::prepare_context(&mut context, &serialized).is_err());
        assert_eq!(serde_json::to_value(context).unwrap(), before);
    }
    let mut context = effective();
    let before = serde_json::to_value(&context).unwrap();
    assert!(config::prepare_context(&mut context, "not JSON").is_err());
    assert_eq!(serde_json::to_value(context).unwrap(), before);
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
        |c| c.app.windows[0].data_store_identifier = Some([0; 16]),
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
