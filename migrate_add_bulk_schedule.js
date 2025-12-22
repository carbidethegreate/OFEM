/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_bulk_schedule.js
   Purpose: Create tables for bulk scheduling and logging
   Created: 2025-??-??
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

const createBulkScheduleItemsTable = `
CREATE TABLE IF NOT EXISTS bulk_schedule_items (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT,
  source_filename TEXT,
  image_url_cf TEXT,
  caption TEXT,
  schedule_time TIMESTAMPTZ,
  timezone TEXT,
  destination TEXT,
  legacy_scheduled_post_id BIGINT,
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const alterBulkScheduleItemsTable = `
ALTER TABLE bulk_schedule_items
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS source_filename TEXT,
  ADD COLUMN IF NOT EXISTS image_url_cf TEXT,
  ADD COLUMN IF NOT EXISTS caption TEXT,
  ADD COLUMN IF NOT EXISTS schedule_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS destination TEXT,
  ADD COLUMN IF NOT EXISTS legacy_scheduled_post_id BIGINT,
  ADD COLUMN IF NOT EXISTS post_media_id BIGINT,
  ADD COLUMN IF NOT EXISTS message_media_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_post_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_message_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_post_queue_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_message_queue_id BIGINT,
  ADD COLUMN IF NOT EXISTS local_status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS post_status TEXT,
  ADD COLUMN IF NOT EXISTS message_status TEXT,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
`;

const bulkLegacyIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_schedule_legacy_id
  ON bulk_schedule_items(legacy_scheduled_post_id)
  WHERE legacy_scheduled_post_id IS NOT NULL;
`;

const destinationConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'bulk_schedule_items'
      AND constraint_name = 'bulk_schedule_items_destination_check'
  ) THEN
    ALTER TABLE bulk_schedule_items
      ADD CONSTRAINT bulk_schedule_items_destination_check
      CHECK (destination IN ('post', 'message', 'both'));
  END IF;
END $$;
`;

const localStatusConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'bulk_schedule_items'
      AND constraint_name = 'bulk_schedule_items_local_status_check'
  ) THEN
    ALTER TABLE bulk_schedule_items
      ADD CONSTRAINT bulk_schedule_items_local_status_check
      CHECK (local_status IN ('draft', 'pending', 'scheduled', 'queued', 'sent', 'error'));
  END IF;
END $$;
`;

const createBulkLogsTable = `
CREATE TABLE IF NOT EXISTS bulk_logs (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT REFERENCES bulk_schedule_items(id),
  level TEXT,
  event TEXT,
  message TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const alterBulkLogsTable = `
ALTER TABLE bulk_logs
  ADD COLUMN IF NOT EXISTS item_id BIGINT REFERENCES bulk_schedule_items(id),
  ADD COLUMN IF NOT EXISTS level TEXT,
  ADD COLUMN IF NOT EXISTS event TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
`;

const logLevelConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'bulk_logs'
      AND constraint_name = 'bulk_logs_level_check'
  ) THEN
    ALTER TABLE bulk_logs
      ADD CONSTRAINT bulk_logs_level_check
      CHECK (level IN ('info', 'warn', 'error'));
  END IF;
END $$;
`;

const bulkLogsIndex = `
CREATE INDEX IF NOT EXISTS idx_bulk_logs_item_id_created_at
  ON bulk_logs (item_id, created_at);
`;

(async () => {
  try {
    await pool.query(createBulkScheduleItemsTable);
    await pool.query(alterBulkScheduleItemsTable);
    await pool.query(destinationConstraint);
    await pool.query(localStatusConstraint);
    await pool.query(bulkLegacyIndex);
    console.log("✅ 'bulk_schedule_items' table created/updated.");

    await pool.query(createBulkLogsTable);
    await pool.query(alterBulkLogsTable);
    await pool.query(logLevelConstraint);
    await pool.query(bulkLogsIndex);
    console.log("✅ 'bulk_logs' table created/updated.");
  } catch (err) {
    console.error('Error running bulk schedule migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (process.exitCode) process.exit(process.exitCode);
  }
})();

/* End of File */
