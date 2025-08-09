/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_vault_lists.js
   Purpose: Create tables for vault lists and media relationships
   Created: 2025-??-?? – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

const createVaultListsTable = `
CREATE TABLE IF NOT EXISTS vault_lists (
    id BIGINT PRIMARY KEY,
    name TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
`;

const createVaultListMediaTable = `
CREATE TABLE IF NOT EXISTS vault_list_media (
    list_id BIGINT REFERENCES vault_lists(id) ON DELETE CASCADE,
    media_id BIGINT,
    PRIMARY KEY (list_id, media_id)
);
`;

const alterVaultListsTable = `
ALTER TABLE vault_lists
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
`;

const alterVaultListMediaTable = `
ALTER TABLE vault_list_media
    ADD COLUMN IF NOT EXISTS list_id BIGINT REFERENCES vault_lists(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS media_id BIGINT;
`;

(async () => {
  try {
    await pool.query(createVaultListsTable);
    await pool.query(createVaultListMediaTable);
    await pool.query(alterVaultListsTable);
    await pool.query(alterVaultListMediaTable);
    console.log("✅ 'vault_lists' and 'vault_list_media' tables created.");
  } catch (err) {
    console.error('Error running vault lists migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (process.exitCode) process.exit(process.exitCode);
  }
})();

/* End of File – Last modified 2025-??-?? */
