ALTER TABLE clips ADD COLUMN auto_source_key TEXT;
ALTER TABLE clips ADD COLUMN auto_group_excluded INTEGER NOT NULL DEFAULT 0
  CHECK (auto_group_excluded IN (0, 1));
ALTER TABLE clip_groups ADD COLUMN auto_source_key TEXT;
ALTER TABLE clip_groups ADD COLUMN title TEXT;

CREATE UNIQUE INDEX idx_clip_groups_auto_source_key
  ON clip_groups (auto_source_key) WHERE auto_source_key IS NOT NULL;
CREATE INDEX idx_clips_auto_source_key ON clips (auto_source_key);
-- Historical rows deliberately retain NULL keys. Discover only the exact source
-- touched by a new save, while respecting durable manual-unmerge exclusions.
CREATE INDEX idx_clips_eligible_source_url ON clips (source_url, created_at, id)
  WHERE auto_group_excluded = 0;
