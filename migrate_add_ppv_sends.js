/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_ppv_sends.js
   Purpose: Create table for logging one-off PPV sends
   Created: 2025-??-?? – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS ppv_sends (
    id BIGSERIAL PRIMARY KEY,
    ppv_id BIGINT REFERENCES ppv_sets(id) ON DELETE CASCADE,
    fan_id BIGINT,
    sent_at TIMESTAMP DEFAULT NOW()
);
`;

(async () => {
  try {
    await pool.query(createTableQuery);
    console.log("✅ 'ppv_sends' table created or already exists.");
  } catch (err) {
    console.error('Error running ppv_sends migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (process.exitCode) process.exit(process.exitCode);
  }
})();

/* End of File – Last modified 2025-??-?? */
