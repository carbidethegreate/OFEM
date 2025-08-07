/* OnlyFans Express Messenger (OFEM)
   File: db.js
   Purpose: Database connection setup for OFEM (uses PostgreSQL)
   Created: 2025-08-02 – v1.0
*/

const dotenv = require('dotenv');
dotenv.config();  // Load environment variables from .env file

const { Client, Pool } = require('pg');

// Read database configuration from environment
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 5432;

// Helper to detect permission-related errors
function isPermissionError(err) {
    return err && (err.code === '42501' || /permission denied/i.test(err.message));
}

// Function to ensure the database exists. If it doesn't, create it.
async function ensureDatabaseExists() {
    const defaultConfig = {
        user: DB_USER,
        password: DB_PASSWORD,
        host: DB_HOST,
        port: DB_PORT,
        database: 'postgres'
    };
    const client = new Client(defaultConfig);
    try {
        await client.connect();
        const checkDb = await client.query(
            `SELECT 1 FROM pg_database WHERE datname = $1`,
            [DB_NAME]
        );
        if (checkDb.rowCount === 0) {
            try {
                await client.query(`CREATE DATABASE ${DB_NAME}`);
                console.log(`✅ Database "${DB_NAME}" created successfully.`);
            } catch (createErr) {
                if (isPermissionError(createErr)) {
                    console.warn(
                        `⚠️  Insufficient privileges to create database "${DB_NAME}". Please create it manually.`
                    );
                } else {
                    throw createErr;
                }
            }
        } else {
            console.log(`Database "${DB_NAME}" already exists.`);
        }
    } catch (err) {
        if (isPermissionError(err)) {
            console.warn(
                `⚠️  Unable to verify or create database "${DB_NAME}" due to insufficient privileges. Assuming it already exists.`
            );
        } else {
            console.error(`Error ensuring database exists: ${err.message}`);
            throw err; // Rethrow to allow caller to handle and exit appropriately
        }
    } finally {
        try {
            await client.end();
        } catch (_) {
            // ignore
        }
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
    database: DB_NAME
});

module.exports = pool;
module.exports.ensureDatabaseExists = ensureDatabaseExists;

/* End of File – Last modified 2025-08-02 */
