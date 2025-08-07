/* OnlyFans Express Messenger (OFEM)
   File: migrate_scheduled_messages.js
   Purpose: Create the "scheduled_messages" table for storing queued messages
   Created: 2025-08-06 – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

// SQL to create scheduled_messages table
const createTableQuery = `
CREATE TABLE IF NOT EXISTS scheduled_messages (
    id SERIAL PRIMARY KEY,
    greeting TEXT,
    body TEXT,
    recipients JSONB,
    media_files JSONB,
    previews JSONB,
    price NUMERIC,
    locked_text TEXT,
    scheduled_at TIMESTAMP,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);
`;

(async () => {
    try {
        await pool.query(createTableQuery);
        console.log('✅ "scheduled_messages" table has been created/updated.');
    } catch (err) {
        console.error('Error running scheduled_messages migration:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
        if (process.exitCode) process.exit(process.exitCode);
    }
})();

/* End of File – Last modified 2025-08-06 */
