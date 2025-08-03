/* OnlyFans Express Messenger (OFEM)
   File: migrate_messages.js
   Purpose: Create the "messages" table for storing sent/received messages
   Created: 2025-08-05 – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

// SQL to create messages table
const createTableQuery = `
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    fan_id BIGINT REFERENCES fans(id),
    direction TEXT,
    body TEXT,
    price NUMERIC,
    created_at TIMESTAMP DEFAULT NOW()
);
`;

(async () => {
    try {
        await pool.query(createTableQuery);
        console.log('✅ "messages" table has been created/updated.');
    } catch (err) {
        console.error('Error running messages migration:', err.message);
    } finally {
        await pool.end();
    }
})();

/* End of File – Last modified 2025-08-05 */
