use std::collections::HashSet;

use rusqlite::{params, Error, OptionalExtension, Result, Row, Transaction, TransactionBehavior};

use crate::database::Database;
use uuid::Uuid;

use super::source::auto_source_key;
use super::{Clip, ClipGroup, LibraryItem, LibraryItemRef};

#[derive(Clone, Debug)]
pub(crate) struct ClipRepository {
    database: Database,
}

impl ClipRepository {
    pub(crate) fn new(database: Database) -> Self {
        Self { database }
    }

    pub(crate) fn create(&self, clip: &Clip) -> Result<()> {
        let source_key = auto_source_key(clip.source_url.as_deref());
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO clips (
                id,
                content,
                content_type,
                title,
                source_app,
                source_url,
                source_page_title,
                is_pinned,
                created_at,
                updated_at,
                auto_source_key
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                clip.id,
                clip.content,
                clip.content_type,
                clip.title,
                clip.source_app,
                clip.source_url,
                clip.source_page_title,
                clip.is_pinned,
                clip.created_at,
                clip.updated_at,
                source_key,
            ],
        )?;
        if let Some(source_key) = source_key {
            let active_group = transaction
                .query_row(
                    "SELECT id FROM clip_groups WHERE auto_source_key = ?1",
                    [source_key],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if let Some(group_id) = active_group {
                let position: i64 = transaction.query_row(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM clip_group_members WHERE group_id = ?1",
                    [&group_id], |row| row.get(0),
                )?;
                transaction.execute(
                    "INSERT INTO clip_group_members (group_id, clip_id, position) VALUES (?1, ?2, ?3)",
                    params![group_id, clip.id, position],
                )?;
            } else {
                // NULL source keys include unevaluated historical clips. Explicit
                // exclusions, membership and exact raw URL are authoritative.
                let prior = transaction
                    .query_row(
                        "SELECT id FROM clips WHERE source_url = ?1 AND auto_group_excluded = 0
                     AND id != ?2 AND NOT EXISTS (
                        SELECT 1 FROM clip_group_members WHERE clip_id = clips.id
                     ) ORDER BY created_at ASC, id ASC LIMIT 1",
                        params![source_key, clip.id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?;
                if let Some(prior_id) = prior {
                    let prior =
                        clip_by_id(&transaction, &prior_id)?.ok_or(Error::QueryReturnedNoRows)?;
                    let group_id = Uuid::new_v4().to_string();
                    transaction.execute(
                        "INSERT INTO clip_groups (id, is_pinned, created_at, updated_at, auto_source_key, title)
                         VALUES (?1, ?2, ?3, ?3, ?4, ?5)",
                        params![group_id, prior.is_pinned || clip.is_pinned, clip.created_at, source_key, display_title(&prior)],
                    )?;
                    let mut members = [&prior, clip];
                    members.sort_by(|a, b| {
                        b.created_at
                            .cmp(&a.created_at)
                            .then_with(|| a.id.cmp(&b.id))
                    });
                    for (position, member) in members.iter().enumerate() {
                        transaction.execute(
                            "INSERT INTO clip_group_members (group_id, clip_id, position) VALUES (?1, ?2, ?3)",
                            params![group_id, member.id, position as i64],
                        )?;
                    }
                    transaction.execute(
                        "UPDATE clips SET auto_source_key = ?2 WHERE id = ?1",
                        params![prior.id, source_key],
                    )?;
                }
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub(crate) fn get(&self, id: &str) -> Result<Option<Clip>> {
        let connection = self.database.connect()?;
        connection
            .query_row(
                "SELECT
                    id,
                    content,
                    content_type,
                    title,
                    source_app,
                    source_url,
                    source_page_title,
                    is_pinned,
                    created_at,
                    updated_at
                FROM clips
                WHERE id = ?1",
                [id],
                map_clip,
            )
            .optional()
    }

    pub(crate) fn list(&self) -> Result<Vec<Clip>> {
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(
            "SELECT
                id,
                content,
                content_type,
                title,
                source_app,
                source_url,
                source_page_title,
                is_pinned,
                created_at,
                updated_at
            FROM clips
            ORDER BY created_at DESC, id ASC",
        )?;
        let clips = statement.query_map([], map_clip)?.collect();
        clips
    }

    pub(crate) fn list_library_items(&self) -> Result<Vec<LibraryItem>> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let connection = &transaction;
        let mut items = Vec::new();
        let mut standalone = connection.prepare(
            "SELECT
                id, content, content_type, title, source_app, source_url,
                source_page_title, is_pinned, created_at, updated_at
             FROM clips
             WHERE NOT EXISTS (
                SELECT 1 FROM clip_group_members WHERE clip_id = clips.id
             )",
        )?;
        for clip in standalone.query_map([], map_clip)? {
            items.push(LibraryItem::Clip { clip: clip? });
        }
        drop(standalone);

        let mut groups = connection
            .prepare("SELECT id, is_pinned, created_at, updated_at, title FROM clip_groups")?;
        let rows = groups.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, bool>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;
        for row in rows {
            let (id, is_pinned, created_at, updated_at, title) = row?;
            let members = group_members(&connection, &id)?;
            if members.len() < 2 {
                return Err(Error::InvalidQuery);
            }
            items.push(LibraryItem::Group {
                group: ClipGroup {
                    id,
                    title_state: group_title_state(title.as_deref(), &members)?,
                    title: title.unwrap_or_else(|| automatic_group_title(&members)),
                    is_pinned,
                    created_at,
                    updated_at,
                    members,
                },
            });
        }
        items.sort_by(|a, b| {
            b.created_at()
                .cmp(a.created_at())
                .then_with(|| a.id().cmp(b.id()))
        });
        drop(groups);
        transaction.commit()?;
        Ok(items)
    }

    pub(crate) fn get_group(&self, id: &str) -> Result<Option<ClipGroup>> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let group = group_by_id(&transaction, id)?;
        transaction.commit()?;
        Ok(group)
    }

    pub(crate) fn merge(
        &self,
        group: &ClipGroup,
        selected: &[LibraryItemRef],
    ) -> Result<ClipGroup> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Selection order controls the resulting title, independently of the
        // deterministic chronological ordering of the flattened members.
        let title = match selected.first().ok_or(Error::InvalidQuery)? {
            LibraryItemRef::Clip { id } => {
                display_title(&clip_by_id(&transaction, id)?.ok_or(Error::QueryReturnedNoRows)?)
            }
            LibraryItemRef::Group { id } => {
                group_by_id(&transaction, id)?
                    .ok_or(Error::QueryReturnedNoRows)?
                    .title
            }
        };
        let mut member_ids = Vec::new();
        let mut seen = HashSet::new();
        let mut source_group_ids = HashSet::new();

        for item in selected {
            if let LibraryItemRef::Group { id } = item {
                let ids = group_member_ids(&transaction, id)?;
                if ids.len() < 2 {
                    return Err(Error::InvalidQuery);
                }
                source_group_ids.insert(id.clone());
                for clip_id in ids {
                    if seen.insert(clip_id.clone()) {
                        member_ids.push(clip_id);
                    }
                }
            }
        }
        for item in selected {
            if let LibraryItemRef::Clip { id } = item {
                let clip_exists: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM clips WHERE id = ?1)",
                    [id],
                    |row| row.get(0),
                )?;
                let current_group = transaction
                    .query_row(
                        "SELECT group_id FROM clip_group_members WHERE clip_id = ?1",
                        [id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?;
                if !clip_exists
                    || current_group
                        .as_ref()
                        .is_some_and(|group_id| !source_group_ids.contains(group_id))
                {
                    return Err(Error::InvalidQuery);
                }
                if seen.insert(id.clone()) {
                    member_ids.push(id.clone());
                }
            }
        }
        if member_ids.len() < 2 {
            return Err(Error::InvalidQuery);
        }

        let mut members = member_ids
            .iter()
            .map(|id| clip_by_id(&transaction, id)?.ok_or(Error::QueryReturnedNoRows))
            .collect::<Result<Vec<_>>>()?;
        members.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        for source_group_id in source_group_ids {
            transaction.execute("DELETE FROM clip_groups WHERE id = ?1", [source_group_id])?;
        }
        transaction.execute(
            "INSERT INTO clip_groups (id, is_pinned, created_at, updated_at, title)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                group.id,
                group.is_pinned,
                group.created_at,
                group.updated_at,
                title
            ],
        )?;
        for (position, member) in members.iter().enumerate() {
            let position = i64::try_from(position).map_err(|_| Error::InvalidQuery)?;
            transaction.execute(
                "INSERT INTO clip_group_members (group_id, clip_id, position)
                 VALUES (?1, ?2, ?3)",
                params![group.id, member.id, position],
            )?;
        }
        transaction.commit()?;
        Ok(ClipGroup {
            id: group.id.clone(),
            title_state: group_title_state(Some(&title), &members)?,
            title,
            is_pinned: group.is_pinned,
            created_at: group.created_at.clone(),
            updated_at: group.updated_at.clone(),
            members,
        })
    }

    pub(crate) fn unmerge_member(&self, group_id: &str, clip_id: &str) -> Result<bool> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_group_member(&transaction, group_id, clip_id)?;
        if is_automatic_group(&transaction, group_id)? {
            let members = group_member_ids(&transaction, group_id)?;
            if members.len() == 2 {
                exclude_group_members(&transaction, group_id)?;
            } else {
                transaction.execute("UPDATE clips SET auto_group_excluded = 1, auto_source_key = NULL WHERE id = ?1", [clip_id])?;
            }
        }
        transaction.execute(
            "DELETE FROM clip_group_members WHERE group_id = ?1 AND clip_id = ?2",
            params![group_id, clip_id],
        )?;
        dissolve_if_needed(&transaction, group_id)?;
        transaction.commit()?;
        Ok(true)
    }

    pub(crate) fn unmerge_group(&self, group_id: &str) -> Result<bool> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if is_automatic_group(&transaction, group_id)? {
            exclude_group_members(&transaction, group_id)?;
        }
        let changed = transaction.execute("DELETE FROM clip_groups WHERE id = ?1", [group_id])?;
        transaction.commit()?;
        Ok(changed == 1)
    }

    pub(crate) fn delete_member(&self, group_id: &str, clip_id: &str) -> Result<bool> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_group_member(&transaction, group_id, clip_id)?;
        transaction.execute("DELETE FROM clips WHERE id = ?1", [clip_id])?;
        dissolve_if_needed(&transaction, group_id)?;
        transaction.commit()?;
        Ok(true)
    }

    pub(crate) fn delete_group(
        &self,
        group_id: &str,
        expected_member_ids: &[String],
    ) -> Result<bool> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let member_ids = group_member_ids(&transaction, group_id)?;
        let expected: HashSet<_> = expected_member_ids.iter().collect();
        // Bind deletion to the complete set the user reviewed, not just its
        // count. The write transaction excludes captures/membership writes
        // between this authoritative comparison and the last deletion.
        if member_ids.len() < 2
            || expected.len() != expected_member_ids.len()
            || member_ids.len() != expected.len()
            || member_ids.iter().any(|id| !expected.contains(id))
        {
            return Ok(false);
        }
        if transaction.execute("DELETE FROM clip_groups WHERE id = ?1", [group_id])? != 1 {
            return Err(Error::InvalidQuery);
        }
        for clip_id in member_ids {
            if transaction.execute("DELETE FROM clips WHERE id = ?1", [clip_id])? != 1 {
                return Err(Error::InvalidQuery);
            }
        }
        transaction.commit()?;
        Ok(true)
    }

    pub(crate) fn set_group_pinned(
        &self,
        group_id: &str,
        is_pinned: bool,
        updated_at: &str,
    ) -> Result<Option<ClipGroup>> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = transaction.execute(
            "UPDATE clip_groups SET is_pinned = ?2, updated_at = ?3 WHERE id = ?1",
            params![group_id, is_pinned, updated_at],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        let group = group_by_id(&transaction, group_id)?;
        transaction.commit()?;
        Ok(group)
    }

    pub(crate) fn rename_group(
        &self,
        group_id: &str,
        title: &str,
        expected_state: Option<&str>,
        updated_at: &str,
    ) -> Result<Option<ClipGroup>> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let Some(existing) = group_by_id(&transaction, group_id)? else {
            return Ok(None);
        };
        if expected_state.is_some_and(|state| state != existing.title_state) {
            return Ok(None);
        }
        if existing.title == title {
            transaction.commit()?;
            return Ok(Some(existing));
        }
        if transaction.execute(
            "UPDATE clip_groups SET title = ?2, updated_at = ?3 WHERE id = ?1",
            params![group_id, title, updated_at],
        )? != 1
        {
            return Ok(None);
        }
        let group = group_by_id(&transaction, group_id)?;
        if group.as_ref().is_none_or(|group| group.title != title) {
            return Ok(None);
        }
        transaction.commit()?;
        Ok(group)
    }

    pub(crate) fn update_title(
        &self,
        id: &str,
        expected_title: Option<&str>,
        title: Option<&str>,
        updated_at: &str,
    ) -> Result<Option<Clip>> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let Some(existing) = clip_by_id(&transaction, id)? else {
            return Ok(None);
        };
        if existing.title.as_deref() != expected_title {
            return Ok(None);
        }
        if existing.title.as_deref() == title {
            transaction.commit()?;
            return Ok(Some(existing));
        }
        if transaction.execute(
            "UPDATE clips SET title = ?2, updated_at = ?3 WHERE id = ?1 AND title IS ?4",
            params![id, title, updated_at, expected_title],
        )? != 1
        {
            return Ok(None);
        }
        let saved = clip_by_id(&transaction, id)?;
        if saved
            .as_ref()
            .is_none_or(|clip| clip.title.as_deref() != title)
        {
            return Ok(None);
        }
        transaction.commit()?;
        Ok(saved)
    }

    pub(crate) fn update_content(
        &self,
        id: &str,
        expected_content: &str,
        content: &str,
        updated_at: &str,
    ) -> Result<Option<Clip>> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let Some(existing) = clip_by_id(&transaction, id)? else {
            return Ok(None);
        };
        if existing.content != expected_content {
            return Ok(None);
        }
        if existing.content == content {
            transaction.commit()?;
            return Ok(Some(existing));
        }

        let legacy_group = transaction
            .query_row(
                "SELECT g.id FROM clip_groups g
                 JOIN clip_group_members m ON m.group_id = g.id
                 WHERE m.clip_id = ?1 AND g.title IS NULL",
                [id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(group_id) = legacy_group {
            // Compatibility labels can derive from the original first line.
            // Materialize that label before changing any member content.
            let group = group_by_id(&transaction, &group_id)?.ok_or(Error::QueryReturnedNoRows)?;
            if transaction.execute(
                "UPDATE clip_groups SET title = ?2 WHERE id = ?1 AND title IS NULL",
                params![group_id, group.title],
            )? != 1
            {
                return Ok(None);
            }
        }
        if transaction.execute(
            "UPDATE clips SET content = ?2, updated_at = ?3
             WHERE id = ?1 AND content = ?4",
            params![id, content, updated_at, expected_content],
        )? != 1
        {
            return Ok(None);
        }
        let saved = clip_by_id(&transaction, id)?;
        if saved.as_ref().is_none_or(|clip| clip.content != content) {
            return Ok(None);
        }
        transaction.commit()?;
        Ok(saved)
    }

    pub(crate) fn update(&self, clip: &Clip) -> Result<bool> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let old_source = transaction
            .query_row(
                "SELECT source_url FROM clips WHERE id = ?1",
                [&clip.id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?;
        let source_changed = old_source
            .as_ref()
            .is_some_and(|old| *old != clip.source_url);
        let membership = transaction
            .query_row(
                "SELECT g.id, g.auto_source_key IS NOT NULL, g.title IS NULL
             FROM clip_groups g JOIN clip_group_members m ON m.group_id = g.id
             WHERE m.clip_id = ?1",
                [&clip.id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, bool>(1)?,
                        row.get::<_, bool>(2)?,
                    ))
                },
            )
            .optional()?;
        if let Some((group_id, automatic, legacy_title)) = membership {
            if legacy_title {
                // Freeze the pre-edit display label before metadata changes can
                // alter the compatibility fallback of a legacy manual group.
                let group =
                    group_by_id(&transaction, &group_id)?.ok_or(Error::QueryReturnedNoRows)?;
                transaction.execute(
                    "UPDATE clip_groups SET title = ?2 WHERE id = ?1",
                    params![group_id, group.title],
                )?;
            }
            if source_changed && automatic {
                // Source edits never move members or rename the group; only
                // automatic ownership and its cached member keys are retired.
                transaction.execute("UPDATE clips SET auto_source_key = NULL WHERE id IN (SELECT clip_id FROM clip_group_members WHERE group_id = ?1)", [&group_id])?;
                transaction.execute(
                    "UPDATE clip_groups SET auto_source_key = NULL WHERE id = ?1",
                    [&group_id],
                )?;
            }
        }
        if source_changed {
            transaction.execute(
                "UPDATE clips SET auto_source_key = NULL WHERE id = ?1",
                [&clip.id],
            )?;
        }
        let changed_rows = transaction.execute(
            "UPDATE clips SET
                content = ?2,
                content_type = ?3,
                title = ?4,
                source_app = ?5,
                source_url = ?6,
                source_page_title = ?7,
                is_pinned = ?8,
                updated_at = ?9
            WHERE id = ?1",
            params![
                clip.id,
                clip.content,
                clip.content_type,
                clip.title,
                clip.source_app,
                clip.source_url,
                clip.source_page_title,
                clip.is_pinned,
                clip.updated_at,
            ],
        )?;
        transaction.commit()?;
        Ok(changed_rows == 1)
    }

    pub(crate) fn delete(&self, id: &str) -> Result<bool> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let group_id = transaction
            .query_row(
                "SELECT group_id FROM clip_group_members WHERE clip_id = ?1",
                [id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let changed_rows = transaction.execute("DELETE FROM clips WHERE id = ?1", [id])?;
        if let Some(group_id) = group_id {
            dissolve_if_needed(&transaction, &group_id)?;
        }
        transaction.commit()?;
        Ok(changed_rows == 1)
    }
}

fn clip_by_id(connection: &rusqlite::Connection, id: &str) -> Result<Option<Clip>> {
    connection
        .query_row(
            "SELECT id, content, content_type, title, source_app, source_url,
                    source_page_title, is_pinned, created_at, updated_at
             FROM clips WHERE id = ?1",
            [id],
            map_clip,
        )
        .optional()
}

fn group_by_id(connection: &rusqlite::Connection, id: &str) -> Result<Option<ClipGroup>> {
    let row = connection
        .query_row(
            "SELECT is_pinned, created_at, updated_at, title FROM clip_groups WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, bool>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((is_pinned, created_at, updated_at, title)) = row else {
        return Ok(None);
    };
    let members = group_members(connection, id)?;
    if members.len() < 2 {
        return Err(Error::InvalidQuery);
    }
    Ok(Some(ClipGroup {
        id: id.to_owned(),
        title_state: group_title_state(title.as_deref(), &members)?,
        title: title.unwrap_or_else(|| automatic_group_title(&members)),
        is_pinned,
        created_at,
        updated_at,
        members,
    }))
}

fn group_members(connection: &rusqlite::Connection, group_id: &str) -> Result<Vec<Clip>> {
    let mut statement = connection.prepare(
        "SELECT c.id, c.content, c.content_type, c.title, c.source_app, c.source_url,
                c.source_page_title, c.is_pinned, c.created_at, c.updated_at
         FROM clip_group_members AS membership
         JOIN clips AS c ON c.id = membership.clip_id
         WHERE membership.group_id = ?1
         ORDER BY membership.position ASC",
    )?;
    let members = statement.query_map([group_id], map_clip)?.collect();
    members
}

fn group_member_ids(transaction: &Transaction<'_>, group_id: &str) -> Result<Vec<String>> {
    let mut statement = transaction.prepare(
        "SELECT clip_id FROM clip_group_members WHERE group_id = ?1 ORDER BY position ASC",
    )?;
    let ids = statement
        .query_map([group_id], |row| row.get::<_, String>(0))?
        .collect();
    ids
}

fn ensure_group_member(transaction: &Transaction<'_>, group_id: &str, clip_id: &str) -> Result<()> {
    let exists: bool = transaction.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM clip_group_members WHERE group_id = ?1 AND clip_id = ?2
         )",
        params![group_id, clip_id],
        |row| row.get(0),
    )?;
    if exists {
        Ok(())
    } else {
        Err(Error::InvalidQuery)
    }
}

fn dissolve_if_needed(transaction: &Transaction<'_>, group_id: &str) -> Result<()> {
    let count: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM clip_group_members WHERE group_id = ?1",
        [group_id],
        |row| row.get(0),
    )?;
    if count < 2 {
        transaction.execute("DELETE FROM clip_groups WHERE id = ?1", [group_id])?;
    }
    Ok(())
}

fn is_automatic_group(transaction: &Transaction<'_>, group_id: &str) -> Result<bool> {
    transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM clip_groups WHERE id = ?1 AND auto_source_key IS NOT NULL)",
        [group_id],
        |row| row.get(0),
    )
}

fn exclude_group_members(transaction: &Transaction<'_>, group_id: &str) -> Result<()> {
    transaction.execute("UPDATE clips SET auto_group_excluded = 1, auto_source_key = NULL WHERE id IN (SELECT clip_id FROM clip_group_members WHERE group_id = ?1)", [group_id])?;
    Ok(())
}

fn display_title(clip: &Clip) -> String {
    clip.title
        .as_deref()
        .into_iter()
        .chain(clip.source_page_title.as_deref())
        .chain(clip.content.lines())
        .map(str::trim)
        .find(|text| !text.is_empty())
        .unwrap_or("Untitled clip")
        .to_owned()
}

fn automatic_group_title(members: &[Clip]) -> String {
    let mut titles = members.iter().filter_map(|clip| {
        clip.source_page_title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
    });
    let Some(first) = titles.next() else {
        return "Merged clips".to_owned();
    };
    if titles.all(|title| title == first)
        && members.iter().all(|clip| {
            clip.source_page_title
                .as_deref()
                .map(str::trim)
                .is_some_and(|title| !title.is_empty())
        })
    {
        first.to_owned()
    } else {
        "Merged clips".to_owned()
    }
}

fn group_title_state(raw_title: Option<&str>, members: &[Clip]) -> Result<String> {
    let effective_title = raw_title
        .map(str::to_owned)
        .unwrap_or_else(|| automatic_group_title(members));
    let member_state: Vec<_> = members
        .iter()
        .map(|clip| (&clip.id, &clip.source_page_title))
        .collect();
    serde_json::to_string(&(raw_title, effective_title, member_state))
        .map_err(|_| Error::InvalidQuery)
}

fn map_clip(row: &Row<'_>) -> Result<Clip> {
    Ok(Clip {
        id: row.get(0)?,
        content: row.get(1)?,
        content_type: row.get(2)?,
        title: row.get(3)?,
        source_app: row.get(4)?,
        source_url: row.get(5)?,
        source_page_title: row.get(6)?,
        is_pinned: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}
