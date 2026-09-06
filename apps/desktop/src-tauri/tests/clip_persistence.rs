use std::path::Path;
use std::sync::{Arc, Barrier};
use std::thread;

use ai_clip_memory_desktop_lib::clips::{ClipService, CreateClip, UpdateClip};
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
    assert_eq!(user_version, 1);

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
