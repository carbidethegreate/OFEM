/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_fan_fields.js
   Purpose: Add newly required columns to the "fans" table
   Created: 2025-08-05 – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

// List of columns to ensure exist on the fans table
const columns = [
  ['username', 'TEXT'],
  ['name', 'TEXT'],
  ['avatar', 'TEXT'],
  ['header', 'TEXT'],
  ['website', 'TEXT'],
  ['location', 'TEXT'],
  ['gender', 'TEXT'],
  ['birthday', 'TEXT'],
  ['about', 'TEXT'],
  ['notes', 'TEXT'],
  ['lastSeen', 'TEXT'],
  ['joined', 'TEXT'],
  ['canReceiveChatMessage', 'BOOLEAN'],
  ['canSendChatMessage', 'BOOLEAN'],
  ['isBlocked', 'BOOLEAN'],
  ['isMuted', 'BOOLEAN'],
  ['isRestricted', 'BOOLEAN'],
  ['isHidden', 'BOOLEAN'],
  ['isBookmarked', 'BOOLEAN'],
  ['issubscribed', 'BOOLEAN'],
  ['subscribedBy', 'TEXT'],
  ['subscribedOn', 'TEXT'],
  ['subscribedUntil', 'TEXT'],
  ['renewedAd', 'BOOLEAN'],
  ['isFriend', 'BOOLEAN'],
  ['tipsSum', 'INTEGER'],
  ['postsCount', 'INTEGER'],
  ['photosCount', 'INTEGER'],
  ['videosCount', 'INTEGER'],
  ['audiosCount', 'INTEGER'],
  ['mediaCount', 'INTEGER'],
  ['subscribersCount', 'INTEGER'],
  ['favoritesCount', 'INTEGER'],
  ['avatarThumbs', 'JSONB'],
  ['headerSize', 'JSONB'],
  ['headerThumbs', 'JSONB'],
  ['listsStates', 'JSONB'],
  ['subscribedByData', 'JSONB'],
  ['subscribedOnData', 'JSONB'],
  ['promoOffers', 'JSONB'],
  ['parker_name', 'TEXT'],
  ['is_custom', 'BOOLEAN DEFAULT FALSE'],
  ['updatedAt', 'TIMESTAMP NOT NULL DEFAULT NOW()'],
];

(async () => {
  try {
    const { rows: colRows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'fans';`
    );
    const hasCamel = colRows.some((r) => r.column_name === 'isSubscribed');
    const hasLower = colRows.some((r) => r.column_name === 'issubscribed');
    if (hasCamel && !hasLower) {
      await pool.query(
        'ALTER TABLE fans RENAME COLUMN "isSubscribed" TO issubscribed;'
      );
    }

    for (const [name, type] of columns) {
      const sql = `ALTER TABLE fans ADD COLUMN IF NOT EXISTS ${name} ${type};`;
      await pool.query(sql);
    }
    // Ensure a stable identifier exists for sending
    await pool.query(`
      ALTER TABLE fans
      ADD COLUMN IF NOT EXISTS of_user_id TEXT;
    `);
    // Dynamically populate of_user_id from whichever legacy id columns exist
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'fans';
    `);
    const existingCols = rows.map(r => r.column_name.toLowerCase());
    const idCols = ['ofuserid', 'user_id', 'userid', 'id'].filter(c => existingCols.includes(c));
    if (idCols.length) {
      const coalesceExpr = idCols.map(c => `${c}::text`).join(', ');
      await pool.query(`
        UPDATE fans
        SET of_user_id = COALESCE(${coalesceExpr})
        WHERE of_user_id IS NULL;
      `);
    }
    // Track active fans (optional heuristic based on subscription)
    await pool.query(`
      ALTER TABLE fans
      ADD COLUMN IF NOT EXISTS active BOOLEAN;
    `);

    // Determine which legacy subscription columns exist to avoid referencing
    // non-existent columns in the update query (which would cause an error on
    // some databases). Possible legacy columns include:
    // - subscribed
    // - is_subscribed
    // - issubscribed
    // - isSubscribed
    const subscriptionCols = ['subscribed', 'is_subscribed', 'issubscribed']
      .map((c) => c.toLowerCase())
      .filter((c) => existingCols.includes(c));

    let updateActiveSql = 'UPDATE fans SET active = TRUE WHERE active IS NULL';
    if (subscriptionCols.length) {
      const coalesce = subscriptionCols
        .map((c) => `${c}::boolean`)
        .join(', ');
      updateActiveSql += ` AND (COALESCE(${coalesce}, TRUE) = TRUE)`;
    }
    await pool.query(updateActiveSql);
    console.log('✅ Fan fields migration complete.');
  } catch (err) {
    console.error('Error running fan fields migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (process.exitCode) process.exit(process.exitCode);
  }
})();

/* End of File – Last modified 2025-08-05 */
