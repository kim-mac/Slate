use std::str;

use serde::Serialize;
use serde_json::{Map, Value};
use url::Url;

use crate::clips::CreateClip;

pub const BRIDGE_PROTOCOL_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BridgeErrorCode {
    MalformedMessage,
    MalformedJson,
    MessageTooLarge,
    UnsupportedVersion,
    UnsupportedMessageType,
    InvalidPayload,
    InvalidContent,
    InvalidContentType,
    InvalidSourceApp,
    InvalidSourceUrl,
    StorageUnavailable,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum BridgeResponse {
    Success {
        version: u8,
        ok: bool,
        #[serde(rename = "clipId")]
        clip_id: String,
    },
    Failure {
        version: u8,
        ok: bool,
        error: BridgeErrorCode,
    },
}

impl BridgeResponse {
    pub fn success(clip_id: impl Into<String>) -> Self {
        Self::Success {
            version: BRIDGE_PROTOCOL_VERSION,
            ok: true,
            clip_id: clip_id.into(),
        }
    }

    pub fn failure(error: BridgeErrorCode) -> Self {
        Self::Failure {
            version: BRIDGE_PROTOCOL_VERSION,
            ok: false,
            error,
        }
    }
}

pub fn decode_capture_request(body: &[u8]) -> Result<CreateClip, BridgeErrorCode> {
    let body = str::from_utf8(body).map_err(|_| BridgeErrorCode::MalformedMessage)?;
    let value: Value = serde_json::from_str(body).map_err(|_| BridgeErrorCode::MalformedJson)?;
    let envelope = value.as_object().ok_or(BridgeErrorCode::InvalidPayload)?;

    if !has_exact_keys(envelope, &["version", "type", "payload"]) {
        return Err(BridgeErrorCode::InvalidPayload);
    }
    if envelope.get("version").and_then(Value::as_u64) != Some(BRIDGE_PROTOCOL_VERSION.into()) {
        return Err(BridgeErrorCode::UnsupportedVersion);
    }
    if envelope.get("type").and_then(Value::as_str) != Some("capture_clip") {
        return Err(BridgeErrorCode::UnsupportedMessageType);
    }

    let payload = envelope
        .get("payload")
        .and_then(Value::as_object)
        .ok_or(BridgeErrorCode::InvalidPayload)?;
    if !has_exact_keys(
        payload,
        &[
            "content",
            "contentType",
            "sourceApp",
            "sourceUrl",
            "sourcePageTitle",
        ],
    ) {
        return Err(BridgeErrorCode::InvalidPayload);
    }

    let content = string_field(payload, "content")?;
    let content_type = string_field(payload, "contentType")?;
    let source_app = string_field(payload, "sourceApp")?;
    let source_url = string_field(payload, "sourceUrl")?;
    let source_page_title = string_field(payload, "sourcePageTitle")?;

    if content.trim().is_empty() {
        return Err(BridgeErrorCode::InvalidContent);
    }
    if !matches!(content_type, "text" | "link") {
        return Err(BridgeErrorCode::InvalidContentType);
    }
    if !matches!(source_app, "ChatGPT" | "Claude" | "Gemini" | "Other Web") {
        return Err(BridgeErrorCode::InvalidSourceApp);
    }
    let parsed_source_url =
        Url::parse(source_url).map_err(|_| BridgeErrorCode::InvalidSourceUrl)?;
    if !is_http_url_with_host(&parsed_source_url) {
        return Err(BridgeErrorCode::InvalidSourceUrl);
    }

    if content_type == "link" {
        if has_credentials(&parsed_source_url) {
            return Err(BridgeErrorCode::InvalidSourceUrl);
        }
        if content != source_url {
            return Err(BridgeErrorCode::InvalidContent);
        }
        let parsed_content = Url::parse(content).map_err(|_| BridgeErrorCode::InvalidSourceUrl)?;
        if !is_http_url_with_host(&parsed_content) || has_credentials(&parsed_content) {
            return Err(BridgeErrorCode::InvalidSourceUrl);
        }
    }

    let normalized_page_title =
        (!source_page_title.trim().is_empty()).then(|| source_page_title.to_owned());

    Ok(CreateClip {
        content: content.to_owned(),
        content_type: content_type.to_owned(),
        title: (content_type == "link")
            .then(|| normalized_page_title.clone())
            .flatten(),
        source_app: Some(source_app.to_owned()),
        source_url: Some(source_url.to_owned()),
        source_page_title: normalized_page_title,
    })
}

fn is_http_url_with_host(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.has_host()
}

fn has_credentials(url: &Url) -> bool {
    !url.username().is_empty() || url.password().is_some()
}

fn string_field<'a>(
    object: &'a Map<String, Value>,
    name: &str,
) -> Result<&'a str, BridgeErrorCode> {
    object
        .get(name)
        .and_then(Value::as_str)
        .ok_or(BridgeErrorCode::InvalidPayload)
}

fn has_exact_keys(object: &Map<String, Value>, expected: &[&str]) -> bool {
    object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key))
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::{decode_capture_request, BridgeErrorCode, BridgeResponse};

    fn request(payload: Value) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "version": 1,
            "type": "capture_clip",
            "payload": payload,
        }))
        .expect("the test request should serialize")
    }

    fn payload(content: &str) -> Value {
        json!({
            "content": content,
            "contentType": "text",
            "sourceApp": "ChatGPT",
            "sourceUrl": "https://chatgpt.com/c/example",
            "sourcePageTitle": "Example conversation",
        })
    }

    fn link_payload(url: &str) -> Value {
        json!({
            "content": url,
            "contentType": "link",
            "sourceApp": "Other Web",
            "sourceUrl": url,
            "sourcePageTitle": "  Exact page title  ",
        })
    }

    #[test]
    fn decodes_and_maps_the_exact_capture_contract_without_mutating_content() {
        let input = decode_capture_request(&request(payload("  exact content\n")))
            .expect("the valid request should decode");

        assert_eq!(input.content, "  exact content\n");
        assert_eq!(input.content_type, "text");
        assert_eq!(input.title, None);
        assert_eq!(input.source_app.as_deref(), Some("ChatGPT"));
        assert_eq!(
            input.source_url.as_deref(),
            Some("https://chatgpt.com/c/example")
        );
        assert_eq!(
            input.source_page_title.as_deref(),
            Some("Example conversation")
        );
    }

    #[test]
    fn normalizes_only_a_blank_page_title_to_none() {
        let mut value = payload("content");
        value["sourcePageTitle"] = json!("  \n");

        let input = decode_capture_request(&request(value)).expect("the request should decode");

        assert_eq!(input.source_page_title, None);
    }

    #[test]
    fn maps_a_valid_link_capture_without_mutating_url_or_title() {
        let url = "https://example.com/Path?query=One#Section";
        let input = decode_capture_request(&request(link_payload(url)))
            .expect("the valid Link request should decode");

        assert_eq!(input.content, url);
        assert_eq!(input.content_type, "link");
        assert_eq!(input.title.as_deref(), Some("  Exact page title  "));
        assert_eq!(input.source_url.as_deref(), Some(url));
        assert_eq!(
            input.source_page_title.as_deref(),
            Some("  Exact page title  ")
        );
    }

    #[test]
    fn maps_a_blank_link_page_title_to_none() {
        let mut value = link_payload("https://example.com/");
        value["sourcePageTitle"] = json!("  \n");

        let input =
            decode_capture_request(&request(value)).expect("the valid Link request should decode");

        assert_eq!(input.title, None);
        assert_eq!(input.source_page_title, None);
    }

    #[test]
    fn rejects_link_content_that_is_not_the_exact_safe_source_url() {
        for (content, source_url, expected) in [
            (
                "https://example.com/other",
                "https://example.com/page",
                BridgeErrorCode::InvalidContent,
            ),
            (
                "file:///C:/private.txt",
                "file:///C:/private.txt",
                BridgeErrorCode::InvalidSourceUrl,
            ),
            (
                "https://user:secret@example.com/private",
                "https://user:secret@example.com/private",
                BridgeErrorCode::InvalidSourceUrl,
            ),
        ] {
            let mut value = link_payload(source_url);
            value["content"] = json!(content);
            assert_eq!(decode_capture_request(&request(value)), Err(expected),);
        }
    }

    #[test]
    fn serializes_only_the_approved_success_and_failure_shapes() {
        let success = serde_json::to_value(BridgeResponse::success(
            "f7a6c48d-bfd5-4f13-b54d-e238f7cd7842",
        ))
        .expect("success should serialize");
        let failure =
            serde_json::to_value(BridgeResponse::failure(BridgeErrorCode::InvalidSourceUrl))
                .expect("failure should serialize");

        assert_eq!(
            success,
            json!({
                "version": 1,
                "ok": true,
                "clipId": "f7a6c48d-bfd5-4f13-b54d-e238f7cd7842",
            })
        );
        assert_eq!(
            failure,
            json!({
                "version": 1,
                "ok": false,
                "error": "invalid_source_url",
            })
        );
    }

    #[test]
    fn rejects_invalid_utf8_and_malformed_json_safely() {
        assert_eq!(
            decode_capture_request(&[0xff]),
            Err(BridgeErrorCode::MalformedMessage)
        );
        assert_eq!(
            decode_capture_request(br#"{"version":1"#),
            Err(BridgeErrorCode::MalformedJson)
        );
    }

    #[test]
    fn rejects_unsupported_versions_and_message_types() {
        let unsupported_version = br#"{"version":2,"type":"capture_clip","payload":{}}"#;
        let unsupported_type = br#"{"version":1,"type":"delete_clip","payload":{}}"#;

        assert_eq!(
            decode_capture_request(unsupported_version),
            Err(BridgeErrorCode::UnsupportedVersion)
        );
        assert_eq!(
            decode_capture_request(unsupported_type),
            Err(BridgeErrorCode::UnsupportedMessageType)
        );
    }

    #[test]
    fn rejects_missing_extra_or_wrongly_typed_payload_fields() {
        let mut missing = payload("content");
        missing
            .as_object_mut()
            .expect("payload should be an object")
            .remove("sourceUrl");
        let mut extra = payload("content");
        extra["unexpected"] = json!(true);
        let mut wrong_type = payload("content");
        wrong_type["sourcePageTitle"] = json!(12);

        for invalid in [missing, extra, wrong_type] {
            assert_eq!(
                decode_capture_request(&request(invalid)),
                Err(BridgeErrorCode::InvalidPayload)
            );
        }
    }

    #[test]
    fn rejects_extra_envelope_fields() {
        let body = serde_json::to_vec(&json!({
            "version": 1,
            "type": "capture_clip",
            "payload": payload("content"),
            "unexpected": true,
        }))
        .expect("the test request should serialize");

        assert_eq!(
            decode_capture_request(&body),
            Err(BridgeErrorCode::InvalidPayload)
        );
    }

    #[test]
    fn rejects_blank_content_and_wrong_content_type() {
        let mut wrong_type = payload("content");
        wrong_type["contentType"] = json!("code");

        assert_eq!(
            decode_capture_request(&request(payload(" \r\n\t "))),
            Err(BridgeErrorCode::InvalidContent)
        );
        assert_eq!(
            decode_capture_request(&request(wrong_type)),
            Err(BridgeErrorCode::InvalidContentType)
        );
    }

    #[test]
    fn rejects_invalid_source_apps() {
        let mut invalid = payload("content");
        invalid["sourceApp"] = json!("Perplexity");

        assert_eq!(
            decode_capture_request(&request(invalid)),
            Err(BridgeErrorCode::InvalidSourceApp)
        );
    }

    #[test]
    fn rejects_malformed_and_non_http_source_urls() {
        for source_url in ["not a URL", "file:///C:/private.txt", "ftp://example.com/a"] {
            let mut invalid = payload("content");
            invalid["sourceUrl"] = json!(source_url);
            assert_eq!(
                decode_capture_request(&request(invalid)),
                Err(BridgeErrorCode::InvalidSourceUrl)
            );
        }
    }
}
