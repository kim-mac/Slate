use std::fs;
use std::io::{self, Cursor, Read};

use ai_clip_memory_desktop_lib::app_paths::clip_database_path;
use ai_clip_memory_desktop_lib::bridge::native_host::{run_once, MAX_MESSAGE_BYTES};
use ai_clip_memory_desktop_lib::clips::ClipService;
use serde_json::{json, Value};

fn request(content: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "version": 1,
        "type": "capture_clip",
        "payload": {
            "content": content,
            "contentType": "text",
            "sourceApp": "ChatGPT",
            "sourceUrl": "https://chatgpt.com/c/example",
            "sourcePageTitle": "Example conversation",
        },
    }))
    .expect("the test request should serialize")
}

fn link_request(url: &str, title: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "version": 1,
        "type": "capture_clip",
        "payload": {
            "content": url,
            "contentType": "link",
            "sourceApp": "Other Web",
            "sourceUrl": url,
            "sourcePageTitle": title,
        },
    }))
    .expect("the test request should serialize")
}

fn frame(body: &[u8]) -> Vec<u8> {
    let length = u32::try_from(body.len()).expect("the test body should fit in a frame");
    let mut framed = length.to_ne_bytes().to_vec();
    framed.extend_from_slice(body);
    framed
}

fn response(output: &[u8]) -> Value {
    assert!(output.len() >= 4, "a response frame should have a prefix");
    let length = u32::from_ne_bytes(output[..4].try_into().expect("prefix should be four bytes"));
    let body = &output[4..];
    assert_eq!(body.len(), length as usize);
    serde_json::from_slice(body).expect("the response body should be JSON")
}

fn service_at(path: &std::path::Path) -> ClipService {
    ClipService::open(path).expect("the temporary database should open")
}

#[test]
fn persists_a_valid_capture_in_the_same_database_path_used_by_the_gui() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let database_path = clip_database_path(directory.path());
    fs::create_dir_all(
        database_path
            .parent()
            .expect("the database should have a parent directory"),
    )
    .expect("the application data directory should be created");
    let service = service_at(&database_path);
    let sensitive_content = "  exact content with 'quotes'\n  and indentation\n";
    let mut output = Vec::new();

    run_once(
        &mut Cursor::new(frame(&request(sensitive_content))),
        &mut output,
        &service,
    )
    .expect("the host should process a valid frame");

    let result = response(&output);
    let clip_id = result["clipId"]
        .as_str()
        .expect("success should return a clip ID");
    drop(service);

    let gui_service = service_at(&clip_database_path(directory.path()));
    let stored = gui_service
        .get(clip_id)
        .expect("the existing database should be readable")
        .expect("the native-host clip should be visible to the GUI service");
    assert_eq!(stored.content, sensitive_content);
    assert_eq!(stored.source_app.as_deref(), Some("ChatGPT"));
    assert_eq!(
        result,
        json!({ "version": 1, "ok": true, "clipId": clip_id })
    );
}

#[test]
fn persists_a_valid_page_link_through_the_existing_clip_service() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let database_path = clip_database_path(directory.path());
    fs::create_dir_all(
        database_path
            .parent()
            .expect("the database should have a parent directory"),
    )
    .expect("the application data directory should be created");
    let service = service_at(&database_path);
    let url = "https://example.com/Path?query=One#Section";
    let title = "Exact page title";
    let mut output = Vec::new();

    run_once(
        &mut Cursor::new(frame(&link_request(url, title))),
        &mut output,
        &service,
    )
    .expect("the host should process a valid Link frame");

    let result = response(&output);
    let clip_id = result["clipId"]
        .as_str()
        .expect("success should return a clip ID");
    let stored = service
        .get(clip_id)
        .expect("the existing database should be readable")
        .expect("the page Link should be persisted through ClipService");
    assert_eq!(stored.content, url);
    assert_eq!(stored.content_type, "link");
    assert_eq!(stored.title.as_deref(), Some(title));
    assert_eq!(stored.source_url.as_deref(), Some(url));
    assert_eq!(stored.source_page_title.as_deref(), Some(title));
}

#[test]
fn frames_responses_with_a_native_byte_order_length_prefix() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = service_at(&directory.path().join("clips.sqlite3"));
    let mut output = Vec::new();

    run_once(
        &mut Cursor::new(frame(&request("content"))),
        &mut output,
        &service,
    )
    .expect("the host should write a response");

    let declared = u32::from_ne_bytes(output[..4].try_into().expect("prefix should be four bytes"));
    assert_eq!(declared as usize, output.len() - 4);
}

#[test]
fn treats_truncated_frames_as_safe_failures() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = service_at(&directory.path().join("clips.sqlite3"));

    for input in [vec![1, 2], frame(b"{}")[..5].to_vec()] {
        let mut output = Vec::new();
        run_once(&mut Cursor::new(input), &mut output, &service)
            .expect("a truncated request should produce a safe response");
        assert_eq!(
            response(&output),
            json!({ "version": 1, "ok": false, "error": "malformed_message" })
        );
    }
}

#[test]
fn treats_invalid_utf8_and_malformed_json_as_safe_failures() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = service_at(&directory.path().join("clips.sqlite3"));

    for (body, error) in [
        (vec![0xff], "malformed_message"),
        (br#"{"version":1"#.to_vec(), "malformed_json"),
    ] {
        let mut output = Vec::new();
        run_once(&mut Cursor::new(frame(&body)), &mut output, &service)
            .expect("an invalid request should produce a safe response");
        assert_eq!(
            response(&output),
            json!({ "version": 1, "ok": false, "error": error })
        );
    }
}

struct PrefixOnlyReader {
    prefix: Cursor<[u8; 4]>,
}

impl PrefixOnlyReader {
    fn oversized() -> Self {
        Self {
            prefix: Cursor::new((MAX_MESSAGE_BYTES + 1).to_ne_bytes()),
        }
    }
}

impl Read for PrefixOnlyReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.prefix.position() < 4 {
            return self.prefix.read(buffer);
        }
        panic!("an oversized body must be rejected before any body read or allocation");
    }
}

#[test]
fn rejects_oversized_messages_before_reading_the_declared_body() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = service_at(&directory.path().join("clips.sqlite3"));
    let mut output = Vec::new();

    run_once(&mut PrefixOnlyReader::oversized(), &mut output, &service)
        .expect("an oversized request should produce a safe response");

    assert_eq!(
        response(&output),
        json!({ "version": 1, "ok": false, "error": "message_too_large" })
    );
}

#[test]
fn accepts_the_one_mebibyte_boundary() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = service_at(&directory.path().join("clips.sqlite3"));
    let body = vec![b' '; MAX_MESSAGE_BYTES as usize];
    let mut output = Vec::new();

    run_once(&mut Cursor::new(frame(&body)), &mut output, &service)
        .expect("a boundary-sized request should be read and validated");

    assert_eq!(
        response(&output),
        json!({ "version": 1, "ok": false, "error": "malformed_json" })
    );
}

#[test]
fn hides_storage_failures_and_database_details() {
    let directory = tempfile::tempdir().expect("a temporary directory should be created");
    let database_path = directory.path().join("clips.sqlite3");
    let service = service_at(&database_path);
    fs::remove_file(&database_path).expect("the database file should be removable");
    fs::create_dir(&database_path).expect("a directory should replace the database file");
    let mut output = Vec::new();

    run_once(
        &mut Cursor::new(frame(&request("sensitive content"))),
        &mut output,
        &service,
    )
    .expect("a storage failure should produce a safe response");

    let result = response(&output);
    assert_eq!(
        result,
        json!({ "version": 1, "ok": false, "error": "storage_unavailable" })
    );
    assert!(!String::from_utf8_lossy(&output).contains("sensitive content"));
    assert!(!String::from_utf8_lossy(&output).contains("clips.sqlite3"));
}
