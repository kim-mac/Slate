use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;
use uuid::Uuid;

use crate::clips::{Clip, ClipService, CreateClip, UpdateClip};

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    code: &'static str,
    message: &'static str,
}

impl CommandError {
    fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}

fn validate_clip_input(mut input: CreateClip) -> Result<CreateClip, CommandError> {
    if input.content.trim().is_empty() {
        return Err(CommandError::new(
            "invalid_content",
            "Clip content is required.",
        ));
    }

    if !matches!(
        input.content_type.as_str(),
        "text" | "code" | "prompt" | "link"
    ) {
        return Err(CommandError::new(
            "invalid_content_type",
            "Choose a supported clip content type.",
        ));
    }

    input.title = normalize_optional(input.title);
    input.source_app = normalize_optional(input.source_app);
    input.source_url = normalize_optional(input.source_url);
    input.source_page_title = normalize_optional(input.source_page_title);

    if let Some(source_url) = &input.source_url {
        let url = Url::parse(source_url).map_err(|_| {
            CommandError::new(
                "invalid_source_url",
                "Source URL must be a valid HTTP or HTTPS URL.",
            )
        })?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(CommandError::new(
                "invalid_source_url",
                "Source URL must be a valid HTTP or HTTPS URL.",
            ));
        }
    }

    Ok(input)
}

fn validate_clip_id(id: &str) -> Result<&str, CommandError> {
    Uuid::parse_str(id)
        .map(|_| id)
        .map_err(|_| CommandError::new("invalid_clip_id", "Clip ID is invalid."))
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

fn list_clips_with_service(service: &ClipService) -> Result<Vec<Clip>, CommandError> {
    service.list().map_err(|_| storage_error())
}

fn create_clip_with_service(
    service: &ClipService,
    input: CreateClip,
) -> Result<Clip, CommandError> {
    let input = validate_clip_input(input)?;
    service.create(input).map_err(|_| storage_error())
}

fn update_clip_with_service(
    service: &ClipService,
    id: &str,
    input: CreateClip,
) -> Result<Clip, CommandError> {
    validate_clip_id(id)?;
    let input = validate_clip_input(input)?;
    let update = UpdateClip {
        content: input.content,
        content_type: input.content_type,
        title: input.title,
        source_app: input.source_app,
        source_url: input.source_url,
        source_page_title: input.source_page_title,
    };
    service
        .update(id, update)
        .map_err(|_| storage_error())?
        .ok_or_else(not_found_error)
}

fn set_clip_pinned_with_service(
    service: &ClipService,
    id: &str,
    is_pinned: bool,
) -> Result<Clip, CommandError> {
    validate_clip_id(id)?;
    let result = if is_pinned {
        service.pin(id)
    } else {
        service.unpin(id)
    };
    result
        .map_err(|_| storage_error())?
        .ok_or_else(not_found_error)
}

fn delete_clip_with_service(service: &ClipService, id: &str) -> Result<(), CommandError> {
    validate_clip_id(id)?;
    match service.delete(id).map_err(|_| storage_error())? {
        true => Ok(()),
        false => Err(not_found_error()),
    }
}

fn clip_content_with_service(service: &ClipService, id: &str) -> Result<String, CommandError> {
    Ok(stored_clip(service, id)?.content)
}

fn source_url_with_service(service: &ClipService, id: &str) -> Result<String, CommandError> {
    let source_url = stored_clip(service, id)?
        .source_url
        .ok_or_else(|| CommandError::new("source_url_missing", "This clip has no source URL."))?;
    let parsed = Url::parse(&source_url).map_err(|_| invalid_stored_source_error())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(invalid_stored_source_error());
    }
    Ok(source_url)
}

fn stored_clip(service: &ClipService, id: &str) -> Result<Clip, CommandError> {
    validate_clip_id(id)?;
    service
        .get(id)
        .map_err(|_| storage_error())?
        .ok_or_else(not_found_error)
}

fn storage_error() -> CommandError {
    CommandError::new("storage_unavailable", "Local clip storage is unavailable.")
}

fn not_found_error() -> CommandError {
    CommandError::new("clip_not_found", "Clip not found.")
}

fn invalid_stored_source_error() -> CommandError {
    CommandError::new(
        "invalid_source_url",
        "This clip does not have a valid HTTP or HTTPS source URL.",
    )
}

#[tauri::command]
pub fn list_clips(service: State<'_, ClipService>) -> Result<Vec<Clip>, CommandError> {
    list_clips_with_service(&service)
}

#[tauri::command]
pub fn create_clip(
    service: State<'_, ClipService>,
    input: CreateClip,
) -> Result<Clip, CommandError> {
    create_clip_with_service(&service, input)
}

#[tauri::command]
pub fn update_clip(
    service: State<'_, ClipService>,
    id: String,
    input: CreateClip,
) -> Result<Clip, CommandError> {
    update_clip_with_service(&service, &id, input)
}

#[tauri::command]
pub fn set_clip_pinned(
    service: State<'_, ClipService>,
    id: String,
    is_pinned: bool,
) -> Result<Clip, CommandError> {
    set_clip_pinned_with_service(&service, &id, is_pinned)
}

#[tauri::command]
pub fn delete_clip(service: State<'_, ClipService>, id: String) -> Result<(), CommandError> {
    delete_clip_with_service(&service, &id)
}

#[tauri::command]
pub fn copy_clip_content(
    app: AppHandle,
    service: State<'_, ClipService>,
    id: String,
) -> Result<(), CommandError> {
    let content = clip_content_with_service(&service, &id)?;
    app.clipboard()
        .write_text(content)
        .map_err(|_| CommandError::new("clipboard_unavailable", "Could not copy clip content."))
}

#[tauri::command]
pub fn open_clip_source(
    app: AppHandle,
    service: State<'_, ClipService>,
    id: String,
) -> Result<(), CommandError> {
    let source_url = source_url_with_service(&service, &id)?;
    app.opener()
        .open_url(source_url, None::<&str>)
        .map_err(|_| CommandError::new("source_open_failed", "Could not open the clip source."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clips::{ClipService, CreateClip};

    fn service() -> (tempfile::TempDir, ClipService) {
        let directory = tempfile::tempdir().expect("a temporary directory should be created");
        let service = ClipService::open(directory.path().join("clips.sqlite3"))
            .expect("the temporary database should open");
        (directory, service)
    }

    fn input(content: &str, content_type: &str) -> CreateClip {
        CreateClip {
            content: content.to_owned(),
            content_type: content_type.to_owned(),
            title: Some("  Useful title  ".to_owned()),
            source_app: Some("   ".to_owned()),
            source_url: Some("https://example.com/conversation".to_owned()),
            source_page_title: None,
        }
    }

    #[test]
    fn validates_clip_input_without_mutating_nonblank_content() {
        let validated = validate_clip_input(input("  keep this spacing  ", "text"))
            .expect("valid input should be accepted");

        assert_eq!(validated.content, "  keep this spacing  ");
        assert_eq!(validated.title.as_deref(), Some("Useful title"));
        assert_eq!(validated.source_app, None);
    }

    #[test]
    fn rejects_blank_content() {
        let error = validate_clip_input(input(" \r\n\t ", "text"))
            .expect_err("blank content should be rejected");

        assert_eq!(error.code, "invalid_content");
    }

    #[test]
    fn rejects_undocumented_content_types() {
        let error = validate_clip_input(input("content", "html"))
            .expect_err("unsupported content types should be rejected");

        assert_eq!(error.code, "invalid_content_type");
    }

    #[test]
    fn validates_clip_ids_as_uuids() {
        let error = validate_clip_id("not-a-uuid").expect_err("invalid IDs should be rejected");

        assert_eq!(error.code, "invalid_clip_id");
    }

    #[test]
    fn accepts_only_http_or_https_source_urls() {
        let error = validate_clip_input(input("content", "text").with_source_url("file:///tmp/a"))
            .expect_err("local file URLs should be rejected");

        assert_eq!(error.code, "invalid_source_url");
    }

    #[test]
    fn command_core_creates_lists_and_fully_updates_clips() {
        let (_directory, service) = service();
        let created = create_clip_with_service(&service, input("original", "text"))
            .expect("the clip should be created");

        let listed = list_clips_with_service(&service).expect("clips should be listed");
        assert_eq!(listed, [created.clone()]);

        let updated = update_clip_with_service(
            &service,
            &created.id,
            CreateClip {
                content: "updated".to_owned(),
                content_type: "code".to_owned(),
                title: None,
                source_app: None,
                source_url: None,
                source_page_title: None,
            },
        )
        .expect("the clip should be updated");

        assert_eq!(updated.content, "updated");
        assert_eq!(updated.content_type, "code");
        assert_eq!(updated.title, None);
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.created_at, created.created_at);
        assert_eq!(updated.is_pinned, created.is_pinned);
    }

    #[test]
    fn command_core_pins_and_deletes_by_validated_id() {
        let (_directory, service) = service();
        let created = create_clip_with_service(&service, input("content", "text"))
            .expect("the clip should be created");

        let pinned = set_clip_pinned_with_service(&service, &created.id, true)
            .expect("the clip should be pinned");
        assert!(pinned.is_pinned);

        delete_clip_with_service(&service, &created.id).expect("the clip should be deleted");
        let error = clip_content_with_service(&service, &created.id)
            .expect_err("the deleted clip should be missing");
        assert_eq!(error.code, "clip_not_found");
    }

    #[test]
    fn command_core_reads_clipboard_content_and_source_url_from_storage() {
        let (_directory, service) = service();
        let created = create_clip_with_service(&service, input("stored content", "text"))
            .expect("the clip should be created");

        assert_eq!(
            clip_content_with_service(&service, &created.id)
                .expect("stored content should be returned"),
            "stored content"
        );
        assert_eq!(
            source_url_with_service(&service, &created.id)
                .expect("the stored source URL should be returned"),
            "https://example.com/conversation"
        );
    }

    #[test]
    fn command_errors_do_not_expose_database_details() {
        let (directory, service) = service();
        let database_path = directory.path().join("clips.sqlite3");
        std::fs::remove_file(&database_path).expect("the temporary database should be removable");
        std::fs::create_dir(&database_path)
            .expect("a directory should replace the temporary database file");

        let error = list_clips_with_service(&service)
            .expect_err("opening a directory as SQLite should fail safely");

        assert_eq!(error.code, "storage_unavailable");
        assert_eq!(error.message, "Local clip storage is unavailable.");
    }

    trait WithSourceUrl {
        fn with_source_url(self, source_url: &str) -> Self;
    }

    impl WithSourceUrl for CreateClip {
        fn with_source_url(mut self, source_url: &str) -> Self {
            self.source_url = Some(source_url.to_owned());
            self
        }
    }
}
