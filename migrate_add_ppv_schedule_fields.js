/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_ppv_schedule_fields.js
   Purpose: Add scheduling fields to PPV sets
   Created: 2025-??-?? – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

// SQL to add scheduling columns to ppv_sets table
const alterPpvSetsSchedule = `
ALTER TABLE ppv_sets
    ADD COLUMN IF NOT EXISTS schedule_day INTEGER,
    ADD COLUMN IF NOT EXISTS schedule_time TEXT,
    ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMP;
`;

(async () => {
    try {
        await pool.query(alterPpvSetsSchedule);
        console.log("✅ 'ppv_sets' table altered with scheduling fields.");
    } catch (err) {
        console.error('Error running PPV schedule migration:', err.message);
    } finally {
        await pool.end();
    }
})();

/* End of File – Last modified 2025-??-?? */
