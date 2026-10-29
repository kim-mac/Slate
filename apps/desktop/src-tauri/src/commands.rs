use crate::installation_safety::SafetyCoordinator;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;
use uuid::Uuid;

use crate::clips::{
    Clip, ClipGroup, ClipService, CreateClip, LibraryItem, LibraryItemRef, UpdateClip,
};
use crate::platform;
use crate::storage::{StorageBootstrapError, StorageState};

const MAX_CONTENT_BYTES: usize = 1024 * 1024;
const MAX_METADATA_BYTES: usize = 16 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TitleEdit {
    // A missing field must not silently acquire the meaning of expected NULL.
    #[serde(deserialize_with = "deserialize_nullable_title")]
    expected_title: Option<String>,
}

fn deserialize_nullable_title<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

fn validate_title(title: Option<String>, required: bool) -> Result<Option<String>, CommandError> {
    if title
        .as_ref()
        .is_some_and(|title| title.len() > MAX_METADATA_BYTES)
    {
        return Err(CommandError::new(
            "title_too_large",
            "Title must be 16 KiB or less in UTF-8.",
        ));
    }
    if title
        .as_ref()
        .is_some_and(|title| title.contains(['\r', '\n']))
    {
        return Err(CommandError::new(
            "invalid_title",
            "Title must be a single line.",
        ));
    }
    let normalized = normalize_optional(title);
    if required && normalized.is_none() {
        return Err(CommandError::new(
            "invalid_title",
            "Group title is required.",
        ));
    }
    Ok(normalized)
}

fn validate_edit_mode(content_only: bool, title_only: bool) -> Result<(), CommandError> {
    if content_only && title_only {
        return Err(CommandError::new(
            "invalid_edit_mode",
            "Choose one clip field to edit.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_autostart_enabled(
    app: AppHandle,
    safety: State<'_, Arc<SafetyCoordinator>>,
) -> Result<bool, CommandError> {
    let _permit = safety.admit().map_err(|_| {
        CommandError::new(
            "installation_preparing",
            "Startup status is temporarily unavailable.",
        )
    })?;
    platform::get_autostart_enabled(&app).map_err(|_| {
        CommandError::new(
            "startup_state_unavailable",
            "Windows startup status is unavailable.",
        )
    })
}

#[tauri::command]
pub async fn set_autostart_enabled(
    app: AppHandle,
    safety: State<'_, Arc<SafetyCoordinator>>,
    enabled: bool,
) -> Result<bool, CommandError> {
    let _permit = safety.admit().map_err(|_| {
        CommandError::new(
            "installation_preparing",
            "Startup changes are temporarily unavailable.",
        )
    })?;
    platform::set_autostart_enabled(&app, enabled).map_err(|_| {
        CommandError::new(
            "startup_update_failed",
            "Windows startup could not be updated.",
        )
    })
}

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

fn validate_clip_content(content: &str) -> Result<(), CommandError> {
    if content.trim().is_empty() {
        return Err(CommandError::new(
            "invalid_content",
            "Clip content is required.",
        ));
    }

    if content.len() > MAX_CONTENT_BYTES {
        return Err(CommandError::new(
            "content_too_large",
            "Clip content must be 1 MiB or less in UTF-8.",
        ));
    }
    Ok(())
}

fn validate_update_input(
    input: CreateClip,
    content_only: bool,
) -> Result<CreateClip, CommandError> {
    if content_only {
        validate_clip_content(&input.content)?;
        Ok(input)
    } else {
        validate_clip_input(input)
    }
}

fn validate_clip_input(mut input: CreateClip) -> Result<CreateClip, CommandError> {
    validate_clip_content(&input.content)?;
    if [
        input.title.as_ref(),
        input.source_app.as_ref(),
        input.source_url.as_ref(),
        input.source_page_title.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|value| value.len() > MAX_METADATA_BYTES)
    {
        return Err(CommandError::new(
            "metadata_too_large",
            "Each optional metadata field must be 16 KiB or less in UTF-8.",
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

#[cfg(test)]
fn list_clips_with_service(service: &ClipService) -> Result<Vec<Clip>, CommandError> {
    service.list().map_err(|_| storage_error())
}

#[cfg(test)]
fn create_clip_with_service(
    service: &ClipService,
    input: CreateClip,
) -> Result<Clip, CommandError> {
    let input = validate_clip_input(input)?;
    service.create(input).map_err(|_| storage_error())
}

#[cfg(test)]
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

#[cfg(test)]
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

#[cfg(test)]
fn delete_clip_with_service(service: &ClipService, id: &str) -> Result<(), CommandError> {
    validate_clip_id(id)?;
    match service.delete(id).map_err(|_| storage_error())? {
        true => Ok(()),
        false => Err(not_found_error()),
    }
}

#[cfg(test)]
fn clip_content_with_service(service: &ClipService, id: &str) -> Result<String, CommandError> {
    Ok(stored_clip(service, id)?.content)
}

#[cfg(test)]
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

#[cfg(test)]
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

fn bootstrap_error(error: StorageBootstrapError) -> CommandError {
    match error {
        StorageBootstrapError::EstablishedDatabaseMissing => CommandError::new(
            "storage_missing",
            "The established local clip database is missing. Restore it, or explicitly delete app data before reinstalling to start over.",
        ),
        StorageBootstrapError::Unavailable => storage_error(),
    }
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

fn group_operation_error() -> CommandError {
    CommandError::new(
        "group_operation_failed",
        "The merged clips changed. Refresh the library and try again.",
    )
}

fn validate_library_item_refs(selected: &[LibraryItemRef]) -> Result<(), CommandError> {
    if selected.len() < 2 {
        return Err(CommandError::new(
            "merge_requires_two_items",
            "Select at least two clips to merge.",
        ));
    }
    for item in selected {
        match item {
            LibraryItemRef::Clip { id } | LibraryItemRef::Group { id } => {
                validate_clip_id(id)?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_clips(storage: State<'_, StorageState>) -> Result<Vec<LibraryItem>, CommandError> {
    storage
        .with_service(ClipService::list_library_items)
        .map_err(bootstrap_error)
}

#[tauri::command]
pub fn merge_clips(
    storage: State<'_, StorageState>,
    selected: Vec<LibraryItemRef>,
) -> Result<ClipGroup, CommandError> {
    validate_library_item_refs(&selected)?;
    storage
        .with_service(|service| service.merge(&selected))
        .map_err(|_| group_operation_error())
}

#[tauri::command]
pub fn unmerge_group_member(
    storage: State<'_, StorageState>,
    group_id: String,
    clip_id: String,
) -> Result<(), CommandError> {
    validate_clip_id(&group_id)?;
    validate_clip_id(&clip_id)?;
    match storage
        .with_service(|service| service.unmerge_member(&group_id, &clip_id))
        .map_err(|_| group_operation_error())?
    {
        true => Ok(()),
        false => Err(not_found_error()),
    }
}

#[tauri::command]
pub fn unmerge_group(
    storage: State<'_, StorageState>,
    group_id: String,
) -> Result<(), CommandError> {
    validate_clip_id(&group_id)?;
    match storage
        .with_service(|service| service.unmerge_group(&group_id))
        .map_err(|_| group_operation_error())?
    {
        true => Ok(()),
        false => Err(not_found_error()),
    }
}

#[tauri::command]
pub fn delete_group_member(
    storage: State<'_, StorageState>,
    group_id: String,
    clip_id: String,
) -> Result<(), CommandError> {
    validate_clip_id(&group_id)?;
    validate_clip_id(&clip_id)?;
    match storage
        .with_service(|service| service.delete_member(&group_id, &clip_id))
        .map_err(|_| group_operation_error())?
    {
        true => Ok(()),
        false => Err(not_found_error()),
    }
}

#[tauri::command]
pub fn delete_group(
    storage: State<'_, StorageState>,
    group_id: String,
    expected_member_ids: Vec<String>,
) -> Result<(), CommandError> {
    delete_group_from_storage(&storage, &group_id, &expected_member_ids)
}

// The command and its tests share this complete delegation, including normal
// storage admission, input validation and the transactional membership guard.
fn delete_group_from_storage(
    storage: &StorageState,
    group_id: &str,
    expected_member_ids: &[String],
) -> Result<(), CommandError> {
    validate_clip_id(group_id)?;
    for id in expected_member_ids {
        validate_clip_id(id)?;
    }
    match storage
        .with_service(|service| service.delete_group(group_id, expected_member_ids))
        .map_err(bootstrap_error)?
    {
        true => Ok(()),
        false => Err(CommandError::new(
            "group_changed",
            "This group changed. Review its clips before deleting.",
        )),
    }
}

#[tauri::command]
pub fn set_group_pinned(
    storage: State<'_, StorageState>,
    group_id: String,
    is_pinned: bool,
) -> Result<ClipGroup, CommandError> {
    validate_clip_id(&group_id)?;
    storage
        .with_service(|service| service.set_group_pinned(&group_id, is_pinned))
        .map_err(bootstrap_error)?
        .ok_or_else(not_found_error)
}

#[tauri::command]
pub fn rename_group(
    storage: State<'_, StorageState>,
    group_id: String,
    title: String,
    expected_state: String,
) -> Result<ClipGroup, CommandError> {
    validate_clip_id(&group_id)?;
    let title = validate_title(Some(title), true)?.expect("validated required title");
    storage
        .with_service(|service| service.rename_group_if_current(&group_id, &title, &expected_state))
        .map_err(bootstrap_error)?
        .ok_or_else(|| {
            CommandError::new(
                "group_changed",
                "This group changed or was deleted. Refresh the library and try again.",
            )
        })
}

#[tauri::command]
pub fn create_clip(
    storage: State<'_, StorageState>,
    input: CreateClip,
) -> Result<Clip, CommandError> {
    let input = validate_clip_input(input)?;
    storage
        .with_service(|service| service.create(input))
        .map_err(bootstrap_error)
}

#[tauri::command]
pub fn update_clip(
    storage: State<'_, StorageState>,
    id: String,
    input: CreateClip,
    expected_content: Option<String>,
    title_edit: Option<TitleEdit>,
) -> Result<Clip, CommandError> {
    validate_clip_id(&id)?;
    validate_edit_mode(expected_content.is_some(), title_edit.is_some())?;
    if let Some(title_edit) = title_edit {
        let title = validate_title(input.title, false)?;
        return storage
            .with_service(|service| {
                service.update_title(&id, title_edit.expected_title.as_deref(), title.as_deref())
            })
            .map_err(bootstrap_error)?
            .ok_or_else(|| {
                CommandError::new(
                    "clip_changed",
                    "This clip changed or was deleted. Refresh the library and try again.",
                )
            });
    }
    let input = validate_update_input(input, expected_content.is_some())?;
    if let Some(expected_content) = expected_content {
        return storage
            .with_service(|service| service.update_content(&id, &expected_content, &input.content))
            .map_err(bootstrap_error)?
            .ok_or_else(|| {
                CommandError::new(
                    "clip_changed",
                    "This clip changed or was deleted. Refresh the library and try again.",
                )
            });
    }
    let update = UpdateClip {
        content: input.content,
        content_type: input.content_type,
        title: input.title,
        source_app: input.source_app,
        source_url: input.source_url,
        source_page_title: input.source_page_title,
    };
    storage
        .with_service(|service| service.update(&id, update))
        .map_err(bootstrap_error)?
        .ok_or_else(not_found_error)
}

#[tauri::command]
pub fn set_clip_pinned(
    storage: State<'_, StorageState>,
    id: String,
    is_pinned: bool,
) -> Result<Clip, CommandError> {
    validate_clip_id(&id)?;
    storage
        .with_service(|service| {
            if is_pinned {
                service.pin(&id)
            } else {
                service.unpin(&id)
            }
        })
        .map_err(bootstrap_error)?
        .ok_or_else(not_found_error)
}

#[tauri::command]
pub fn delete_clip(storage: State<'_, StorageState>, id: String) -> Result<(), CommandError> {
    validate_clip_id(&id)?;
    match storage
        .with_service(|service| service.delete(&id))
        .map_err(bootstrap_error)?
    {
        true => Ok(()),
        false => Err(not_found_error()),
    }
}

#[tauri::command]
pub fn copy_clip_content(
    app: AppHandle,
    storage: State<'_, StorageState>,
    id: String,
    member_ids: Option<Vec<String>>,
) -> Result<(), CommandError> {
    validate_clip_id(&id)?;
    let permit = storage.admit_operation().map_err(bootstrap_error)?;
    let content = if let Some(member_ids) = member_ids {
        let group = storage
            .with_admitted_service(permit.as_ref(), |service| service.get_group(&id))
            .map_err(bootstrap_error)?
            .ok_or_else(not_found_error)?;
        group_content_for_copy(&group, &member_ids)?
    } else {
        storage
            .with_admitted_service(permit.as_ref(), |service| service.get(&id))
            .map_err(bootstrap_error)?
            .ok_or_else(not_found_error)?
            .content
    };
    app.clipboard()
        .write_text(content)
        .map_err(|_| CommandError::new("clipboard_unavailable", "Could not copy clip content."))
}

fn group_content_for_copy(
    group: &ClipGroup,
    displayed_ids: &[String],
) -> Result<String, CommandError> {
    // The UI supplies display order. Validate complete, unique membership
    // against one read snapshot before using it; never copy a partial/stale set.
    let mut members: std::collections::HashMap<_, _> = group
        .members
        .iter()
        .map(|clip| (clip.id.as_str(), clip.content.as_str()))
        .collect();
    let changed = || {
        CommandError::new(
            "group_changed",
            "This group changed. Refresh it and try copying again.",
        )
    };
    if displayed_ids.len() != members.len() || displayed_ids.is_empty() {
        return Err(changed());
    }
    let mut contents = Vec::with_capacity(displayed_ids.len());
    for id in displayed_ids {
        let content = members.remove(id.as_str()).ok_or_else(changed)?;
        if !content.is_empty() {
            contents.push(content);
        }
    }
    if contents.is_empty() {
        return Err(CommandError::new(
            "empty_content",
            "This group has no content to copy.",
        ));
    }
    Ok(contents.join("\n\n"))
}

#[tauri::command]
pub fn open_clip_source(
    app: AppHandle,
    storage: State<'_, StorageState>,
    id: String,
) -> Result<(), CommandError> {
    validate_clip_id(&id)?;
    let source_url = storage
        .with_service(|service| service.get(&id))
        .map_err(bootstrap_error)?
        .ok_or_else(not_found_error)?
        .source_url
        .ok_or_else(|| CommandError::new("source_url_missing", "This clip has no source URL."))?;
    let parsed = Url::parse(&source_url).map_err(|_| invalid_stored_source_error())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(invalid_stored_source_error());
    }
    app.opener()
        .open_url(source_url, None::<&str>)
        .map_err(|_| CommandError::new("source_open_failed", "Could not open the clip source."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clips::{ClipService, CreateClip};

    fn deletion_fixture() -> (tempfile::TempDir, StorageState, ClipGroup) {
        let directory = tempfile::tempdir().unwrap();
        let storage = StorageState::new(directory.path().into());
        let group = storage
            .with_service(|service| {
                let mut captured = input("A", "text");
                captured.source_url = Some("https://example.com/confirmed-group".into());
                service.create(captured.clone())?;
                service.create(captured)?;
                Ok(service
                    .list_library_items()?
                    .into_iter()
                    .find_map(|item| match item {
                        LibraryItem::Group { group } => Some(group),
                        _ => None,
                    })
                    .unwrap())
            })
            .unwrap();
        (directory, storage, group)
    }

    #[test]
    fn group_delete_command_delegation_rejects_stale_scope_then_requires_new_ids() {
        let (_directory, storage, group) = deletion_fixture();
        let expected: Vec<_> = group.members.iter().map(|clip| clip.id.clone()).collect();
        let current = storage
            .with_service(|service| {
                let mut captured = input("C", "text");
                captured.source_url = group.members[0].source_url.clone();
                service.create(captured)?;
                service.get_group(&group.id)
            })
            .unwrap()
            .unwrap();
        let before = storage
            .with_service(ClipService::list_library_items)
            .unwrap();
        for _ in 0..2 {
            let error = delete_group_from_storage(&storage, &group.id, &expected).unwrap_err();
            assert_eq!(error.code, "group_changed");
            assert_eq!(
                error.message,
                "This group changed. Review its clips before deleting."
            );
            assert_eq!(
                storage
                    .with_service(ClipService::list_library_items)
                    .unwrap(),
                before
            );
        }
        let current_ids: Vec<_> = current.members.iter().map(|clip| clip.id.clone()).collect();
        delete_group_from_storage(&storage, &group.id, &current_ids).unwrap();
        assert!(storage.with_service(ClipService::list).unwrap().is_empty());
        assert_eq!(
            delete_group_from_storage(&storage, &group.id, &current_ids)
                .unwrap_err()
                .code,
            "group_changed"
        );
    }

    #[test]
    fn group_delete_command_invalid_ids_do_not_bootstrap_storage() {
        let directory = tempfile::tempdir().unwrap();
        let storage = StorageState::new(directory.path().into());
        let valid = Uuid::new_v4().to_string();
        assert_eq!(
            delete_group_from_storage(&storage, "invalid", &[])
                .unwrap_err()
                .code,
            "invalid_clip_id"
        );
        assert_eq!(
            delete_group_from_storage(&storage, &valid, &["invalid".into()])
                .unwrap_err()
                .code,
            "invalid_clip_id"
        );
        assert!(!storage.database_path().exists());
        assert!(!storage.marker_path().exists());
    }

    #[test]
    fn group_delete_command_missing_mismatched_empty_or_duplicate_scope_is_safe() {
        let (_directory, storage, group) = deletion_fixture();
        let expected: Vec<_> = group.members.iter().map(|clip| clip.id.clone()).collect();
        let before = storage
            .with_service(ClipService::list_library_items)
            .unwrap();
        for scope in [
            vec![],
            vec![expected[0].clone()],
            vec![expected[0].clone(), expected[0].clone()],
            vec![expected[0].clone(), Uuid::new_v4().to_string()],
        ] {
            assert_eq!(
                delete_group_from_storage(&storage, &group.id, &scope)
                    .unwrap_err()
                    .code,
                "group_changed"
            );
        }
        assert_eq!(
            delete_group_from_storage(&storage, &Uuid::new_v4().to_string(), &expected)
                .unwrap_err()
                .code,
            "group_changed"
        );
        assert_eq!(
            storage
                .with_service(ClipService::list_library_items)
                .unwrap(),
            before
        );
    }

    #[test]
    fn group_delete_command_storage_failure_rolls_back_and_remains_retryable() {
        let (_directory, storage, group) = deletion_fixture();
        let expected: Vec<_> = group.members.iter().map(|clip| clip.id.clone()).collect();
        let before = storage
            .with_service(ClipService::list_library_items)
            .unwrap();
        let connection = rusqlite::Connection::open(storage.database_path()).unwrap();
        connection.execute_batch("CREATE TRIGGER reject_delete BEFORE DELETE ON clips BEGIN SELECT RAISE(ABORT, 'synthetic'); END;").unwrap();
        assert_eq!(
            delete_group_from_storage(&storage, &group.id, &expected)
                .unwrap_err()
                .code,
            "storage_unavailable"
        );
        assert_eq!(
            storage
                .with_service(ClipService::list_library_items)
                .unwrap(),
            before
        );
        connection
            .execute_batch("DROP TRIGGER reject_delete")
            .unwrap();
        delete_group_from_storage(&storage, &group.id, &expected).unwrap();
        assert!(storage.with_service(ClipService::list).unwrap().is_empty());
    }

    #[test]
    fn group_delete_command_keeps_maintenance_admission_protection() {
        let directory = tempfile::tempdir().unwrap();
        let safety = SafetyCoordinator::new();
        let storage = StorageState::with_safety(directory.path().into(), safety.clone());
        let attempt = safety.begin_preparation().unwrap();
        assert_eq!(
            delete_group_from_storage(
                &storage,
                &Uuid::new_v4().to_string(),
                &[Uuid::new_v4().to_string(), Uuid::new_v4().to_string()]
            )
            .unwrap_err()
            .code,
            "storage_unavailable"
        );
        assert!(!storage.database_path().exists());
        drop(attempt);
    }

    #[test]
    fn group_copy_uses_displayed_order_exact_saved_text_and_skips_empty_members() {
        let (_directory, service) = service();
        let mut first_input = input("  First\r\nline 🦀  ", "text");
        first_input.source_url = None;
        let mut second_input = input("Second\n\nline", "code");
        second_input.source_url = None;
        let first = service.create(first_input).unwrap();
        let second = service.create(second_input).unwrap();
        let group = service
            .merge(&[
                LibraryItemRef::clip(first.id.clone()),
                LibraryItemRef::clip(second.id.clone()),
            ])
            .unwrap();
        let before = service.list_library_items().unwrap();
        let order = vec![second.id.clone(), first.id.clone()];
        assert_eq!(
            group_content_for_copy(&group, &order).unwrap(),
            "Second\n\nline\n\n  First\r\nline 🦀  "
        );
        assert_eq!(service.list_library_items().unwrap(), before);

        service
            .update_content(&second.id, &second.content, " latest saved ")
            .unwrap()
            .unwrap();
        let mut current = service.get_group(&group.id).unwrap().unwrap();
        assert_eq!(
            group_content_for_copy(&current, &order).unwrap(),
            " latest saved \n\n  First\r\nline 🦀  "
        );
        current
            .members
            .iter_mut()
            .find(|member| member.id == first.id)
            .unwrap()
            .content
            .clear();
        assert_eq!(
            group_content_for_copy(&current, &order).unwrap(),
            " latest saved "
        );
        current
            .members
            .iter_mut()
            .find(|member| member.id == second.id)
            .unwrap()
            .content
            .clear();
        assert_eq!(
            group_content_for_copy(&current, &order).unwrap_err().code,
            "empty_content"
        );
    }

    #[test]
    fn group_copy_rejects_stale_incomplete_duplicate_or_foreign_displayed_membership() {
        let (_directory, service) = service();
        let mut first_input = input("first", "text");
        first_input.source_url = None;
        let mut second_input = input("second", "text");
        second_input.source_url = None;
        let first = service.create(first_input).unwrap();
        let second = service.create(second_input).unwrap();
        let group = service
            .merge(&[
                LibraryItemRef::clip(first.id.clone()),
                LibraryItemRef::clip(second.id.clone()),
            ])
            .unwrap();
        for order in [
            vec![],
            vec![first.id.clone()],
            vec![first.id.clone(), first.id.clone()],
            vec![first.id.clone(), Uuid::new_v4().to_string()],
            vec![
                first.id.clone(),
                second.id.clone(),
                Uuid::new_v4().to_string(),
            ],
        ] {
            assert_eq!(
                group_content_for_copy(&group, &order).unwrap_err().code,
                "group_changed"
            );
        }
        let order = vec![first.id.clone(), second.id.clone()];
        service.unmerge_member(&group.id, &second.id).unwrap();
        assert!(service.get_group(&group.id).unwrap().is_none());
        // A currently resolved different membership must never be copied partially.
        let mut changed = group;
        changed.members.pop();
        assert_eq!(
            group_content_for_copy(&changed, &order).unwrap_err().code,
            "group_changed"
        );
    }

    #[test]
    fn title_edit_requires_an_explicit_nullable_expected_title() {
        assert!(serde_json::from_str::<TitleEdit>("{}").is_err());
        assert!(serde_json::from_str::<TitleEdit>(r#"{"expectedTitle":17}"#).is_err());
        assert!(
            serde_json::from_str::<TitleEdit>(r#"{"expectedTitle":null}"#)
                .unwrap()
                .expected_title
                .is_none()
        );
        assert_eq!(
            serde_json::from_str::<TitleEdit>(r#"{"expectedTitle":"old"}"#)
                .unwrap()
                .expected_title
                .as_deref(),
            Some("old")
        );
    }

    #[test]
    fn title_commands_validate_exact_bytes_newlines_and_mutually_exclusive_modes() {
        assert_eq!(
            validate_title(Some("  new title  ".into()), false)
                .unwrap()
                .as_deref(),
            Some("new title")
        );
        assert_eq!(validate_title(Some("  ".into()), false).unwrap(), None);
        assert_eq!(validate_title(None, false).unwrap(), None);
        assert_eq!(
            validate_title(Some("  ".into()), true).unwrap_err().code,
            "invalid_title"
        );
        let exact = "é".repeat(MAX_METADATA_BYTES / 2);
        assert_eq!(
            validate_title(Some(exact.clone()), true).unwrap(),
            Some(exact.clone())
        );
        assert_eq!(
            validate_title(Some(format!(" {}", exact)), false)
                .unwrap_err()
                .code,
            "title_too_large"
        );
        for title in ["line\rbreak", "line\nbreak", "\ntrimmed"] {
            assert_eq!(
                validate_title(Some(title.into()), false).unwrap_err().code,
                "invalid_title"
            );
        }
        assert_eq!(
            validate_edit_mode(true, true).unwrap_err().code,
            "invalid_edit_mode"
        );
        for (content, title) in [(false, false), (true, false), (false, true)] {
            assert!(validate_edit_mode(content, title).is_ok());
        }
    }

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
    fn inline_update_validates_content_only_and_preserves_irrelevant_input_metadata() {
        let mut stale = input("  revised content  ", "legacy-kind");
        stale.source_url = Some("file:///legacy-invalid-source".into());
        stale.title = Some("x".repeat(MAX_METADATA_BYTES + 1));
        let validated = validate_update_input(stale.clone(), true).unwrap();
        assert_eq!(validated, stale);
        assert!(validate_update_input(stale, false).is_err());
    }

    #[test]
    fn inline_update_retains_original_empty_and_utf8_content_limits() {
        assert_eq!(
            validate_update_input(input(" \r\n\t ", "text"), true)
                .unwrap_err()
                .code,
            "invalid_content"
        );
        let boundary = "😀".repeat(MAX_CONTENT_BYTES / 4);
        assert_eq!(
            validate_update_input(input(&boundary, "ignored"), true)
                .unwrap()
                .content,
            boundary
        );
        assert_eq!(
            validate_update_input(input(&"😀".repeat(MAX_CONTENT_BYTES / 4 + 1), "text"), true)
                .unwrap_err()
                .code,
            "content_too_large"
        );
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
    fn enforces_utf8_byte_limits_without_truncating() {
        let boundary = "😀".repeat(MAX_CONTENT_BYTES / 4);
        assert_eq!(
            validate_clip_input(input(&boundary, "text"))
                .expect("the exact content boundary should be accepted")
                .content,
            boundary
        );
        let error = validate_clip_input(input(&"😀".repeat(MAX_CONTENT_BYTES / 4 + 1), "text"))
            .expect_err("content over the byte boundary should be rejected");
        assert_eq!(error.code, "content_too_large");

        let mut oversized_metadata = input("content", "text");
        oversized_metadata.title = Some("é".repeat(MAX_METADATA_BYTES / 2 + 1));
        let error = validate_clip_input(oversized_metadata)
            .expect_err("oversized metadata should be rejected");
        assert_eq!(error.code, "metadata_too_large");
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

    #[test]
    fn existing_oversized_rows_remain_usable_and_can_be_reduced() {
        let (_directory, service) = service();
        let legacy = service
            .create(input(&"x".repeat(MAX_CONTENT_BYTES + 1), "text"))
            .expect("a legacy oversized fixture should be stored below the command boundary");
        assert_eq!(list_clips_with_service(&service).unwrap().len(), 1);
        assert_eq!(
            clip_content_with_service(&service, &legacy.id)
                .unwrap()
                .len(),
            MAX_CONTENT_BYTES + 1
        );
        assert!(
            set_clip_pinned_with_service(&service, &legacy.id, true)
                .unwrap()
                .is_pinned
        );
        assert_eq!(
            source_url_with_service(&service, &legacy.id).unwrap(),
            "https://example.com/conversation"
        );
        let reduced = update_clip_with_service(&service, &legacy.id, input("reduced", "text"))
            .expect("reducing a legacy row should be allowed");
        assert_eq!(reduced.content, "reduced");
        delete_clip_with_service(&service, &legacy.id).unwrap();
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
