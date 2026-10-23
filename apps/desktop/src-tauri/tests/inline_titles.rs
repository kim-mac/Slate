use ai_clip_memory_desktop_lib::clips::{ClipService, CreateClip, LibraryItemRef};
use rusqlite::{params, Connection};
use std::sync::{Arc, Barrier};

fn fixture() -> (tempfile::TempDir, std::path::PathBuf, ClipService) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("clips.sqlite3");
    let service = ClipService::open(&path).unwrap();
    (directory, path, service)
}

fn input(content: &str) -> CreateClip {
    CreateClip {
        content: content.into(),
        content_type: "code".into(),
        title: None,
        source_app: Some("Web".into()),
        source_url: None,
        source_page_title: Some("Shared page".into()),
    }
}

fn group(service: &ClipService) -> ai_clip_memory_desktop_lib::clips::ClipGroup {
    let first = service.create(input("first")).unwrap();
    let second = service.create(input("second")).unwrap();
    service
        .merge(&[
            LibraryItemRef::clip(first.id),
            LibraryItemRef::clip(second.id),
        ])
        .unwrap()
}

#[test]
fn group_noop_retains_legacy_null_title_and_timestamp() {
    let (_directory, path, service) = fixture();
    let group = group(&service);
    let connection = Connection::open(path).unwrap();
    connection
        .execute(
            "UPDATE clip_groups SET title = NULL, updated_at = 'old' WHERE id = ?1",
            [&group.id],
        )
        .unwrap();
    let before = service.get_group(&group.id).unwrap().unwrap();
    let after = service
        .rename_group(&group.id, &before.title)
        .unwrap()
        .unwrap();
    assert_eq!(after.updated_at, "old");
    let raw: Option<String> = connection
        .query_row(
            "SELECT title FROM clip_groups WHERE id = ?1",
            [&group.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(raw, None);
}

#[test]
fn group_snapshot_exposes_an_authoritative_title_state() {
    let (_directory, path, service) = fixture();
    let group = group(&service);
    let original = serde_json::to_value(&group).unwrap();
    assert!(original["titleState"]
        .as_str()
        .is_some_and(|state| !state.is_empty()));
    Connection::open(path)
        .unwrap()
        .execute(
            "UPDATE clip_groups SET title = NULL WHERE id = ?1",
            [&group.id],
        )
        .unwrap();
    let legacy = serde_json::to_value(service.get_group(&group.id).unwrap().unwrap()).unwrap();
    assert_eq!(original["title"], legacy["title"]);
    assert_ne!(original["titleState"], legacy["titleState"]);
}

#[test]
fn title_commands_use_guarded_modes_and_main_only_permissions() {
    let commands = include_str!("../src/commands.rs");
    assert!(commands.contains("title_edit: Option<TitleEdit>"));
    assert!(commands.contains("service.update_title("));
    assert!(commands.contains("service.rename_group_if_current("));
    assert!(include_str!("../src/lib.rs").contains("commands::rename_group"));
    assert!(include_str!("../build.rs").contains("\"rename_group\""));
    assert!(include_str!("../capabilities/default.json").contains("allow-rename-group"));
    assert!(!include_str!("../capabilities/launcher.json").contains("allow-rename-group"));
}

#[test]
fn clip_title_cas_preserves_every_other_field_and_storage_ownership() {
    let (_directory, path, service) = fixture();
    let group = group(&service);
    let id = &group.members[0].id;
    let connection = Connection::open(path).unwrap();
    connection.execute("UPDATE clips SET content = 'concurrent content', content_type = 'legacy', source_url = 'legacy url', is_pinned = 1, auto_source_key = 'untouched', auto_group_excluded = 1, updated_at = 'old' WHERE id = ?1", [id]).unwrap();
    let before = service.get(id).unwrap().unwrap();
    let saved = service
        .update_title(id, None, Some("  new title  "))
        .unwrap()
        .unwrap();
    let mut expected = before;
    expected.title = Some("new title".into());
    expected.updated_at = saved.updated_at.clone();
    assert_eq!(saved, expected);
    assert_ne!(saved.updated_at, "old");
    assert_eq!(
        service.get_group(&group.id).unwrap().unwrap().title,
        group.title
    );
    let ownership: (Option<String>, bool) = connection
        .query_row(
            "SELECT auto_source_key, auto_group_excluded FROM clips WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(ownership, (Some("untouched".into()), true));
}

#[test]
fn clip_title_noop_stale_missing_deleted_and_zero_rows_fail_closed() {
    let (_directory, path, service) = fixture();
    let clip = service.create(input("original")).unwrap();
    let connection = Connection::open(path).unwrap();
    connection
        .execute(
            "UPDATE clips SET updated_at = 'old' WHERE id = ?1",
            [&clip.id],
        )
        .unwrap();
    let before = service.get(&clip.id).unwrap().unwrap();
    assert_eq!(
        service.update_title(&clip.id, None, Some("  ")).unwrap(),
        Some(before.clone())
    );
    assert!(service
        .update_title(&clip.id, Some("stale"), None)
        .unwrap()
        .is_none());
    assert_eq!(service.get(&clip.id).unwrap(), Some(before.clone()));
    connection.execute_batch("CREATE TRIGGER ignore_title BEFORE UPDATE OF title ON clips BEGIN SELECT RAISE(IGNORE); END;").unwrap();
    assert!(service
        .update_title(&clip.id, None, Some("new"))
        .unwrap()
        .is_none());
    assert_eq!(service.get(&clip.id).unwrap(), Some(before));
    service.delete(&clip.id).unwrap();
    assert!(service
        .update_title(&clip.id, None, None)
        .unwrap()
        .is_none());
    assert!(service
        .update_title("missing", None, None)
        .unwrap()
        .is_none());
}

#[test]
fn title_validation_never_truncates_and_applies_utf8_byte_limits() {
    let (_directory, _path, service) = fixture();
    let clip = service.create(input("original")).unwrap();
    let exact = "é".repeat(8192);
    assert_eq!(
        service
            .update_title(&clip.id, None, Some(&exact))
            .unwrap()
            .unwrap()
            .title,
        Some(exact.clone())
    );
    for invalid in [
        "é".repeat(8193),
        format!(" {}", exact),
        "hello\rworld".into(),
        "hello\nworld".into(),
    ] {
        assert!(service
            .update_title(&clip.id, Some(&exact), Some(&invalid))
            .is_err());
    }
    let group = group(&service);
    for invalid in [
        " ".into(),
        "é".repeat(8193),
        "hello\rworld".into(),
        "hello\nworld".into(),
    ] {
        assert!(service
            .rename_group_if_current(&group.id, &invalid, &group.title_state)
            .is_err());
    }
}

#[test]
fn group_guard_distinguishes_raw_null_same_display_membership_and_source_state() {
    let (_directory, path, service) = fixture();
    let group = group(&service);
    let connection = Connection::open(path).unwrap();
    connection
        .execute(
            "UPDATE clip_groups SET title = NULL, updated_at = 'old' WHERE id = ?1",
            [&group.id],
        )
        .unwrap();
    let legacy = service.get_group(&group.id).unwrap().unwrap();
    assert!(service
        .rename_group_if_current(&group.id, "other", "")
        .unwrap()
        .is_none());
    assert_eq!(
        service
            .rename_group_if_current(&group.id, &legacy.title, &legacy.title_state)
            .unwrap(),
        Some(legacy.clone())
    );
    connection
        .execute(
            "UPDATE clip_groups SET title = ?2 WHERE id = ?1",
            params![group.id, legacy.title],
        )
        .unwrap();
    assert!(service
        .rename_group_if_current(&group.id, "other", &legacy.title_state)
        .unwrap()
        .is_none());
    let snapshot = service.get_group(&group.id).unwrap().unwrap();
    connection
        .execute(
            "UPDATE clip_group_members SET position = position + 10 WHERE group_id = ?1",
            [&group.id],
        )
        .unwrap();
    // An equivalent ordered membership has the same state, arbitrary numeric positions do not matter.
    assert_eq!(
        service.get_group(&group.id).unwrap().unwrap().title_state,
        snapshot.title_state
    );
    let replacement = service.create(input("replacement")).unwrap();
    connection
        .execute(
            "UPDATE clip_group_members SET clip_id = ?2 WHERE clip_id = ?1",
            params![snapshot.members[0].id, replacement.id],
        )
        .unwrap();
    assert_eq!(
        service.get_group(&group.id).unwrap().unwrap().title,
        snapshot.title
    );
    assert!(service
        .rename_group_if_current(&group.id, "other", &snapshot.title_state)
        .unwrap()
        .is_none());
    let snapshot = service.get_group(&group.id).unwrap().unwrap();
    connection
        .execute(
            "UPDATE clips SET source_page_title = 'changed fallback state' WHERE id = ?1",
            [&replacement.id],
        )
        .unwrap();
    assert!(service
        .rename_group_if_current(&group.id, "other", &snapshot.title_state)
        .unwrap()
        .is_none());
    let snapshot = service.get_group(&group.id).unwrap().unwrap();
    let renamed = service
        .rename_group_if_current(&group.id, "  Custom  ", &snapshot.title_state)
        .unwrap()
        .unwrap();
    assert_eq!(renamed.title, "Custom");
    assert_eq!(renamed.members, snapshot.members);
    assert_ne!(renamed.title_state, snapshot.title_state);
    assert!(service
        .rename_group_if_current(&group.id, "another", &snapshot.title_state)
        .unwrap()
        .is_none());
    service.unmerge_group(&group.id).unwrap();
    assert!(service
        .rename_group_if_current(&group.id, "another", &renamed.title_state)
        .unwrap()
        .is_none());
}

#[test]
fn group_zero_row_write_is_not_success() {
    let (_directory, path, service) = fixture();
    let group = group(&service);
    Connection::open(path).unwrap().execute_batch("CREATE TRIGGER ignore_group_title BEFORE UPDATE OF title ON clip_groups BEGIN SELECT RAISE(IGNORE); END;").unwrap();
    assert!(service
        .rename_group_if_current(&group.id, "new", &group.title_state)
        .unwrap()
        .is_none());
    assert_eq!(service.get_group(&group.id).unwrap(), Some(group));
}

#[test]
fn concurrent_clip_and_group_title_saves_each_have_exactly_one_winner() {
    let (_directory, _path, service) = fixture();
    for _ in 0..12 {
        let clip = service.create(input("original")).unwrap();
        let group = group(&service);
        for grouped in [false, true] {
            let barrier = Arc::new(Barrier::new(3));
            let winners = std::thread::scope(|scope| {
                let handles: Vec<_> = ["left", "right"]
                    .into_iter()
                    .map(|title| {
                        let service = service.clone();
                        let barrier = barrier.clone();
                        let clip_id = clip.id.clone();
                        let group = group.clone();
                        scope.spawn(move || {
                            barrier.wait();
                            if grouped {
                                service
                                    .rename_group_if_current(&group.id, title, &group.title_state)
                                    .unwrap()
                                    .is_some()
                            } else {
                                service
                                    .update_title(&clip_id, None, Some(title))
                                    .unwrap()
                                    .is_some()
                            }
                        })
                    })
                    .collect();
                barrier.wait();
                handles
                    .into_iter()
                    .map(|handle| handle.join().unwrap())
                    .filter(|won| *won)
                    .count()
            });
            assert_eq!(winners, 1);
        }
    }
}

#[test]
fn actual_title_metadata_race_preserves_concurrent_content_source_and_pin() {
    let (_directory, path, service) = fixture();
    for _ in 0..12 {
        let clip = service.create(input("original")).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        std::thread::scope(|scope| {
            let barrier_other = barrier.clone();
            let id = clip.id.clone();
            let path = path.clone();
            let writer = scope.spawn(move || {
                let connection = Connection::open(path).unwrap();
                barrier_other.wait();
                connection.execute("UPDATE clips SET content = 'race content', source_url = 'race source', is_pinned = 1 WHERE id = ?1", [id]).unwrap();
            });
            barrier.wait();
            service
                .update_title(&clip.id, None, Some("new title"))
                .unwrap()
                .unwrap();
            writer.join().unwrap();
        });
        let saved = service.get(&clip.id).unwrap().unwrap();
        assert_eq!(saved.title.as_deref(), Some("new title"));
        assert_eq!(saved.content, "race content");
        assert_eq!(saved.source_url.as_deref(), Some("race source"));
        assert!(saved.is_pinned);
    }
}

#[test]
fn actual_clip_delete_and_group_dissolution_races_cannot_recreate_rows() {
    let (_directory, _path, service) = fixture();
    for _ in 0..12 {
        let clip = service.create(input("original")).unwrap();
        let group = group(&service);
        for grouped in [false, true] {
            let barrier = Arc::new(Barrier::new(2));
            std::thread::scope(|scope| {
                let other = barrier.clone();
                let deleter = service.clone();
                let id = if grouped {
                    group.id.clone()
                } else {
                    clip.id.clone()
                };
                let writer = scope.spawn(move || {
                    other.wait();
                    if grouped {
                        deleter.unmerge_group(&id).unwrap()
                    } else {
                        deleter.delete(&id).unwrap()
                    }
                });
                barrier.wait();
                if grouped {
                    if let Some(saved) = service
                        .rename_group_if_current(&group.id, "changed", &group.title_state)
                        .unwrap()
                    {
                        assert_eq!(saved.title, "changed");
                    }
                } else if let Some(saved) = service
                    .update_title(&clip.id, None, Some("changed"))
                    .unwrap()
                {
                    assert_eq!(saved.title.as_deref(), Some("changed"));
                }
                assert!(writer.join().unwrap());
            });
            if grouped {
                assert!(service.get_group(&group.id).unwrap().is_none());
                assert!(service
                    .rename_group_if_current(&group.id, "changed", &group.title_state)
                    .unwrap()
                    .is_none());
            } else {
                assert!(service.get(&clip.id).unwrap().is_none());
                assert!(service
                    .update_title(&clip.id, None, Some("changed"))
                    .unwrap()
                    .is_none());
            }
        }
    }
}
