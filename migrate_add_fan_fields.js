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
  ['isSubscribed', 'BOOLEAN'],
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
    for (const [name, type] of columns) {
      const sql = `ALTER TABLE fans ADD COLUMN IF NOT EXISTS ${name} ${type};`;
      await pool.query(sql);
    }
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
