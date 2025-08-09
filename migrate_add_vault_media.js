/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_vault_media.js
   Purpose: Create table for storing vault media metadata
   Created: 2025-??-?? – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS vault_media (
    id BIGINT PRIMARY KEY,
    likes INTEGER,
    tips NUMERIC,
    thumb_url TEXT,
    preview_url TEXT,
    created_at TIMESTAMP
);
`;

const alterTableQuery = `
ALTER TABLE vault_media
    ADD COLUMN IF NOT EXISTS likes INTEGER,
    ADD COLUMN IF NOT EXISTS tips NUMERIC,
    ADD COLUMN IF NOT EXISTS thumb_url TEXT,
    ADD COLUMN IF NOT EXISTS preview_url TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP;
`;

(async () => {
  try {
    await pool.query(createTableQuery);
    await pool.query(alterTableQuery);
    console.log("✅ 'vault_media' table created or already exists.");
  } catch (err) {
    console.error('Error running vault_media migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (process.exitCode) process.exit(process.exitCode);
  }
})();

/* End of File – Last modified 2025-??-?? */
