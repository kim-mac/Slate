CREATE TABLE clip_groups (
  id TEXT PRIMARY KEY,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE clip_group_members (
  group_id TEXT NOT NULL REFERENCES clip_groups(id) ON DELETE CASCADE,
  clip_id TEXT NOT NULL UNIQUE REFERENCES clips(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (group_id, clip_id),
  UNIQUE (group_id, position)
);

CREATE INDEX idx_clip_groups_created_at ON clip_groups (created_at);
CREATE INDEX idx_clip_groups_is_pinned ON clip_groups (is_pinned);
CREATE INDEX idx_clip_group_members_group_position
  ON clip_group_members (group_id, position);
