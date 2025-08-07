/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_ppv_schedule_fields.js
   Purpose: Add scheduling fields to PPV sets
   Created: 2025-??-?? – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

// Check if schedule_day column already exists
const checkScheduleDayQuery = `
SELECT 1
FROM information_schema.columns
WHERE table_name = 'ppv_sets' AND column_name = 'schedule_day';
`;

// SQL to add scheduling columns to ppv_sets table
const alterPpvSetsSchedule = `
ALTER TABLE IF EXISTS ppv_sets
    ADD COLUMN IF NOT EXISTS schedule_day INTEGER;
ALTER TABLE IF EXISTS ppv_sets
    ADD COLUMN IF NOT EXISTS schedule_time TEXT;
ALTER TABLE IF EXISTS ppv_sets
    ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMP;
`;

(async () => {
    try {
        const { rowCount } = await pool.query(checkScheduleDayQuery);
        if (rowCount > 0) {
            console.log('PPV schedule fields already present');
            return;
        }
        await pool.query(alterPpvSetsSchedule);
        console.log("✅ 'ppv_sets' table altered with scheduling fields.");
    } catch (err) {
        console.error('Error running PPV schedule migration:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
        if (process.exitCode) process.exit(process.exitCode);
    }
})();

/* End of File – Last modified 2025-??-?? */
