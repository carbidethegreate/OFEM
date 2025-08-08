/* OnlyFans Express Messenger (OFEM)
   File: db.js
   Purpose: Database connection setup for OFEM (uses PostgreSQL)
   Created: 2025-08-02 – v1.0
*/

const dotenv = require('dotenv');
dotenv.config(); // Load environment variables from .env file

const { Client, Pool } = require('pg');

// Read database configuration from environment
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 5432;

// Function to ensure the database exists. If it doesn't, create it (when permitted).
async function ensureDatabaseExists() {
  // First, try connecting directly to the target database. If this succeeds, the
  // database already exists and no further action is required.
  const appClient = new Client({
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
  });
  try {
    await appClient.connect();
    console.log(`Database "${DB_NAME}" already exists.`);
    return;
  } catch (err) {
    // If the database does not exist, PostgreSQL uses code 3D000
    if (err.code !== '3D000') {
      console.error(
        `Error connecting to database "${DB_NAME}": ${err.message}`,
      );
      throw err;
    }
  } finally {
    try {
      await appClient.end();
    } catch (e) {}
  }

  // Database is missing. Attempt to connect to the default "postgres" DB and
  // create it. Restricted users may not be allowed to create databases, so we
  // handle insufficient privilege errors gracefully.
  const defaultConfig = {
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    port: DB_PORT,
    database: 'postgres',
  };
  const client = new Client(defaultConfig);
  try {
    await client.connect();
  } catch (err) {
    if (err.code === '42501' || /permission denied/i.test(err.message)) {
      console.warn(
        `⚠️  Permission denied to connect to default database "postgres". ` +
          `Database "${DB_NAME}" must be created manually.`,
      );
      return;
    }
    console.error(`Error connecting to default database: ${err.message}`);
    throw err;
  }

  try {
    await client.query(`CREATE DATABASE ${DB_NAME}`);
    console.log(`✅ Database "${DB_NAME}" created successfully.`);
  } catch (err) {
    if (err.code === '42501' || /permission denied/i.test(err.message)) {
      console.warn(
        `⚠️  Permission denied to create database "${DB_NAME}". It must exist before running.`,
      );
    } else {
      console.error(`Error ensuring database exists: ${err.message}`);
      throw err; // Rethrow to allow caller to handle and exit appropriately
    }
  } finally {
    try {
      await client.end();
    } catch (e) {}
  }
}

// Immediately ensure the database exists before proceeding
(async () => {
  try {
    await ensureDatabaseExists();
  } catch (err) {
    // Fail fast if database setup is incorrect
    process.exit(1);
  }
})();

// Create a connection pool to the application database
const pool = new Pool({
  user: DB_USER,
  password: DB_PASSWORD,
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
});

module.exports = pool;

/* End of File – Last modified 2025-08-02 */
