/* OnlyFans Express Messenger (OFEM)
   File: migrate_move_scheduled_posts_to_bulk.js
   Purpose: Back up legacy scheduled_posts rows and migrate them into bulk_schedule_items
   Created: 2025-??-??
*/

const dotenv = require('dotenv');
dotenv.config(); // Ensure db.js reads environment variables

const pool = require('./db');

const ensureBulkTablesSql = [
  `CREATE TABLE IF NOT EXISTS bulk_schedule_items (
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
  );`,
  `ALTER TABLE bulk_schedule_items
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
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`,
  `DO $$
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
  END $$;`,
  `DO $$
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
  END $$;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_schedule_legacy_id
    ON bulk_schedule_items(legacy_scheduled_post_id)
    WHERE legacy_scheduled_post_id IS NOT NULL;`,
];

async function tableExists(tableName) {
  const res = await pool.query(
    `SELECT to_regclass('public.' || $1) AS regclass`,
    [tableName],
  );
  return !!res.rows[0]?.regclass;
}

(async () => {
  let backedUp = 0;
  let migrated = 0;
  try {
    const hasLegacyTable = await tableExists('scheduled_posts');
    if (!hasLegacyTable) {
      console.log('ℹ️  scheduled_posts table not found; nothing to migrate.');
      return;
    }

    for (const statement of ensureBulkTablesSql) {
      await pool.query(statement);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_posts_backup (
        id BIGINT PRIMARY KEY,
        image_url TEXT,
        caption TEXT,
        schedule_time TIMESTAMPTZ,
        status TEXT,
        created_at TIMESTAMPTZ,
        backed_up_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const backupInsert = await pool.query(`
      INSERT INTO scheduled_posts_backup (id, image_url, caption, schedule_time, status, created_at)
      SELECT id, image_url, caption, schedule_time, status, created_at
      FROM scheduled_posts
      ON CONFLICT (id) DO NOTHING;
    `);
    backedUp = backupInsert.rowCount || 0;

    const migrateInsert = await pool.query(
      `
      INSERT INTO bulk_schedule_items (
        batch_id,
        source_filename,
        image_url_cf,
        caption,
        schedule_time,
        timezone,
        destination,
        local_status,
        post_status,
        message_status,
        legacy_scheduled_post_id,
        created_at,
        updated_at
      )
      SELECT
        NULL AS batch_id,
        NULL AS source_filename,
        sp.image_url AS image_url_cf,
        sp.caption,
        sp.schedule_time,
        NULL AS timezone,
        'post' AS destination,
        CASE
          WHEN LOWER(COALESCE(sp.status, '')) IN ('queued', 'sent', 'error') THEN LOWER(sp.status)
          WHEN LOWER(COALESCE(sp.status, '')) = 'pending' THEN 'scheduled'
          WHEN LOWER(COALESCE(sp.status, '')) = 'scheduled' THEN 'scheduled'
          ELSE 'scheduled'
        END AS local_status,
        CASE
          WHEN LOWER(COALESCE(sp.status, '')) IN ('queued', 'sent', 'error') THEN LOWER(sp.status)
          ELSE NULL
        END AS post_status,
        NULL AS message_status,
        sp.id AS legacy_scheduled_post_id,
        COALESCE(sp.created_at, NOW()) AS created_at,
        NOW() AS updated_at
      FROM scheduled_posts sp
      WHERE NOT EXISTS (
        SELECT 1
        FROM bulk_schedule_items b
        WHERE b.legacy_scheduled_post_id = sp.id
      );
      `,
    );
    migrated = migrateInsert.rowCount || 0;

    console.log(
      `✅ Migration complete. Backed up ${backedUp} legacy row(s); migrated ${migrated} to bulk_schedule_items.`,
    );
  } catch (err) {
    console.error('Error migrating scheduled_posts to bulk_schedule_items:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (process.exitCode) process.exit(process.exitCode);
  }
})();

/* End of File */
