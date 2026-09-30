use std::path::Path;
use std::sync::{Arc, Barrier};
use std::thread;

use ai_clip_memory_desktop_lib::clips::{
    ClipService, CreateClip, LibraryItem, LibraryItemRef, UpdateClip,
};
use chrono::DateTime;
use rusqlite::Connection;
use tempfile::TempDir;
use uuid::Uuid;

fn database_path(temp_directory: &TempDir) -> std::path::PathBuf {
    temp_directory.path().join("clips.sqlite3")
}

#[test]
fn concurrent_first_open_applies_migrations_once_without_racing() {
    for _ in 0..16 {
        let directory = tempfile::tempdir().expect("a temporary directory should be created");
        let path = Arc::new(database_path(&directory));
        let barrier = Arc::new(Barrier::new(3));
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let path = Arc::clone(&path);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    ClipService::open(path.as_ref())
                })
            })
            .collect();
        barrier.wait();
        for handle in handles {
            handle
                .join()
                .expect("the opener thread should not panic")
                .expect("both concurrent first opens should succeed");
        }
    }
}

fn new_clip(content: &str) -> CreateClip {
    CreateClip {
        content: content.to_owned(),
        content_type: "text".to_owned(),
        title: Some("Useful answer".to_owned()),
        source_app: Some("Web".to_owned()),
        source_url: Some("https://example.com/conversation".to_owned()),
        source_page_title: Some("Example conversation".to_owned()),
    }
}

fn updated_clip() -> UpdateClip {
    UpdateClip {
        content: "Updated answer".to_owned(),
        content_type: "code".to_owned(),
        title: Some("Updated title".to_owned()),
        source_app: Some("ChatGPT".to_owned()),
        source_url: Some("https://example.com/updated".to_owned()),
        source_page_title: Some("Updated conversation".to_owned()),
    }
}

fn open_service(path: &Path) -> ClipService {
    ClipService::open(path).expect("the temporary database should open")
}

#[test]
fn migration_creates_the_documented_schema_and_indexes_idempotently() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let path = database_path(&temp_directory);

    drop(open_service(&path));
    drop(open_service(&path));

    let connection = Connection::open(path).expect("the migrated database should open");
    let user_version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("the migration version should be readable");
    assert_eq!(user_version, 2);

    let mut columns = connection
        .prepare("PRAGMA table_info(clips)")
        .expect("the clips table should exist");
    let column_names = columns
        .query_map([], |row| row.get::<_, String>(1))
        .expect("clip columns should be readable")
        .collect::<rusqlite::Result<Vec<_>>>()
        .expect("clip columns should be valid");
    assert_eq!(
        column_names,
        [
            "id",
            "content",
            "content_type",
            "title",
            "source_app",
            "source_url",
            "source_page_title",
            "is_pinned",
            "created_at",
            "updated_at",
        ]
    );

    let mut indexes = connection
        .prepare("PRAGMA index_list(clips)")
        .expect("clip indexes should exist");
    let index_names = indexes
        .query_map([], |row| row.get::<_, String>(1))
        .expect("clip indexes should be readable")
        .collect::<rusqlite::Result<Vec<_>>>()
        .expect("clip indexes should be valid");
    assert!(index_names
        .iter()
        .any(|name| name == "idx_clips_created_at"));
    assert!(index_names.iter().any(|name| name == "idx_clips_is_pinned"));
}

#[test]
fn migration_from_populated_v1_preserves_every_clip_field_and_adds_group_schema() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let path = database_path(&temp_directory);
    let connection = Connection::open(&path).expect("the V1 database should open");
    connection
        .execute_batch(include_str!("../migrations/0001_create_clips.sql"))
        .expect("the V1 schema should apply");
    connection
        .execute(
            "INSERT INTO clips VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                "11111111-1111-4111-8111-111111111111",
                " preserved content ",
                "code",
                "Original title",
                "ChatGPT",
                "https://chatgpt.com/c/original#section",
                "Original page",
                1,
                "2026-01-02T03:04:05.006Z",
                "2026-02-03T04:05:06.007Z",
            ],
        )
        .expect("the V1 clip should be inserted");
    connection
        .pragma_update(None, "user_version", 1)
        .expect("the V1 version should be recorded");
    drop(connection);

    let service = open_service(&path);
    let clip = service
        .get("11111111-1111-4111-8111-111111111111")
        .expect("the migrated clip should be readable")
        .expect("the migrated clip should remain present");
    assert_eq!(clip.content, " preserved content ");
    assert_eq!(clip.content_type, "code");
    assert_eq!(clip.title.as_deref(), Some("Original title"));
    assert_eq!(clip.source_app.as_deref(), Some("ChatGPT"));
    assert_eq!(
        clip.source_url.as_deref(),
        Some("https://chatgpt.com/c/original#section")
    );
    assert_eq!(clip.source_page_title.as_deref(), Some("Original page"));
    assert!(clip.is_pinned);
    assert_eq!(clip.created_at, "2026-01-02T03:04:05.006Z");
    assert_eq!(clip.updated_at, "2026-02-03T04:05:06.007Z");

    let connection = Connection::open(&path).expect("the migrated database should reopen");
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("the migration version should be readable");
    assert_eq!(version, 2);
    for table in ["clip_groups", "clip_group_members"] {
        let exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .expect("the group table should be queryable");
        assert_eq!(exists, 1, "missing {table}");
    }
    drop(connection);
    drop(open_service(&path));
}

#[test]
fn every_service_connection_enforces_group_foreign_keys_and_unique_membership() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let path = database_path(&temp_directory);
    let service = open_service(&path);
    let first = service.create(new_clip("First")).unwrap();
    let second = service.create(new_clip("Second")).unwrap();
    let group = service
        .merge(&[
            LibraryItemRef::clip(first.id.clone()),
            LibraryItemRef::clip(second.id.clone()),
        ])
        .unwrap();

    let connection = Connection::open(&path).unwrap();
    connection
        .pragma_update(None, "foreign_keys", true)
        .unwrap();
    assert!(connection
        .execute(
            "INSERT INTO clip_group_members (group_id, clip_id, position) VALUES (?1, ?2, 2)",
            rusqlite::params![group.id, "22222222-2222-4222-8222-222222222222"],
        )
        .is_err());
    assert!(connection
        .execute(
            "INSERT INTO clip_groups (id, is_pinned, created_at, updated_at) VALUES (?1, 0, ?2, ?2)",
            rusqlite::params!["33333333-3333-4333-8333-333333333333", "2026-01-01T00:00:00.000Z"],
        )
        .is_ok());
    assert!(connection
        .execute(
            "INSERT INTO clip_group_members (group_id, clip_id, position) VALUES (?1, ?2, 0)",
            rusqlite::params!["33333333-3333-4333-8333-333333333333", first.id],
        )
        .is_err());
}

#[test]
fn merge_flattens_groups_deduplicates_members_and_lists_only_top_level_items() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = open_service(&database_path(&temp_directory));
    let first = service.create(new_clip("First")).unwrap();
    let second = service.create(new_clip("Second")).unwrap();
    let third = service.create(new_clip("Third")).unwrap();
    let first_group = service
        .merge(&[
            LibraryItemRef::clip(first.id.clone()),
            LibraryItemRef::clip(second.id.clone()),
        ])
        .unwrap();
    let merged = service
        .merge(&[
            LibraryItemRef::group(first_group.id.clone()),
            LibraryItemRef::clip(third.id.clone()),
            LibraryItemRef::clip(first.id.clone()),
        ])
        .unwrap();

    assert_ne!(merged.id, first_group.id);
    assert_eq!(merged.members.len(), 3);
    assert!(merged.members.windows(2).all(|clips| {
        clips[0].created_at > clips[1].created_at
            || (clips[0].created_at == clips[1].created_at && clips[0].id < clips[1].id)
    }));
    let listed = service.list_library_items().unwrap();
    assert_eq!(listed.len(), 1);
    assert!(matches!(&listed[0], LibraryItem::Group { group } if group.id == merged.id));
    assert!(service.get_group(&first_group.id).unwrap().is_none());
}

#[test]
fn group_title_and_pin_are_independent_while_member_metadata_is_preserved() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = open_service(&database_path(&temp_directory));
    let first = service.create(new_clip("First")).unwrap();
    let second = service.create(new_clip("Second")).unwrap();
    let pinned_first = service.pin(&first.id).unwrap().unwrap();
    let group = service
        .merge(&[
            LibraryItemRef::clip(first.id.clone()),
            LibraryItemRef::clip(second.id.clone()),
        ])
        .unwrap();
    assert_eq!(group.title, "Example conversation");
    assert!(!group.is_pinned);
    assert_eq!(
        group
            .members
            .iter()
            .find(|clip| clip.id == first.id)
            .unwrap(),
        &pinned_first
    );

    let pinned_group = service.set_group_pinned(&group.id, true).unwrap().unwrap();
    assert!(pinned_group.is_pinned);
    assert!(
        pinned_group
            .members
            .iter()
            .find(|clip| clip.id == first.id)
            .unwrap()
            .is_pinned
    );
    service.unmerge_group(&group.id).unwrap();
    assert!(service.get(&first.id).unwrap().unwrap().is_pinned);
}

#[test]
fn automatic_group_title_requires_exact_trimmed_nonempty_page_titles() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = open_service(&database_path(&temp_directory));
    let first = service.create(new_clip("First")).unwrap();
    let mut different = new_clip("Second");
    different.source_page_title = Some("Different page".to_owned());
    let second = service.create(different).unwrap();
    let group = service
        .merge(&[
            LibraryItemRef::clip(first.id),
            LibraryItemRef::clip(second.id),
        ])
        .unwrap();
    assert_eq!(group.title, "Merged clips");
}

#[test]
fn merge_rejects_a_duplicate_only_selection_without_persisting_a_one_member_group() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = open_service(&database_path(&temp_directory));
    let clip = service.create(new_clip("Only")).unwrap();
    assert!(service
        .merge(&[
            LibraryItemRef::clip(clip.id.clone()),
            LibraryItemRef::clip(clip.id.clone()),
        ])
        .is_err());
    assert_eq!(service.list_library_items().unwrap().len(), 1);
    assert!(matches!(
        service.list_library_items().unwrap()[0],
        LibraryItem::Clip { .. }
    ));
}

#[test]
fn failed_merge_rolls_back_without_changing_existing_group_membership() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = open_service(&database_path(&temp_directory));
    let first = service.create(new_clip("First")).unwrap();
    let second = service.create(new_clip("Second")).unwrap();
    let group = service
        .merge(&[
            LibraryItemRef::clip(first.id.clone()),
            LibraryItemRef::clip(second.id.clone()),
        ])
        .unwrap();

    assert!(service
        .merge(&[
            LibraryItemRef::group(group.id.clone()),
            LibraryItemRef::clip("44444444-4444-4444-8444-444444444444".to_owned()),
        ])
        .is_err());
    let persisted = service.get_group(&group.id).unwrap().unwrap();
    assert_eq!(persisted.members.len(), 2);
}

#[test]
fn member_unmerge_and_delete_dissolve_groups_atomically_at_one_survivor() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = open_service(&database_path(&temp_directory));
    let clips = [
        service.create(new_clip("First")).unwrap(),
        service.create(new_clip("Second")).unwrap(),
        service.create(new_clip("Third")).unwrap(),
    ];
    let group = service
        .merge(&[
            LibraryItemRef::clip(clips[0].id.clone()),
            LibraryItemRef::clip(clips[1].id.clone()),
            LibraryItemRef::clip(clips[2].id.clone()),
        ])
        .unwrap();

    service
        .unmerge_member(&group.id, &clips[1].id)
        .expect("one member should unmerge");
    assert_eq!(
        service.get_group(&group.id).unwrap().unwrap().members.len(),
        2
    );
    assert!(service.get(&clips[1].id).unwrap().is_some());

    service
        .delete_member(&group.id, &clips[0].id)
        .expect("deleting to one survivor should dissolve the group");
    assert!(service.get_group(&group.id).unwrap().is_none());
    assert!(service.get(&clips[0].id).unwrap().is_none());
    assert!(service.get(&clips[2].id).unwrap().is_some());
    assert_eq!(service.list_library_items().unwrap().len(), 2);
}

#[test]
fn whole_group_unmerge_preserves_clips_and_whole_group_delete_removes_them() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = open_service(&database_path(&temp_directory));
    let first = service.create(new_clip("First")).unwrap();
    let second = service.create(new_clip("Second")).unwrap();
    let group = service
        .merge(&[
            LibraryItemRef::clip(first.id.clone()),
            LibraryItemRef::clip(second.id.clone()),
        ])
        .unwrap();
    service.unmerge_group(&group.id).unwrap();
    assert!(service.get(&first.id).unwrap().is_some());
    assert!(service.get(&second.id).unwrap().is_some());

    let group = service
        .merge(&[
            LibraryItemRef::clip(first.id.clone()),
            LibraryItemRef::clip(second.id.clone()),
        ])
        .unwrap();
    service.delete_group(&group.id).unwrap();
    assert!(service.get(&first.id).unwrap().is_none());
    assert!(service.get(&second.id).unwrap().is_none());
    assert!(service.list_library_items().unwrap().is_empty());
}

#[test]
fn creates_reads_updates_and_deletes_a_clip() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = open_service(&database_path(&temp_directory));

    let created = service
        .create(new_clip("Original answer"))
        .expect("the clip should be created");
    Uuid::parse_str(&created.id).expect("the clip id should be a UUID");
    DateTime::parse_from_rfc3339(&created.created_at)
        .expect("created_at should be an RFC 3339 timestamp");
    DateTime::parse_from_rfc3339(&created.updated_at)
        .expect("updated_at should be an RFC 3339 timestamp");
    assert_eq!(created.content, "Original answer");
    assert!(!created.is_pinned);

    let read = service
        .get(&created.id)
        .expect("the clip read should succeed")
        .expect("the clip should exist");
    assert_eq!(read, created);

    let updated = service
        .update(&created.id, updated_clip())
        .expect("the clip update should succeed")
        .expect("the clip should exist");
    assert_eq!(updated.content, "Updated answer");
    assert_eq!(updated.content_type, "code");
    assert_eq!(updated.title.as_deref(), Some("Updated title"));
    assert_eq!(updated.created_at, created.created_at);
    assert!(!updated.is_pinned);

    assert!(service
        .delete(&created.id)
        .expect("the clip delete should succeed"));
    assert!(service
        .get(&created.id)
        .expect("the missing clip read should succeed")
        .is_none());
}

#[test]
fn missing_ids_return_none_or_false() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = open_service(&database_path(&temp_directory));
    let missing_id = Uuid::new_v4().to_string();

    assert!(service
        .get(&missing_id)
        .expect("the missing clip read should succeed")
        .is_none());
    assert!(service
        .update(&missing_id, updated_clip())
        .expect("the missing clip update should succeed")
        .is_none());
    assert!(service
        .pin(&missing_id)
        .expect("the missing clip pin should succeed")
        .is_none());
    assert!(service
        .unpin(&missing_id)
        .expect("the missing clip unpin should succeed")
        .is_none());
    assert!(!service
        .delete(&missing_id)
        .expect("the missing clip delete should succeed"));
}

#[test]
fn stores_quoted_and_sql_like_content_as_data() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = open_service(&database_path(&temp_directory));
    let sensitive_content = "Robert'); DROP TABLE clips; -- \"quoted\"";

    let created = service
        .create(new_clip(sensitive_content))
        .expect("quoted content should be stored safely");
    let read = service
        .get(&created.id)
        .expect("quoted content should be readable")
        .expect("the quoted clip should exist");
    assert_eq!(read.content, sensitive_content);

    service
        .create(new_clip("The clips table still exists"))
        .expect("a second clip should prove the table still exists");
}

#[test]
fn pins_and_unpins_a_clip() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let service = open_service(&database_path(&temp_directory));
    let created = service
        .create(new_clip("Pin this"))
        .expect("the clip should be created");

    let pinned = service
        .pin(&created.id)
        .expect("the clip pin should succeed")
        .expect("the clip should exist");
    assert!(pinned.is_pinned);

    let unpinned = service
        .unpin(&created.id)
        .expect("the clip unpin should succeed")
        .expect("the clip should exist");
    assert!(!unpinned.is_pinned);
}

#[test]
fn persists_a_clip_after_the_database_is_closed_and_reopened() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let path = database_path(&temp_directory);

    let created = {
        let service = open_service(&path);
        service
            .create(new_clip("Persist across restart"))
            .expect("the clip should be created")
    };

    let reopened_service = open_service(&path);
    let persisted = reopened_service
        .get(&created.id)
        .expect("the persisted clip read should succeed")
        .expect("the clip should survive reopening the database");
    assert_eq!(persisted, created);
}

#[test]
fn lists_clips_newest_first_with_a_stable_id_tiebreaker() {
    let temp_directory = tempfile::tempdir().expect("a temporary directory should be created");
    let path = database_path(&temp_directory);
    let service = open_service(&path);

    let first = service
        .create(new_clip("First clip"))
        .expect("the first clip should be created");
    let second = service
        .create(new_clip("Second clip"))
        .expect("the second clip should be created");

    let listed = service.list().expect("clips should be listed");

    assert_eq!(listed.len(), 2);
    assert!(listed.windows(2).all(|clips| {
        clips[0].created_at > clips[1].created_at
            || (clips[0].created_at == clips[1].created_at && clips[0].id < clips[1].id)
    }));
    assert!(listed.iter().any(|clip| clip.id == first.id));
    assert!(listed.iter().any(|clip| clip.id == second.id));
}
