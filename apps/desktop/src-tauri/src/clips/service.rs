use std::path::Path;

use chrono::{SecondsFormat, Utc};
use rusqlite::Result;
use uuid::Uuid;

use crate::database::Database;

use super::{
    repository::ClipRepository, Clip, ClipGroup, CreateClip, LibraryItem, LibraryItemRef,
    UpdateClip,
};

#[derive(Clone, Debug)]
pub struct ClipService {
    repository: ClipRepository,
}

impl ClipService {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let database = Database::open(path)?;
        Ok(Self {
            repository: ClipRepository::new(database),
        })
    }

    pub fn open_existing(path: impl AsRef<Path>) -> Result<Self> {
        let database = Database::open_existing(path)?;
        Ok(Self {
            repository: ClipRepository::new(database),
        })
    }

    pub fn create(&self, input: CreateClip) -> Result<Clip> {
        let timestamp = current_timestamp();
        let clip = Clip {
            id: Uuid::new_v4().to_string(),
            content: input.content,
            content_type: input.content_type,
            title: input.title,
            source_app: input.source_app,
            source_url: input.source_url,
            source_page_title: input.source_page_title,
            is_pinned: false,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        self.repository.create(&clip)?;
        Ok(clip)
    }

    pub fn get(&self, id: &str) -> Result<Option<Clip>> {
        self.repository.get(id)
    }

    pub fn list(&self) -> Result<Vec<Clip>> {
        self.repository.list()
    }

    pub fn list_library_items(&self) -> Result<Vec<LibraryItem>> {
        self.repository.list_library_items()
    }

    pub fn get_group(&self, id: &str) -> Result<Option<ClipGroup>> {
        self.repository.get_group(id)
    }

    pub fn merge(&self, selected: &[LibraryItemRef]) -> Result<ClipGroup> {
        let timestamp = current_timestamp();
        self.repository.merge(
            &ClipGroup {
                id: Uuid::new_v4().to_string(),
                title: String::new(),
                is_pinned: false,
                created_at: timestamp.clone(),
                updated_at: timestamp,
                members: Vec::new(),
            },
            selected,
        )
    }

    pub fn unmerge_member(&self, group_id: &str, clip_id: &str) -> Result<bool> {
        self.repository.unmerge_member(group_id, clip_id)
    }

    pub fn unmerge_group(&self, group_id: &str) -> Result<bool> {
        self.repository.unmerge_group(group_id)
    }

    pub fn delete_member(&self, group_id: &str, clip_id: &str) -> Result<bool> {
        self.repository.delete_member(group_id, clip_id)
    }

    pub fn delete_group(&self, group_id: &str) -> Result<bool> {
        self.repository.delete_group(group_id)
    }

    pub fn set_group_pinned(&self, group_id: &str, is_pinned: bool) -> Result<Option<ClipGroup>> {
        self.repository
            .set_group_pinned(group_id, is_pinned, &current_timestamp())
    }

    pub fn update(&self, id: &str, input: UpdateClip) -> Result<Option<Clip>> {
        let Some(existing_clip) = self.repository.get(id)? else {
            return Ok(None);
        };
        let updated_clip = Clip {
            id: existing_clip.id,
            content: input.content,
            content_type: input.content_type,
            title: input.title,
            source_app: input.source_app,
            source_url: input.source_url,
            source_page_title: input.source_page_title,
            is_pinned: existing_clip.is_pinned,
            created_at: existing_clip.created_at,
            updated_at: current_timestamp(),
        };
        self.repository.update(&updated_clip)?;
        Ok(Some(updated_clip))
    }

    pub fn pin(&self, id: &str) -> Result<Option<Clip>> {
        self.set_pinned(id, true)
    }

    pub fn unpin(&self, id: &str) -> Result<Option<Clip>> {
        self.set_pinned(id, false)
    }

    pub fn delete(&self, id: &str) -> Result<bool> {
        self.repository.delete(id)
    }

    fn set_pinned(&self, id: &str, is_pinned: bool) -> Result<Option<Clip>> {
        let Some(mut clip) = self.repository.get(id)? else {
            return Ok(None);
        };
        clip.is_pinned = is_pinned;
        clip.updated_at = current_timestamp();
        self.repository.update(&clip)?;
        Ok(Some(clip))
    }
}

fn current_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
