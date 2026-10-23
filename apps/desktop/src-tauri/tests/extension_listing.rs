use serde_json::Value;

#[test]
fn fixed_listing_opener_is_main_only_and_not_an_arbitrary_url_capability() {
    let main: Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
    let launcher: Value =
        serde_json::from_str(include_str!("../capabilities/launcher.json")).unwrap();
    assert_eq!(main["windows"], serde_json::json!(["main"]));
    assert!(main["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "allow-open-extension-listing"));
    assert!(!launcher["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "allow-open-extension-listing"));
    for capability in [main, launcher] {
        assert!(!capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value.as_str().unwrap().starts_with("opener:")));
    }
    let source = include_str!("../src/extension_listing.rs");
    assert!(source.contains("listing_for_window(window.label())?"));
    assert!(source.contains(".admit()"));
    assert!(source.contains(".open_url(url, None::<&str>)"));
    let command = source
        .split("pub fn open_extension_listing(")
        .nth(1)
        .unwrap()
        .split(") ->")
        .next()
        .unwrap();
    assert!(!command.contains("String") && !command.contains("url:") && !command.contains("args:"));
    assert!(include_str!("../src/lib.rs").contains("extension_listing::open_extension_listing"));
    assert!(include_str!("../build.rs").contains("\"open_extension_listing\""));
}
