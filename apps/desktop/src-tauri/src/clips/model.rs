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
