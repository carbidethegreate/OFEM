/* OnlyFans Express Messenger (OFEM)
   File: migrate.js
   Purpose: One-time database setup (create tables for OFEM)
   Created: 2025-08-02 – v1.0
*/

const dotenv = require('dotenv');
dotenv.config();  // Load environment variables (ensure .env is loaded for db.js)

const pool = require('./db');  // Import the database pool from db.js

// Define the SQL query to create the "fans" table with required columns
const createTableQuery = `
CREATE TABLE IF NOT EXISTS fans (
    id BIGINT PRIMARY KEY,
    username TEXT,
    name TEXT,
    avatar TEXT,
    header TEXT,
    website TEXT,
    location TEXT,
    gender TEXT,
    birthday TEXT,
    about TEXT,
    notes TEXT,
    lastSeen TEXT,
    joined TEXT,
    canReceiveChatMessage BOOLEAN,
    canSendChatMessage BOOLEAN,
    isBlocked BOOLEAN,
    isMuted BOOLEAN,
    isRestricted BOOLEAN,
    isHidden BOOLEAN,
    isBookmarked BOOLEAN,
    isSubscribed BOOLEAN,
    subscribedBy TEXT,
    subscribedOn TEXT,
    subscribedUntil TEXT,
    renewedAd BOOLEAN,
    isFriend BOOLEAN,
    tipsSum INTEGER,
    postsCount INTEGER,
    photosCount INTEGER,
    videosCount INTEGER,
    audiosCount INTEGER,
    mediaCount INTEGER,
    subscribersCount INTEGER,
    favoritesCount INTEGER,
    avatarThumbs JSONB,
    headerSize JSONB,
    headerThumbs JSONB,
    listsStates JSONB,
    subscribedByData JSONB,
    subscribedOnData JSONB,
    promoOffers JSONB,
    parker_name TEXT,
    is_custom BOOLEAN DEFAULT FALSE,
    updatedAt TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

// For existing deployments, ensure all new columns are present
const addColumnsQuery = `
ALTER TABLE fans
    ADD COLUMN IF NOT EXISTS username TEXT,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS avatar TEXT,
    ADD COLUMN IF NOT EXISTS header TEXT,
    ADD COLUMN IF NOT EXISTS website TEXT,
    ADD COLUMN IF NOT EXISTS location TEXT,
    ADD COLUMN IF NOT EXISTS gender TEXT,
    ADD COLUMN IF NOT EXISTS birthday TEXT,
    ADD COLUMN IF NOT EXISTS about TEXT,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS lastSeen TEXT,
    ADD COLUMN IF NOT EXISTS joined TEXT,
    ADD COLUMN IF NOT EXISTS canReceiveChatMessage BOOLEAN,
    ADD COLUMN IF NOT EXISTS canSendChatMessage BOOLEAN,
    ADD COLUMN IF NOT EXISTS isBlocked BOOLEAN,
    ADD COLUMN IF NOT EXISTS isMuted BOOLEAN,
    ADD COLUMN IF NOT EXISTS isRestricted BOOLEAN,
    ADD COLUMN IF NOT EXISTS isHidden BOOLEAN,
    ADD COLUMN IF NOT EXISTS isBookmarked BOOLEAN,
    ADD COLUMN IF NOT EXISTS isSubscribed BOOLEAN,
    ADD COLUMN IF NOT EXISTS subscribedBy TEXT,
    ADD COLUMN IF NOT EXISTS subscribedOn TEXT,
    ADD COLUMN IF NOT EXISTS subscribedUntil TEXT,
    ADD COLUMN IF NOT EXISTS renewedAd BOOLEAN,
    ADD COLUMN IF NOT EXISTS isFriend BOOLEAN,
    ADD COLUMN IF NOT EXISTS tipsSum INTEGER,
    ADD COLUMN IF NOT EXISTS postsCount INTEGER,
    ADD COLUMN IF NOT EXISTS photosCount INTEGER,
    ADD COLUMN IF NOT EXISTS videosCount INTEGER,
    ADD COLUMN IF NOT EXISTS audiosCount INTEGER,
    ADD COLUMN IF NOT EXISTS mediaCount INTEGER,
    ADD COLUMN IF NOT EXISTS subscribersCount INTEGER,
    ADD COLUMN IF NOT EXISTS favoritesCount INTEGER,
    ADD COLUMN IF NOT EXISTS avatarThumbs JSONB,
    ADD COLUMN IF NOT EXISTS headerSize JSONB,
    ADD COLUMN IF NOT EXISTS headerThumbs JSONB,
    ADD COLUMN IF NOT EXISTS listsStates JSONB,
    ADD COLUMN IF NOT EXISTS subscribedByData JSONB,
    ADD COLUMN IF NOT EXISTS subscribedOnData JSONB,
    ADD COLUMN IF NOT EXISTS promoOffers JSONB,
    ADD COLUMN IF NOT EXISTS parker_name TEXT,
    ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updatedAt TIMESTAMP NOT NULL DEFAULT NOW();
`;

/*
 Columns:
 - id: OnlyFans user ID of the fan (stored as a big integer).
 - username: the fan's profile username or display name.
 - name: the fan's account name from OnlyFans.
 - parker_name: the custom name given to the fan (to personalize messages).
 - is_custom: flag showing if parker_name was manually set.
 - updatedAt: timestamp of the last update to this fan record (defaults to now on insert).
*/

(async () => {
    try {
        await pool.query(createTableQuery);
        await pool.query(addColumnsQuery);
        console.log('✅ "fans" table has been created/updated.');
    } catch (err) {
        console.error('Error running migration:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
        if (process.exitCode) process.exit(process.exitCode);
    }
})();

/* End of File – Last modified 2025-08-02 */
