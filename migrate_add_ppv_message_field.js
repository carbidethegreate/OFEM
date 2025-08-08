/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_ppv_message_field.js
   Purpose: Add message field to PPV sets
   Created: 2025-??-?? – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

// Check if message column already exists
const checkMessageQuery = `
SELECT 1
FROM information_schema.columns
WHERE table_name = 'ppv_sets' AND column_name = 'message';
`;

// SQL to add message column to ppv_sets table
const alterPpvSetsMessage = `
ALTER TABLE IF EXISTS ppv_sets
    ADD COLUMN IF NOT EXISTS message TEXT;
`;

(async () => {
  try {
    const { rowCount } = await pool.query(checkMessageQuery);
    if (rowCount > 0) {
      console.log('PPV message field already present');
      return;
    }
    await pool.query(alterPpvSetsMessage);
    console.log("✅ 'ppv_sets' table altered with message field.");
  } catch (err) {
    console.error('Error running PPV message migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (process.exitCode) process.exit(process.exitCode);
  }
})();

/* End of File – Last modified 2025-??-?? */
