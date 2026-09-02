CREATE TABLE clips (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  title TEXT,
  source_app TEXT,
  source_url TEXT,
  source_page_title TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_clips_created_at ON clips (created_at);
CREATE INDEX idx_clips_is_pinned ON clips (is_pinned);
