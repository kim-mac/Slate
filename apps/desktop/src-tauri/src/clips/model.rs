use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub content: String,
    pub content_type: String,
    pub title: Option<String>,
    pub source_app: Option<String>,
    pub source_url: Option<String>,
    pub source_page_title: Option<String>,
    pub is_pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipGroup {
    pub id: String,
    pub title: String,
    pub is_pinned: bool,
    pub created_at: String,
    pub updated_at: String,
    pub members: Vec<Clip>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LibraryItem {
    Clip { clip: Clip },
    Group { group: ClipGroup },
}

impl LibraryItem {
    pub fn id(&self) -> &str {
        match self {
            Self::Clip { clip } => &clip.id,
            Self::Group { group } => &group.id,
        }
    }

    pub fn created_at(&self) -> &str {
        match self {
            Self::Clip { clip } => &clip.created_at,
            Self::Group { group } => &group.created_at,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LibraryItemRef {
    Clip { id: String },
    Group { id: String },
}

impl LibraryItemRef {
    pub fn clip(id: String) -> Self {
        Self::Clip { id }
    }

    pub fn group(id: String) -> Self {
        Self::Group { id }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateClip {
    pub content: String,
    pub content_type: String,
    pub title: Option<String>,
    pub source_app: Option<String>,
    pub source_url: Option<String>,
    pub source_page_title: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateClip {
    pub content: String,
    pub content_type: String,
    pub title: Option<String>,
    pub source_app: Option<String>,
    pub source_url: Option<String>,
    pub source_page_title: Option<String>,
}
