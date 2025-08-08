/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_ppv_tables.js
   Purpose: Create tables for pay-per-view sets and media links
   Created: 2025-??-?? – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

// SQL to create ppv_sets table
const createPpvSetsTable = `
CREATE TABLE IF NOT EXISTS ppv_sets (
    id BIGSERIAL PRIMARY KEY,
    ppv_number INTEGER UNIQUE,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    vault_list_id BIGINT,
    created_at TIMESTAMP DEFAULT NOW()
);
`;

// SQL to create ppv_media table
const createPpvMediaTable = `
CREATE TABLE IF NOT EXISTS ppv_media (
    ppv_id BIGINT REFERENCES ppv_sets(id) ON DELETE CASCADE,
    media_id BIGINT,
    is_preview BOOLEAN
);
`;

// SQL to ensure ppv_sets columns exist
const alterPpvSetsTable = `
ALTER TABLE ppv_sets
    ADD COLUMN IF NOT EXISTS ppv_number INTEGER UNIQUE,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) NOT NULL,
    ADD COLUMN IF NOT EXISTS vault_list_id BIGINT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
`;

// SQL to ensure ppv_media columns exist
const alterPpvMediaTable = `
ALTER TABLE ppv_media
    ADD COLUMN IF NOT EXISTS ppv_id BIGINT REFERENCES ppv_sets(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS media_id BIGINT,
    ADD COLUMN IF NOT EXISTS is_preview BOOLEAN;
`;

(async () => {
  try {
    await pool.query(createPpvSetsTable);
    await pool.query(createPpvMediaTable);
    await pool.query(alterPpvSetsTable);
    await pool.query(alterPpvMediaTable);
    console.log("✅ 'ppv_sets' and 'ppv_media' tables created.");
  } catch (err) {
    console.error('Error running PPV tables migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (process.exitCode) process.exit(process.exitCode);
  }
})();

/* End of File – Last modified 2025-??-?? */
