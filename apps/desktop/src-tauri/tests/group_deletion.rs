use std::io::Cursor;

use ai_clip_memory_desktop_lib::bridge::native_host::run_with_storage;
use ai_clip_memory_desktop_lib::clips::{
    ClipGroup, ClipService, CreateClip, LibraryItem, LibraryItemRef,
};
use ai_clip_memory_desktop_lib::storage::StorageState;
use rusqlite::Connection;
use serde_json::json;
use std::sync::{Arc, Barrier};

const SOURCE: &str = "https://chatgpt.com/c/delete-confirmation";

fn input(content: &str) -> CreateClip {
    CreateClip {
        content: content.into(),
        content_type: "text".into(),
        title: None,
        source_app: Some("ChatGPT".into()),
        source_url: Some(SOURCE.into()),
        source_page_title: Some("Deletion test".into()),
    }
}

fn group(service: &ClipService) -> ClipGroup {
    service
        .list_library_items()
        .unwrap()
        .into_iter()
        .find_map(|item| match item {
            LibraryItem::Group { group } => Some(group),
            _ => None,
        })
        .unwrap()
}

fn ids(group: &ClipGroup) -> Vec<String> {
    group.members.iter().map(|clip| clip.id.clone()).collect()
}

fn fixture(count: usize) -> (tempfile::TempDir, StorageState, ClipService, ClipGroup) {
    let directory = tempfile::tempdir().unwrap();
    let storage = StorageState::new(directory.path().into());
    let service = storage.service().unwrap();
    for i in 0..count {
        service.create(input(&format!("Member {i}"))).unwrap();
    }
    let group = group(&service);
    (directory, storage, service, group)
}

fn capture(directory: &std::path::Path, content: &str) -> String {
    let body = serde_json::to_vec(&json!({
        "version": 1, "type": "capture_clip",
        "payload": {"content": content, "contentType": "text",
            "sourceApp": "ChatGPT", "sourceUrl": SOURCE,
            "sourcePageTitle": "Deletion test"}
    }))
    .unwrap();
    let mut framed = (body.len() as u32).to_ne_bytes().to_vec();
    framed.extend(body);
    let mut output = Vec::new();
    run_with_storage(
        &mut Cursor::new(framed),
        &mut output,
        directory.into(),
        Ok(()),
    )
    .unwrap();
    let response: serde_json::Value = serde_json::from_slice(&output[4..]).unwrap();
    assert_eq!(response["ok"], true);
    response["clipId"].as_str().unwrap().to_owned()
}

#[test]
fn capture_joining_after_confirmation_does_not_expand_deletion() {
    let directory = tempfile::tempdir().unwrap();
    let storage = StorageState::new(directory.path().into());
    let service = storage.service().unwrap();
    service.create(input("A")).unwrap();
    service.create(input("B")).unwrap();
    let confirmed = group(&service);
    assert_eq!(confirmed.members.len(), 2);

    // Actual framed native-host persistence, using its own storage connection.
    let captured = capture(directory.path(), "C after confirmation");
    assert_eq!(group(&service).members.len(), 3);
    let before = service.list_library_items().unwrap();
    let ids: Vec<_> = confirmed
        .members
        .iter()
        .map(|clip| clip.id.clone())
        .collect();
    assert!(!service.delete_group(&confirmed.id, &ids).unwrap());

    assert!(service.get(&captured).unwrap().is_some());
    assert_eq!(service.list_library_items().unwrap(), before);
}

#[test]
fn current_confirmation_deletes_only_its_group_and_preserves_other_clips_and_groups() {
    let (_directory, _storage, service, confirmed) = fixture(2);
    let mut other = input("Unrelated standalone");
    other.source_url = None;
    let standalone = service.create(other.clone()).unwrap();
    let a = service.create(other.clone()).unwrap();
    let b = service.create(other).unwrap();
    let other_group = service
        .merge(&[LibraryItemRef::clip(a.id), LibraryItemRef::clip(b.id)])
        .unwrap();
    let mut expected = ids(&confirmed);
    expected.reverse(); // Scope is a set, not presentation order.
    assert!(service.delete_group(&confirmed.id, &expected).unwrap());
    assert!(service.get_group(&confirmed.id).unwrap().is_none());
    for id in expected {
        assert!(service.get(&id).unwrap().is_none());
    }
    assert_eq!(service.get(&standalone.id).unwrap(), Some(standalone));
    assert_eq!(
        service.get_group(&other_group.id).unwrap(),
        Some(other_group)
    );
}

#[test]
fn leaving_member_invalidates_confirmation_for_both_unmerge_and_individual_delete() {
    for delete in [false, true] {
        let (_directory, _storage, service, confirmed) = fixture(3);
        let departing = &confirmed.members[0].id;
        if delete {
            service.delete(departing).unwrap();
        } else {
            service.unmerge_member(&confirmed.id, departing).unwrap();
        }
        let before = service.list_library_items().unwrap();
        assert!(!service
            .delete_group(&confirmed.id, &ids(&confirmed))
            .unwrap());
        assert_eq!(service.list_library_items().unwrap(), before);
        assert_eq!(service.get(departing).unwrap().is_none(), delete);
    }
}

#[test]
fn same_count_replacement_is_not_the_confirmed_member_set() {
    let (directory, _storage, service, confirmed) = fixture(3);
    service
        .unmerge_member(&confirmed.id, &confirmed.members[0].id)
        .unwrap();
    let replacement = capture(directory.path(), "Replacement");
    let current = group(&service);
    assert_eq!(current.id, confirmed.id);
    assert_eq!(current.members.len(), confirmed.members.len());
    assert!(current.members.iter().any(|clip| clip.id == replacement));
    let before = service.list_library_items().unwrap();
    assert!(!service
        .delete_group(&confirmed.id, &ids(&confirmed))
        .unwrap());
    assert_eq!(service.list_library_items().unwrap(), before);
}

#[test]
fn missing_dissolved_wrong_groups_and_invalid_sets_delete_nothing() {
    let (_directory, _storage, service, confirmed) = fixture(2);
    let expected = ids(&confirmed);
    for supplied in [
        vec![],
        vec![expected[0].clone()],
        vec![expected[0].clone(), expected[0].clone()],
        vec![expected[0].clone(), uuid::Uuid::new_v4().to_string()],
    ] {
        let before = service.list_library_items().unwrap();
        assert!(!service.delete_group(&confirmed.id, &supplied).unwrap());
        assert_eq!(service.list_library_items().unwrap(), before);
    }
    let before = service.list_library_items().unwrap();
    assert!(!service
        .delete_group(&uuid::Uuid::new_v4().to_string(), &expected)
        .unwrap());
    assert_eq!(service.list_library_items().unwrap(), before);
    service.unmerge_group(&confirmed.id).unwrap();
    let dissolved = service.list_library_items().unwrap();
    assert!(!service.delete_group(&confirmed.id, &expected).unwrap());
    assert_eq!(service.list_library_items().unwrap(), dissolved);
}

#[test]
fn another_groups_members_cannot_authorize_deletion_even_with_equal_counts() {
    let (_directory, _storage, service, confirmed) = fixture(2);
    let mut other = input("Other group");
    other.source_url = None;
    let a = service.create(other.clone()).unwrap();
    let b = service.create(other).unwrap();
    let other_group = service
        .merge(&[LibraryItemRef::clip(a.id), LibraryItemRef::clip(b.id)])
        .unwrap();
    let before = service.list_library_items().unwrap();
    assert!(!service
        .delete_group(&other_group.id, &ids(&confirmed))
        .unwrap());
    assert_eq!(service.list_library_items().unwrap(), before);
}

#[test]
fn failed_or_ignored_delete_rolls_back_group_and_every_member() {
    for failure in ["ABORT, 'synthetic failure'", "IGNORE"] {
        let (_directory, storage, service, confirmed) = fixture(3);
        let before = service.list_library_items().unwrap();
        // Fail after a preceding member delete has already executed.
        Connection::open(storage.database_path()).unwrap().execute_batch(&format!(
            "CREATE TRIGGER reject_delete BEFORE DELETE ON clips WHEN OLD.id = '{}' BEGIN SELECT RAISE({failure}); END;",
            confirmed.members[1].id
        )).unwrap();
        assert!(service
            .delete_group(&confirmed.id, &ids(&confirmed))
            .is_err());
        assert_eq!(service.list_library_items().unwrap(), before);
    }
}

#[test]
fn replayed_confirmation_cannot_delete_a_new_capture_or_a_new_group() {
    let (directory, _storage, service, confirmed) = fixture(2);
    let expected = ids(&confirmed);
    assert!(service.delete_group(&confirmed.id, &expected).unwrap());
    let first = capture(directory.path(), "After successful delete");
    assert!(!service.delete_group(&confirmed.id, &expected).unwrap());
    let second = capture(directory.path(), "Forms a new group");
    let before = service.list_library_items().unwrap();
    assert!(!service.delete_group(&confirmed.id, &expected).unwrap());
    assert_eq!(service.list_library_items().unwrap(), before);
    assert!(service.get(&first).unwrap().is_some());
    assert!(service.get(&second).unwrap().is_some());
}

#[test]
fn concurrent_framed_native_capture_and_confirmed_delete_never_remove_new_capture() {
    for _ in 0..12 {
        let (directory, _storage, service, confirmed) = fixture(2);
        let barrier = Arc::new(Barrier::new(3));
        let writer = {
            let barrier = barrier.clone();
            let path = directory.path().to_owned();
            std::thread::spawn(move || {
                barrier.wait();
                capture(&path, "Concurrent capture")
            })
        };
        let deletion = {
            let barrier = barrier.clone();
            let service = service.clone();
            let confirmed = confirmed.clone();
            std::thread::spawn(move || {
                barrier.wait();
                service
                    .delete_group(&confirmed.id, &ids(&confirmed))
                    .unwrap()
            })
        };
        barrier.wait();
        let captured = writer.join().unwrap();
        let deleted = deletion.join().unwrap();
        assert!(service.get(&captured).unwrap().is_some());
        for id in ids(&confirmed) {
            assert_eq!(service.get(&id).unwrap().is_none(), deleted);
        }
        assert_eq!(service.list().unwrap().len(), if deleted { 1 } else { 3 });
    }
}
