use rusqlite::{params, OptionalExtension, Result, Row};

use crate::database::Database;

use super::Clip;

#[derive(Clone, Debug)]
pub(crate) struct ClipRepository {
    database: Database,
}

impl ClipRepository {
    pub(crate) fn new(database: Database) -> Self {
        Self { database }
    }

    pub(crate) fn create(&self, clip: &Clip) -> Result<()> {
        let connection = self.database.connect()?;
        connection.execute(
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
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
            ],
        )?;
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

    pub(crate) fn update(&self, clip: &Clip) -> Result<bool> {
        let connection = self.database.connect()?;
        let changed_rows = connection.execute(
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
        Ok(changed_rows == 1)
    }

    pub(crate) fn delete(&self, id: &str) -> Result<bool> {
        let connection = self.database.connect()?;
        let changed_rows = connection.execute("DELETE FROM clips WHERE id = ?1", [id])?;
        Ok(changed_rows == 1)
    }
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
