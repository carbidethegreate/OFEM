/* OnlyFans Express Messenger (OFEM)
   File: migrate_add_scheduled_posts.js
   Purpose: Create table for scheduled bulk posts
   Created: 2025-??-??
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables for db.js

const pool = require('./db');

const createScheduledPostsTable = `
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id BIGSERIAL PRIMARY KEY,
  image_url TEXT,
  caption TEXT,
  schedule_time TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`;

const alterScheduledPostsTable = `
ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS caption TEXT,
  ADD COLUMN IF NOT EXISTS schedule_time TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
`;

(async () => {
  try {
    await pool.query(createScheduledPostsTable);
    await pool.query(alterScheduledPostsTable);
    console.log("✅ 'scheduled_posts' table created/updated.");
  } catch (err) {
    console.error('Error running scheduled posts migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (process.exitCode) process.exit(process.exitCode);
  }
})();

/* End of File */
