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
        source_page_title: None,
    }
}

#[test]
fn inline_content_preserves_metadata_group_title_membership_and_positions() {
    let (_directory, path, service) = fixture();
    let first = service.create(input("Original first line\nrest")).unwrap();
    let second = service.create(input("second")).unwrap();
    let group = service
        .merge(&[
            LibraryItemRef::clip(first.id.clone()),
            LibraryItemRef::clip(second.id.clone()),
        ])
        .unwrap();
    service.set_group_pinned(&group.id, true).unwrap();
    let connection = Connection::open(&path).unwrap();
    connection
        .execute(
            "UPDATE clip_groups SET title = NULL WHERE id = ?1",
            [&group.id],
        )
        .unwrap();
    connection.execute("UPDATE clips SET title = 'Concurrent title', source_app = 'Concurrent app', source_url = 'https://example.com/new', source_page_title = 'Concurrent page', is_pinned = 1, auto_source_key = 'untouched', auto_group_excluded = 1 WHERE id = ?1", [&first.id]).unwrap();
    let before = service.get(&first.id).unwrap().unwrap();
    let group_before = service.get_group(&group.id).unwrap().unwrap();
    let mut positions = connection.prepare("SELECT clip_id, position FROM clip_group_members WHERE group_id = ?1 ORDER BY position").unwrap();
    let positions_before: Vec<(String, i64)> = positions
        .query_map([&group.id], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    let edited = service
        .update_content(&first.id, &first.content, "changed")
        .unwrap()
        .unwrap();
    let mut expected = before;
    expected.content = "changed".into();
    expected.updated_at = edited.updated_at.clone();
    assert_eq!(edited, expected);
    let group_after = service.get_group(&group.id).unwrap().unwrap();
    assert_eq!(group_after.title, group_before.title);
    assert_eq!(group_after.is_pinned, group_before.is_pinned);
    assert_eq!(group_after.updated_at, group_before.updated_at);
    assert_eq!(group_after.created_at, group_before.created_at);
    let positions_after: Vec<(String, i64)> = positions
        .query_map([&group.id], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(positions_after, positions_before);
    let ownership: (Option<String>, bool) = connection
        .query_row(
            "SELECT auto_source_key, auto_group_excluded FROM clips WHERE id = ?1",
            [&first.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(ownership, (Some("untouched".into()), true));
    let title: Option<String> = connection
        .query_row(
            "SELECT title FROM clip_groups WHERE id = ?1",
            [&group.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(title.as_deref(), Some(group_before.title.as_str()));
}

#[test]
fn inline_content_freezes_legacy_derived_title_before_editing_its_first_line() {
    let (_directory, path, service) = fixture();
    let first = service.create(input("Original first line\nrest")).unwrap();
    let second = service.create(input("second")).unwrap();
    let group = service
        .merge(&[
            LibraryItemRef::clip(first.id.clone()),
            LibraryItemRef::clip(second.id.clone()),
        ])
        .unwrap();
    Connection::open(&path)
        .unwrap()
        .execute(
            "UPDATE clip_groups SET title = NULL WHERE id = ?1",
            [&group.id],
        )
        .unwrap();
    let before = service.get_group(&group.id).unwrap().unwrap();
    let derived_member = before.members[0].clone();
    service
        .update_content(
            &derived_member.id,
            &derived_member.content,
            "New first line",
        )
        .unwrap()
        .unwrap();
    assert_eq!(
        service.get_group(&group.id).unwrap().unwrap().title,
        before.title
    );
}

#[test]
fn inline_content_noop_requires_existing_matching_row_and_keeps_timestamp() {
    let (_directory, path, service) = fixture();
    let clip = service.create(input("original")).unwrap();
    Connection::open(&path)
        .unwrap()
        .execute(
            "UPDATE clips SET updated_at = 'old timestamp' WHERE id = ?1",
            [&clip.id],
        )
        .unwrap();
    let before = service.get(&clip.id).unwrap().unwrap();
    assert_eq!(
        service
            .update_content(&clip.id, "original", "original")
            .unwrap(),
        Some(before.clone())
    );
    assert!(service
        .update_content(&clip.id, "stale", "stale")
        .unwrap()
        .is_none());
    assert_eq!(service.get(&clip.id).unwrap(), Some(before));
    service.delete(&clip.id).unwrap();
    assert!(service
        .update_content(&clip.id, "original", "original")
        .unwrap()
        .is_none());
    assert!(service
        .update_content("missing", "", "new")
        .unwrap()
        .is_none());
}

#[test]
fn inline_content_zero_row_write_is_not_reported_as_success() {
    let (_directory, path, service) = fixture();
    let clip = service.create(input("original")).unwrap();
    Connection::open(&path).unwrap().execute_batch("CREATE TRIGGER ignore_content BEFORE UPDATE OF content ON clips BEGIN SELECT RAISE(IGNORE); END;").unwrap();
    assert!(service
        .update_content(&clip.id, "original", "new")
        .unwrap()
        .is_none());
    assert!(service
        .update(
            &clip.id,
            ai_clip_memory_desktop_lib::clips::UpdateClip {
                content: "new".into(),
                content_type: "text".into(),
                title: None,
                source_app: None,
                source_url: None,
                source_page_title: None,
            }
        )
        .unwrap()
        .is_none());
    assert_eq!(service.get(&clip.id).unwrap().unwrap().content, "original");
}

#[test]
fn inline_content_actual_competing_saves_have_exactly_one_winner() {
    let (_directory, _path, service) = fixture();
    for _ in 0..20 {
        let clip = service.create(input("original")).unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let results = std::thread::scope(|scope| {
            let handles: Vec<_> = ["left", "right"]
                .into_iter()
                .map(|content| {
                    let service = service.clone();
                    let id = clip.id.clone();
                    let barrier = barrier.clone();
                    scope.spawn(move || {
                        barrier.wait();
                        service.update_content(&id, "original", content).unwrap()
                    })
                })
                .collect();
            barrier.wait();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(results.iter().filter(|value| value.is_some()).count(), 1);
        assert_eq!(
            service.get(&clip.id).unwrap(),
            results.into_iter().flatten().next()
        );
    }
}

#[test]
fn inline_content_actual_metadata_race_preserves_the_concurrent_write() {
    let (_directory, path, service) = fixture();
    for _ in 0..20 {
        let clip = service.create(input("original")).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        std::thread::scope(|scope| {
            let other = barrier.clone();
            let id = clip.id.clone();
            let path = path.clone();
            let writer = scope.spawn(move || {
                let connection = Connection::open(path).unwrap();
                other.wait();
                connection
                    .execute(
                        "UPDATE clips SET title = 'race title', is_pinned = 1 WHERE id = ?1",
                        params![id],
                    )
                    .unwrap();
            });
            barrier.wait();
            service
                .update_content(&clip.id, "original", "new")
                .unwrap()
                .unwrap();
            writer.join().unwrap();
        });
        let result = service.get(&clip.id).unwrap().unwrap();
        assert_eq!(result.content, "new");
        assert_eq!(result.title.as_deref(), Some("race title"));
        assert!(result.is_pinned);
    }
}

#[test]
fn inline_content_actual_delete_race_cannot_return_an_unsaved_clip() {
    let (_directory, _path, service) = fixture();
    for _ in 0..20 {
        let clip = service.create(input("original")).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        std::thread::scope(|scope| {
            let other = barrier.clone();
            let id = clip.id.clone();
            let deleter = service.clone();
            let writer = scope.spawn(move || {
                other.wait();
                deleter.delete(&id).unwrap()
            });
            barrier.wait();
            if let Some(saved) = service.update_content(&clip.id, "original", "new").unwrap() {
                assert_eq!(saved.content, "new");
            }
            assert!(writer.join().unwrap());
        });
        assert!(service.get(&clip.id).unwrap().is_none());
        assert!(service
            .update_content(&clip.id, "original", "new")
            .unwrap()
            .is_none());
    }
}
