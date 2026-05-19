-- Strava Integration Migration

CREATE TABLE IF NOT EXISTS strava_connections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    BIGINT,
  strava_athlete_id BIGINT,
  athlete_name  VARCHAR(255),
  connected_at  TIMESTAMPTZ DEFAULT NOW(),
  last_sync_at  TIMESTAMPTZ,
  sync_status   VARCHAR(20) DEFAULT 'connected'
);

ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS source      VARCHAR(20) DEFAULT 'manual';
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_history_user_external
  ON activity_history(user_id, external_id)
  WHERE external_id IS NOT NULL;
