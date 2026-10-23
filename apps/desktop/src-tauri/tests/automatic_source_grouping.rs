use std::collections::HashSet;
use std::sync::{Arc, Barrier};
use std::thread;

use ai_clip_memory_desktop_lib::clips::{
    ClipGroup, ClipService, CreateClip, LibraryItem, LibraryItemRef, UpdateClip,
};
use rusqlite::{params, Connection};

const SOURCE: &str = "https://chatgpt.com/c/conversation-one?model=x#answer";

fn input(source: Option<&str>, content: &str) -> CreateClip {
    CreateClip {
        content: content.into(),
        content_type: "text".into(),
        title: None,
        source_app: Some("Web".into()),
        source_url: source.map(str::to_owned),
        source_page_title: Some("Original conversation".into()),
    }
}

fn groups(service: &ClipService) -> Vec<ClipGroup> {
    service
        .list_library_items()
        .unwrap()
        .into_iter()
        .filter_map(|item| match item {
            LibraryItem::Group { group } => Some(group),
            _ => None,
        })
        .collect()
}

fn exclusion(path: &std::path::Path, id: &str) -> bool {
    Connection::open(path)
        .unwrap()
        .query_row(
            "SELECT auto_group_excluded FROM clips WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .unwrap()
}

#[test]
fn first_stays_standalone_second_groups_third_appends_without_deduplicating_or_retitle() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clips.sqlite3");
    let service = ClipService::open(&path).unwrap();
    let mut first_input = input(Some(SOURCE), "identical");
    first_input.title = Some("First explicit title".into());
    let first = service.create(first_input).unwrap();
    service.pin(&first.id).unwrap();
    assert!(groups(&service).is_empty());
    let second = service.create(input(Some(SOURCE), "identical")).unwrap();
    let group = groups(&service).remove(0);
    assert_eq!(group.members.len(), 2);
    assert_eq!(group.title, "First explicit title");
    assert!(group.is_pinned);
    assert_ne!(first.id, second.id);
    let third = service.create(input(Some(SOURCE), "Third")).unwrap();
    let persisted = service.get_group(&group.id).unwrap().unwrap();
    assert_eq!(persisted.title, group.title);
    assert_eq!(persisted.created_at, group.created_at);
    assert_eq!(persisted.members.len(), 3);
    assert_eq!(&persisted.members[..2], &group.members);
    assert_eq!(persisted.members.last().unwrap().id, third.id);
    assert!(persisted.members.iter().any(|c| c.id == third.id));
    assert_eq!(service.list().unwrap().len(), 3);
    assert_eq!(service.list_library_items().unwrap().len(), 1);
}

#[test]
fn full_raw_url_distinctions_are_preserved() {
    let dir = tempfile::tempdir().unwrap();
    let service = ClipService::open(dir.path().join("clips.sqlite3")).unwrap();
    for url in [
        SOURCE,
        "https://chatgpt.com/c/conversation-two?model=x#answer",
        "https://chatgpt.com/c/conversation-one?model=y#answer",
        "https://chatgpt.com/c/conversation-one?model=x#other",
        "https://chatgpt.com/c/conversation-one/?model=x#answer",
        "https://chat.openai.com/c/conversation-one?model=x#answer",
        "https://CHATGPT.com/c/conversation-one?model=x#answer",
    ] {
        let clip = service.create(input(Some(url), "same content")).unwrap();
        assert_eq!(clip.source_url.as_deref(), Some(url));
    }
    assert!(groups(&service).is_empty());
    assert_eq!(service.list_library_items().unwrap().len(), 7);
}

#[test]
fn unsuitable_sources_still_save_without_grouping() {
    let dir = tempfile::tempdir().unwrap();
    let service = ClipService::open(dir.path().join("clips.sqlite3")).unwrap();
    for url in [
        None,
        Some(""),
        Some("not a URL"),
        Some("file:///notes"),
        Some("https://user:secret@example.com/a"),
        Some("https://@example.com/a"),
        Some("https:///"),
        Some("https://chatgpt.com/"),
        Some("https://chatgpt.com/?model=x"),
        Some("https://chat.openai.com/chat"),
        Some("https://chatgpt.com/c/"),
        Some("https://chatgpt.com/g/g-123"),
        Some("https://chatgpt.com/g/g-123/c/"),
        Some("https://claude.ai/new"),
        Some("https://claude.ai/"),
        Some("https://gemini.google.com/app"),
    ] {
        service.create(input(url, "one")).unwrap();
        service.create(input(url, "two")).unwrap();
    }
    assert!(groups(&service).is_empty());
}

#[test]
fn supported_provider_subdomains_require_conversation_identity_and_keep_raw_keys() {
    let dir = tempfile::tempdir().unwrap();
    let service = ClipService::open(dir.path().join("clips.sqlite3")).unwrap();
    for landing in [
        "https://team.chatgpt.com/",
        "https://team.chatgpt.com/?model=x",
        "https://team.chatgpt.com/c/",
        "https://team.claude.ai/",
        "https://team.claude.ai/new",
        "https://workspace.gemini.google.com/",
        "https://workspace.gemini.google.com/app",
    ] {
        service.create(input(Some(landing), "one")).unwrap();
        service.create(input(Some(landing), "two")).unwrap();
    }
    assert!(groups(&service).is_empty());
    for source in [
        "https://team.chatgpt.com/c/id",
        "https://chatgpt.com/c/id",
        "https://team.claude.ai/chat/id",
        "https://claude.ai/chat/id",
        "https://workspace.gemini.google.com/app/id",
        "https://gemini.google.com/app/id",
    ] {
        let a = service.create(input(Some(source), "one")).unwrap();
        let b = service.create(input(Some(source), "two")).unwrap();
        let group = groups(&service)
            .into_iter()
            .find(|group| group.members.iter().any(|clip| clip.id == a.id))
            .unwrap();
        assert_eq!(group.members.len(), 2);
        assert!(group.members.iter().any(|clip| clip.id == b.id));
        assert!(group
            .members
            .iter()
            .all(|clip| clip.source_url.as_deref() == Some(source)));
    }
    assert_eq!(groups(&service).len(), 6);
}

#[test]
fn other_web_sources_use_generic_exact_matching_without_speculative_provider_routes() {
    let dir = tempfile::tempdir().unwrap();
    let service = ClipService::open(dir.path().join("clips.sqlite3")).unwrap();
    for source in [
        "https://copilot.microsoft.com/document/example",
        "https://www.perplexity.ai/document/example",
        "https://chat.deepseek.com/document/example",
        "https://grok.com/document/example",
        "https://notchatgpt.com/document/example",
        "https://chatgpt.com.example.org/document/example",
        "https://notclaude.ai/document/example",
        "https://claude.ai.example.org/document/example",
        "https://team.chat.openai.com/document/example",
        "https://gemini.google.com.example.org/document/example",
    ] {
        let a = service.create(input(Some(source), "one")).unwrap();
        let b = service.create(input(Some(source), "two")).unwrap();
        let group = groups(&service)
            .into_iter()
            .find(|group| group.members.iter().any(|clip| clip.id == a.id))
            .unwrap();
        assert_eq!(group.members.len(), 2);
        assert!(group.members.iter().any(|clip| clip.id == b.id));
    }
    assert_eq!(groups(&service).len(), 10);
}

#[test]
fn origin_only_sources_save_unchanged_without_automatic_grouping() {
    let dir = tempfile::tempdir().unwrap();
    let service = ClipService::open(dir.path().join("clips.sqlite3")).unwrap();
    for source in [
        "https://example.com",
        "https://example.com/",
        "http://example.com/?document=a#section",
        "https://copilot.microsoft.com/",
        "https://www.perplexity.ai/",
        "https://chat.deepseek.com/",
        "https://grok.com/",
    ] {
        for _ in 0..2 {
            let clip = service.create(input(Some(source), "same content")).unwrap();
            assert_eq!(clip.source_url.as_deref(), Some(source));
        }
    }
    assert!(groups(&service).is_empty());
    assert_eq!(service.list().unwrap().len(), 14);
}

#[test]
fn invalid_hostnames_and_known_provider_dot_alias_landings_do_not_group() {
    let dir = tempfile::tempdir().unwrap();
    let service = ClipService::open(dir.path().join("clips.sqlite3")).unwrap();
    for url in [
        "https://./",
        "https://../",
        "https://-bad.example/a",
        "https://example..com/a",
        "https://chatgpt.com./",
        "https://claude.ai./new",
    ] {
        service.create(input(Some(url), "one")).unwrap();
        service.create(input(Some(url), "two")).unwrap();
    }
    assert!(groups(&service).is_empty());
}

#[test]
fn reliable_http_sources_and_title_fallbacks_create_stable_groups() {
    let dir = tempfile::tempdir().unwrap();
    let service = ClipService::open(dir.path().join("clips.sqlite3")).unwrap();
    for (url, title, page, content, expected) in [
        (
            "http://example.com/page",
            Some(" explicit "),
            Some("page"),
            "body",
            "explicit",
        ),
        (
            "https://claude.ai/chat/id",
            Some("  "),
            Some(" page "),
            "body",
            "page",
        ),
        (
            "https://gemini.google.com/app/id",
            None,
            Some("\t"),
            "\n \n first line \nsecond",
            "first line",
        ),
        (
            "https://chatgpt.com/g/g-id/c/id",
            None,
            None,
            "\n\t",
            "Untitled clip",
        ),
    ] {
        let mut first = input(Some(url), content);
        first.title = title.map(str::to_owned);
        first.source_page_title = page.map(str::to_owned);
        let first = service.create(first).unwrap();
        service.create(input(Some(url), "second")).unwrap();
        let group = groups(&service)
            .into_iter()
            .find(|g| g.members.iter().any(|m| m.id == first.id))
            .unwrap();
        assert_eq!(group.title, expected);
        service
            .rename_group(&group.id, "Custom persisted")
            .unwrap()
            .unwrap();
        service.create(input(Some(url), "third")).unwrap();
        assert_eq!(
            service.get_group(&group.id).unwrap().unwrap().title,
            "Custom persisted"
        );
    }
}

#[test]
fn source_edit_preserves_exclusion_and_does_not_regroup_matching_standalones() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clips.sqlite3");
    let service = ClipService::open(&path).unwrap();
    let a = service.create(input(Some(SOURCE), "A")).unwrap();
    service.create(input(Some(SOURCE), "B")).unwrap();
    let group = groups(&service).remove(0);
    service.unmerge_group(&group.id).unwrap();
    let destination = "https://example.com/destination";
    service
        .create(input(Some(destination), "standalone"))
        .unwrap();
    service
        .update(
            &a.id,
            UpdateClip {
                content: a.content,
                content_type: a.content_type,
                title: a.title,
                source_app: a.source_app,
                source_url: Some(destination.into()),
                source_page_title: a.source_page_title,
            },
        )
        .unwrap();
    assert!(exclusion(&path, &a.id));
    assert!(groups(&service).is_empty());
    service.create(input(Some(destination), "new")).unwrap();
    assert!(!groups(&service)
        .remove(0)
        .members
        .iter()
        .any(|m| m.id == a.id));
}

#[test]
fn failed_exclusion_membership_change_and_append_roll_back_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clips.sqlite3");
    let service = ClipService::open(&path).unwrap();
    let a = service.create(input(Some(SOURCE), "A")).unwrap();
    service.create(input(Some(SOURCE), "B")).unwrap();
    let group = groups(&service).remove(0);
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_delete_group BEFORE DELETE ON clip_groups BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
    assert!(service.unmerge_member(&group.id, &a.id).is_err());
    assert!(!exclusion(&path, &a.id));
    assert_eq!(service.get_group(&group.id).unwrap().unwrap(), group);
    assert!(service.unmerge_group(&group.id).is_err());
    for member in &group.members {
        assert!(!exclusion(&path, &member.id));
    }
    connection.execute_batch("CREATE TRIGGER fail_append BEFORE INSERT ON clip_group_members BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
    assert!(service
        .create(input(Some(SOURCE), "append failure"))
        .is_err());
    assert_eq!(service.list().unwrap().len(), 2);
    assert_eq!(service.get_group(&group.id).unwrap().unwrap(), group);
}

#[test]
fn failed_migration_rolls_back_added_columns_and_version() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clips.sqlite3");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(include_str!("../migrations/0001_create_clips.sql"))
        .unwrap();
    connection
        .execute_batch(include_str!("../migrations/0002_create_clip_groups.sql"))
        .unwrap();
    connection
        .execute_batch(
            "CREATE INDEX idx_clips_auto_source_key ON clips (id); PRAGMA user_version=2;",
        )
        .unwrap();
    assert!(ClipService::open(&path).is_err());
    assert_eq!(
        connection
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    let columns: Vec<String> = connection
        .prepare("PRAGMA table_info(clips)")
        .unwrap()
        .query_map([], |r| r.get(1))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert!(!columns
        .iter()
        .any(|c| c == "auto_source_key" || c == "auto_group_excluded"));
}

#[test]
fn merging_different_group_titles_uses_first_selected_group() {
    let dir = tempfile::tempdir().unwrap();
    let service = ClipService::open(dir.path().join("clips.sqlite3")).unwrap();
    let mut selected_groups = Vec::new();
    for label in [
        "Created first, selected second",
        "Created second, selected first",
    ] {
        let mut references = Vec::new();
        for index in 0..2 {
            let clip = service
                .create(input(
                    Some(&format!("https://example.com/{label}/{index}").replace(' ', "%20")),
                    label,
                ))
                .unwrap();
            references.push(LibraryItemRef::clip(clip.id));
        }
        let group = service.merge(&references).unwrap();
        service.rename_group(&group.id, label).unwrap();
        selected_groups.insert(0, LibraryItemRef::group(group.id));
    }
    let merged = service.merge(&selected_groups).unwrap();
    assert_eq!(merged.title, "Created second, selected first");
    assert_eq!(merged.members.len(), 4);
}

#[test]
fn legacy_null_title_is_frozen_before_member_metadata_edits() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clips.sqlite3");
    let service = ClipService::open(&path).unwrap();
    let a = service
        .create(input(Some("https://example.com/a"), "A"))
        .unwrap();
    let b = service
        .create(input(Some("https://example.com/b"), "B"))
        .unwrap();
    let group = service
        .merge(&[
            LibraryItemRef::clip(a.id.clone()),
            LibraryItemRef::clip(b.id),
        ])
        .unwrap();
    Connection::open(&path)
        .unwrap()
        .execute("UPDATE clip_groups SET title=NULL WHERE id=?1", [&group.id])
        .unwrap();
    let legacy = service.get_group(&group.id).unwrap().unwrap();
    assert_eq!(legacy.title, "Original conversation");
    service
        .update(
            &a.id,
            UpdateClip {
                content: "changed".into(),
                content_type: a.content_type,
                title: Some("edited".into()),
                source_app: a.source_app,
                source_url: Some("https://example.com/source-edit".into()),
                source_page_title: Some("changed page".into()),
            },
        )
        .unwrap();
    let persisted = service.get_group(&group.id).unwrap().unwrap();
    assert_eq!(persisted.title, legacy.title);
    assert_eq!(persisted.members.len(), 2);
}

#[test]
fn automatic_unmerge_exclusions_survive_restart_and_new_clips_group_separately() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clips.sqlite3");
    let service = ClipService::open(&path).unwrap();
    let a = service.create(input(Some(SOURCE), "A")).unwrap();
    let b = service.create(input(Some(SOURCE), "B")).unwrap();
    let c = service.create(input(Some(SOURCE), "C")).unwrap();
    let group = groups(&service).remove(0);
    service.unmerge_member(&group.id, &a.id).unwrap();
    assert!(exclusion(&path, &a.id));
    assert!(!exclusion(&path, &b.id));
    service.unmerge_member(&group.id, &b.id).unwrap();
    assert!(exclusion(&path, &b.id));
    assert!(exclusion(&path, &c.id));
    drop(service);
    let service = ClipService::open(&path).unwrap();
    service.create(input(Some(SOURCE), "D")).unwrap();
    assert!(groups(&service).is_empty());
    service.create(input(Some(SOURCE), "E")).unwrap();
    let group = groups(&service).remove(0);
    assert_eq!(group.members.len(), 2);
    assert!(!group
        .members
        .iter()
        .any(|m| [&a.id, &b.id, &c.id].contains(&&m.id)));
    service.unmerge_group(&group.id).unwrap();
    for member in &group.members {
        assert!(exclusion(&path, &member.id));
    }
    let manual = service
        .merge(&[LibraryItemRef::clip(a.id), LibraryItemRef::clip(b.id)])
        .unwrap();
    assert_eq!(manual.members.len(), 2);
}

#[test]
fn manual_merge_owns_members_and_uses_first_selected_title_independent_of_member_order() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clips.sqlite3");
    let service = ClipService::open(&path).unwrap();
    let a = service.create(input(Some(SOURCE), "A")).unwrap();
    service.create(input(Some(SOURCE), "B")).unwrap();
    let automatic = groups(&service).remove(0);
    let mut other = input(Some("https://example.com/other"), "Other");
    other.title = Some("Selected first".into());
    let c = service.create(other).unwrap();
    let manual = service
        .merge(&[
            LibraryItemRef::clip(c.id),
            LibraryItemRef::group(automatic.id),
        ])
        .unwrap();
    assert_eq!(manual.title, "Selected first");
    assert_eq!(manual.members.len(), 3);
    assert!(service.get(&a.id).unwrap().is_some());
    service.create(input(Some(SOURCE), "D")).unwrap();
    assert_eq!(groups(&service).len(), 1);
    service.create(input(Some(SOURCE), "E")).unwrap();
    assert_eq!(groups(&service).len(), 2);
    service
        .rename_group(&manual.id, "Custom title")
        .unwrap()
        .unwrap();
    let manual = service.get_group(&manual.id).unwrap().unwrap();
    let new = service
        .create(input(Some("https://example.com/separate"), "F"))
        .unwrap();
    let merged = service
        .merge(&[
            LibraryItemRef::group(manual.id),
            LibraryItemRef::clip(new.id),
        ])
        .unwrap();
    assert_eq!(merged.title, "Custom title");
}

#[test]
fn member_edits_preserve_title_and_membership_source_edits_retire_ownership() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clips.sqlite3");
    let service = ClipService::open(&path).unwrap();
    let a = service.create(input(Some(SOURCE), "A")).unwrap();
    service.create(input(Some(SOURCE), "B")).unwrap();
    let group = groups(&service).remove(0);
    let group = service
        .rename_group(&group.id, "Member edits preserve custom title")
        .unwrap()
        .unwrap();
    let mut update = UpdateClip {
        content: "edited".into(),
        content_type: a.content_type,
        title: Some("new title".into()),
        source_app: a.source_app,
        source_url: a.source_url,
        source_page_title: Some("new page".into()),
    };
    service.update(&a.id, update.clone()).unwrap();
    assert_eq!(
        service.get_group(&group.id).unwrap().unwrap().title,
        group.title
    );
    update.source_url = Some("https://example.com/changed".into());
    service.update(&a.id, update).unwrap();
    let persisted = service.get_group(&group.id).unwrap().unwrap();
    assert_eq!(persisted.title, group.title);
    assert_eq!(persisted.members.len(), 2);
    let connection = Connection::open(&path).unwrap();
    let ownership: Option<String> = connection
        .query_row(
            "SELECT auto_source_key FROM clip_groups WHERE id=?1",
            [&group.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ownership, None);
    service.create(input(Some(SOURCE), "C")).unwrap();
    assert_eq!(
        service.get_group(&group.id).unwrap().unwrap().members.len(),
        2
    );
    assert_eq!(groups(&service).len(), 1);
}

#[test]
fn grouping_failure_rolls_back_new_clip_and_group_mutations() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clips.sqlite3");
    let service = ClipService::open(&path).unwrap();
    let first = service.create(input(Some(SOURCE), "First")).unwrap();
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_members BEFORE INSERT ON clip_group_members BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
    assert!(service.create(input(Some(SOURCE), "Fail")).is_err());
    assert_eq!(service.list().unwrap(), vec![first]);
    assert!(groups(&service).is_empty());
}

#[test]
fn concurrent_saves_and_snapshot_reads_never_duplicate_members() {
    let dir = tempfile::tempdir().unwrap();
    let service = ClipService::open(dir.path().join("clips.sqlite3")).unwrap();
    let barrier = Arc::new(Barrier::new(9));
    let workers: Vec<_> = (0..8)
        .map(|i| {
            let service = service.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                barrier.wait();
                service
                    .create(input(Some(SOURCE), &format!("save {i}")))
                    .unwrap();
            })
        })
        .collect();
    barrier.wait();
    for _ in 0..50 {
        assert_consistent(&service);
    }
    for worker in workers {
        worker.join().unwrap();
    }
    let group = groups(&service).remove(0);
    assert_eq!(group.members.len(), 8);
    assert_eq!(service.list_library_items().unwrap().len(), 1);
}

fn assert_consistent(service: &ClipService) {
    let items = service.list_library_items().unwrap();
    let mut seen = HashSet::new();
    for item in items {
        match item {
            LibraryItem::Clip { clip } => assert!(seen.insert(clip.id)),
            LibraryItem::Group { group } => {
                assert!(group.members.len() >= 2);
                for clip in group.members {
                    assert!(seen.insert(clip.id));
                }
            }
        }
    }
}

#[test]
fn concurrent_unmerge_delete_and_save_preserve_safe_membership() {
    for delete in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let service = ClipService::open(dir.path().join("clips.sqlite3")).unwrap();
        let a = service.create(input(Some(SOURCE), "A")).unwrap();
        service.create(input(Some(SOURCE), "B")).unwrap();
        let group = groups(&service).remove(0);
        let barrier = Arc::new(Barrier::new(3));
        let writer = {
            let service = service.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                barrier.wait();
                service.create(input(Some(SOURCE), "C")).unwrap();
            })
        };
        let modifier = {
            let service = service.clone();
            let barrier = barrier.clone();
            let id = a.id.clone();
            thread::spawn(move || {
                barrier.wait();
                if delete {
                    service.delete(&id).unwrap();
                } else {
                    service.unmerge_member(&group.id, &id).unwrap();
                }
            })
        };
        barrier.wait();
        for _ in 0..20 {
            assert_consistent(&service);
        }
        writer.join().unwrap();
        modifier.join().unwrap();
        assert_consistent(&service);
        assert_eq!(service.get(&a.id).unwrap().is_none(), delete);
    }
}

#[test]
fn representative_v2_migration_preserves_metadata_membership_and_discovers_history_only_on_save() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clips.sqlite3");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(include_str!("../migrations/0001_create_clips.sql"))
        .unwrap();
    connection
        .execute_batch(include_str!("../migrations/0002_create_clip_groups.sql"))
        .unwrap();
    for id in ["manual-a", "manual-b", "historical-a", "historical-b"] {
        connection.execute("INSERT INTO clips VALUES (?1,' preserved content ','code','Explicit','ChatGPT',?2,'Page',1,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')", params![id, SOURCE]).unwrap();
    }
    connection.execute("UPDATE clips SET source_url='https://example.com/manually-curated' WHERE id='manual-b'", []).unwrap();
    connection.execute_batch("INSERT INTO clip_groups VALUES ('legacy',1,'2026-02-01T00:00:00Z','2026-02-02T00:00:00Z'); INSERT INTO clip_group_members VALUES ('legacy','manual-a',0),('legacy','manual-b',1); PRAGMA user_version=2;").unwrap();
    drop(connection);
    let service = ClipService::open(&path).unwrap();
    assert_eq!(groups(&service).len(), 1);
    let legacy = service.get_group("legacy").unwrap().unwrap();
    assert_eq!(legacy.title, "Page");
    assert!(legacy.is_pinned);
    assert_eq!(legacy.created_at, "2026-02-01T00:00:00Z");
    assert_eq!(legacy.updated_at, "2026-02-02T00:00:00Z");
    assert_eq!(
        legacy
            .members
            .iter()
            .map(|m| m.id.as_str())
            .collect::<Vec<_>>(),
        ["manual-a", "manual-b"]
    );
    for clip in service.list().unwrap() {
        assert_eq!(clip.content, " preserved content ");
        assert_eq!(clip.content_type, "code");
        assert_eq!(clip.title.as_deref(), Some("Explicit"));
        assert_eq!(clip.source_app.as_deref(), Some("ChatGPT"));
        assert_eq!(
            clip.source_url.as_deref(),
            Some(if clip.id == "manual-b" {
                "https://example.com/manually-curated"
            } else {
                SOURCE
            })
        );
        assert_eq!(clip.source_page_title.as_deref(), Some("Page"));
        assert!(clip.is_pinned);
        assert_eq!(clip.created_at, "2026-01-01T00:00:00Z");
        assert_eq!(clip.updated_at, "2026-01-02T00:00:00Z");
        assert!(!exclusion(&path, &clip.id));
    }
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT count(*) FROM clips WHERE auto_source_key IS NULL",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        4
    );
    assert!(connection
        .execute("UPDATE clips SET auto_group_excluded=2", [])
        .is_err());
    service.create(input(Some(SOURCE), "New")).unwrap();
    let auto = groups(&service)
        .into_iter()
        .find(|g| g.id != "legacy")
        .unwrap();
    assert!(auto.members.iter().any(|m| m.id == "historical-a"));
    assert!(!auto.members.iter().any(|m| m.id.starts_with("manual")));
    assert_eq!(auto.title, "Explicit");
    assert_eq!(service.get_group("legacy").unwrap().unwrap(), legacy);
    assert!(connection.execute("INSERT INTO clip_groups (id,is_pinned,created_at,updated_at,auto_source_key) VALUES ('conflict',0,'now','now',?1)", [SOURCE]).is_err());
}
