/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_scheduled_items.js
   Purpose: Create tables for scheduled items and their logs
*/

const dotenv = require('dotenv');
dotenv.config();

const pool = require('./db');

const createScheduledItemsTable = `
CREATE TABLE IF NOT EXISTS scheduled_items (
  id BIGSERIAL PRIMARY KEY,
  source_filename TEXT,
  media_url TEXT,
  caption TEXT,
  message_body TEXT,
  schedule_time TIMESTAMPTZ,
  timezone TEXT,
  mode TEXT DEFAULT 'both',
  status TEXT DEFAULT 'ready',
  upload_strategy_note TEXT,
  of_media_id_post BIGINT,
  of_media_id_message BIGINT,
  of_queue_id_post BIGINT,
  of_message_batch_id TEXT,
  of_message_job_id TEXT,
  post_status TEXT,
  message_status TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const alterScheduledItemsTable = `
ALTER TABLE scheduled_items
  ADD COLUMN IF NOT EXISTS source_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS caption TEXT,
  ADD COLUMN IF NOT EXISTS message_body TEXT,
  ADD COLUMN IF NOT EXISTS schedule_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS upload_strategy_note TEXT,
  ADD COLUMN IF NOT EXISTS of_media_id_post BIGINT,
  ADD COLUMN IF NOT EXISTS of_media_id_message BIGINT,
  ADD COLUMN IF NOT EXISTS of_queue_id_post BIGINT,
  ADD COLUMN IF NOT EXISTS of_message_batch_id TEXT,
  ADD COLUMN IF NOT EXISTS of_message_job_id TEXT,
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
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'scheduled_items'
      AND constraint_name = 'scheduled_items_mode_check'
  ) THEN
    ALTER TABLE scheduled_items
      ADD CONSTRAINT scheduled_items_mode_check
      CHECK (mode IN ('post', 'message', 'both'));
  END IF;
END $$;
`;

const statusConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'scheduled_items'
      AND constraint_name = 'scheduled_items_status_check'
  ) THEN
    ALTER TABLE scheduled_items
      ADD CONSTRAINT scheduled_items_status_check
      CHECK (status IN ('ready', 'queued', 'sent', 'error', 'scheduled'));
  END IF;
END $$;
`;

const createScheduledItemLogsTable = `
CREATE TABLE IF NOT EXISTS scheduled_item_logs (
  id BIGSERIAL PRIMARY KEY,
  scheduled_item_id BIGINT REFERENCES scheduled_items(id) ON DELETE CASCADE,
  step TEXT,
  phase TEXT,
  level TEXT,
  message TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const alterScheduledItemLogsTable = `
ALTER TABLE scheduled_item_logs
  ADD COLUMN IF NOT EXISTS scheduled_item_id BIGINT REFERENCES scheduled_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS step TEXT,
  ADD COLUMN IF NOT EXISTS phase TEXT,
  ADD COLUMN IF NOT EXISTS level TEXT,
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
    WHERE table_name = 'scheduled_item_logs'
      AND constraint_name = 'scheduled_item_logs_level_check'
  ) THEN
    ALTER TABLE scheduled_item_logs
      ADD CONSTRAINT scheduled_item_logs_level_check
      CHECK (level IN ('info', 'warn', 'error'));
  END IF;
END $$;
`;

const scheduledItemLogsIndex = `
CREATE INDEX IF NOT EXISTS idx_scheduled_item_logs_item_id_created_at
  ON scheduled_item_logs (scheduled_item_id, created_at);
`;

(async () => {
  try {
    await pool.query(createScheduledItemsTable);
    await pool.query(alterScheduledItemsTable);
    await pool.query(modeConstraint);
    await pool.query(statusConstraint);
    console.log("✅ 'scheduled_items' table created/updated.");

    await pool.query(createScheduledItemLogsTable);
    await pool.query(alterScheduledItemLogsTable);
    await pool.query(logLevelConstraint);
    await pool.query(scheduledItemLogsIndex);
    console.log("✅ 'scheduled_item_logs' table created/updated.");
  } catch (err) {
    console.error('Error running scheduled items migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (process.exitCode) process.exit(process.exitCode);
  }
})();

/* End of File */
