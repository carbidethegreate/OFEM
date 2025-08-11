/* OnlyFans Express Messenger (OFEM)
   File: migrate_messages.js
   Purpose: Create the "messages" table for storing sent/received messages
   Created: 2025-08-05 – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

// SQL to create or update messages table
// Use BIGINT for message IDs since OnlyFans message identifiers may exceed 32-bit integers.
const createTableQuery = `
CREATE TABLE IF NOT EXISTS messages (
    id BIGINT PRIMARY KEY,
    fan_id BIGINT REFERENCES fans(id),
    direction TEXT,
    body TEXT,
    price NUMERIC,
    created_at TIMESTAMP DEFAULT NOW()
);
`;

// For existing deployments: convert SERIAL integer IDs to BIGINT and drop sequence
const alterQueries = [
  // Explicitly cast existing values to BIGINT and remove auto-increment
  'ALTER TABLE messages ALTER COLUMN id TYPE BIGINT USING id::BIGINT',
  'ALTER TABLE messages ALTER COLUMN id DROP DEFAULT',
  'DROP SEQUENCE IF EXISTS messages_id_seq',
];

(async () => {
  try {
    await pool.query(createTableQuery);
    for (const q of alterQueries) {
      try {
        await pool.query(q);
      } catch {
        // Ignore errors (e.g., table already in desired state)
      }
    }
    console.log('✅ "messages" table has been created/updated.');
  } catch (err) {
    console.error('Error running messages migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (process.exitCode && !process.env.JEST_WORKER_ID)
      process.exit(process.exitCode);
  }
})();

/* End of File – Last modified 2025-08-05 */
