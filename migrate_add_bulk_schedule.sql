-- Bulk scheduling and logging tables

CREATE TABLE IF NOT EXISTS bulk_schedule_items (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT,
  source_filename TEXT,
  image_url_cf TEXT,
  caption TEXT,
  schedule_time TIMESTAMPTZ,
  timezone TEXT,
  destination TEXT,
  post_media_id BIGINT,
  message_media_id BIGINT,
  of_post_id BIGINT,
  of_message_id BIGINT,
  of_post_queue_id BIGINT,
  of_message_queue_id BIGINT,
  local_status TEXT DEFAULT 'draft',
  post_status TEXT,
  message_status TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT bulk_schedule_items_destination_check CHECK (destination IN ('post', 'message', 'both')),
  CONSTRAINT bulk_schedule_items_local_status_check CHECK (local_status IN ('draft', 'pending', 'scheduled', 'queued', 'sent', 'error'))
);

CREATE TABLE IF NOT EXISTS bulk_logs (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT REFERENCES bulk_schedule_items(id),
  level TEXT,
  event TEXT,
  message TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT bulk_logs_level_check CHECK (level IN ('info', 'warn', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_bulk_logs_item_id_created_at
  ON bulk_logs (item_id, created_at);
