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
    parker_name TEXT,
    is_custom BOOLEAN DEFAULT FALSE,
    updatedAt TIMESTAMP NOT NULL DEFAULT NOW()
);
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
        console.log('✅ "fans" table has been created (if it did not exist already).');
    } catch (err) {
        console.error('Error running migration:', err.message);
    } finally {
        await pool.end();
    }
})();

/* End of File – Last modified 2025-08-02 */
