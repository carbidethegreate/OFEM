/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_scheduled_items.js
   Purpose: Create tables for scheduled items and their logs
   Created: 2025-??-?? – v1.0
*/

const dotenv = require('dotenv');
dotenv.config();

const pool = require('./db');

const createScheduledItemsTable = `
CREATE TABLE IF NOT EXISTS scheduled_items (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT,
  source_filename TEXT,
  image_url_cf TEXT,
  caption TEXT,
  schedule_time TIMESTAMPTZ,
  timezone TEXT,
  destination TEXT,
  mode TEXT DEFAULT 'both',
  both_disabled BOOLEAN DEFAULT FALSE,
  legacy_scheduled_post_id BIGINT,
  post_media_id BIGINT,
  of_media_id_post BIGINT,
  message_media_id BIGINT,
  of_media_id_message BIGINT,
  of_post_id BIGINT,
  of_message_id BIGINT,
  of_queue_id_post BIGINT,
  of_message_queue_id BIGINT,
  of_message_batch_id BIGINT,
  local_status TEXT DEFAULT 'draft',
  status TEXT DEFAULT 'draft',
  post_status TEXT,
  message_status TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const alterScheduledItemsTable = `
ALTER TABLE scheduled_items
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS source_filename TEXT,
  ADD COLUMN IF NOT EXISTS image_url_cf TEXT,
  ADD COLUMN IF NOT EXISTS caption TEXT,
  ADD COLUMN IF NOT EXISTS schedule_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS destination TEXT,
  ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS both_disabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS legacy_scheduled_post_id BIGINT,
  ADD COLUMN IF NOT EXISTS post_media_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_media_id_post BIGINT,
  ADD COLUMN IF NOT EXISTS message_media_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_media_id_message BIGINT,
  ADD COLUMN IF NOT EXISTS of_post_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_message_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_queue_id_post BIGINT,
  ADD COLUMN IF NOT EXISTS of_message_queue_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_message_batch_id BIGINT,
  ADD COLUMN IF NOT EXISTS local_status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS post_status TEXT,
  ADD COLUMN IF NOT EXISTS message_status TEXT,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
`;

const modeConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'scheduled_items'
      AND constraint_name = 'scheduled_items_mode_check'
  ) THEN
    ALTER TABLE scheduled_items
      ADD CONSTRAINT scheduled_items_mode_check
      CHECK (mode IN ('post', 'message', 'both'));
  END IF;
END $$;
`;

const destinationConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'scheduled_items'
      AND constraint_name = 'scheduled_items_destination_check'
  ) THEN
    ALTER TABLE scheduled_items
      ADD CONSTRAINT scheduled_items_destination_check
      CHECK (destination IN ('post', 'message', 'both'));
  END IF;
END $$;
`;

const statusConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'scheduled_items'
      AND constraint_name = 'scheduled_items_status_check'
  ) THEN
    ALTER TABLE scheduled_items
      ADD CONSTRAINT scheduled_items_status_check
      CHECK (status IN (
        'draft', 'pending', 'scheduled', 'queued', 'sent', 'error', 'processing', 'in_queue', 'waiting'
      ));
  END IF;
END $$;
`;

const legacyIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_items_legacy_id
  ON scheduled_items(legacy_scheduled_post_id)
  WHERE legacy_scheduled_post_id IS NOT NULL;
`;

const createScheduledItemLogsTable = `
CREATE TABLE IF NOT EXISTS scheduled_item_logs (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT REFERENCES scheduled_items(id) ON DELETE CASCADE,
  level TEXT,
  event TEXT,
  message TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const alterScheduledItemLogsTable = `
ALTER TABLE scheduled_item_logs
  ADD COLUMN IF NOT EXISTS item_id BIGINT REFERENCES scheduled_items(id) ON DELETE CASCADE,
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
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'scheduled_item_logs'
      AND constraint_name = 'scheduled_item_logs_level_check'
  ) THEN
    ALTER TABLE scheduled_item_logs
      ADD CONSTRAINT scheduled_item_logs_level_check
      CHECK (level IN ('info', 'warn', 'error'));
  END IF;
END $$;
`;

const logsIndex = `
CREATE INDEX IF NOT EXISTS idx_scheduled_item_logs_item_id_created_at
  ON scheduled_item_logs (item_id, created_at);
`;

async function runScheduledItemsMigration({ pool: poolOverride } = {}) {
  const client = poolOverride || pool;
  await client.query(createScheduledItemsTable);
  await client.query(alterScheduledItemsTable);
  await client.query(modeConstraint);
  await client.query(destinationConstraint);
  await client.query(statusConstraint);
  await client.query(legacyIndex);
  await client.query(createScheduledItemLogsTable);
  await client.query(alterScheduledItemLogsTable);
  await client.query(logLevelConstraint);
  await client.query(logsIndex);
}

(async () => {
  if (require.main !== module) return;
  try {
    await runScheduledItemsMigration();
    console.log("✅ 'scheduled_items' and 'scheduled_item_logs' tables created/updated.");
  } catch (err) {
    console.error('Error running scheduled items migration:', err.message);
    process.exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch {}
    if (process.exitCode) process.exit(process.exitCode);
  }
})();

module.exports = { runScheduledItemsMigration };

/* End of File */
