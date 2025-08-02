/* OnlyFans Express Messenger (OFEM)
   File: setup-db.js
   Purpose: One-click database setup wizard
   Created: 2025-08-02 – v1.0
*/

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

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

// Run a shell command and return a promise.
function execAsync(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

// Wait until PostgreSQL accepts connections.
async function waitForPostgres(config, retries = 10) {
    for (let i = 0; i < retries; i++) {
        const client = new Client(config);
        try {
            await client.connect();
            await client.end();
            return true;
        } catch (err) {
            await new Promise(res => setTimeout(res, 1000));
        }
    }
    return false;
}

// Ensure PostgreSQL is reachable, starting docker if necessary.
async function ensurePostgres(adminConfig) {
    try {
        const testClient = new Client(adminConfig);
        await testClient.connect();
        await testClient.end();
        return true;
    } catch (err) {
        console.log('PostgreSQL not reachable, attempting to start via docker compose...');
        // First confirm docker is installed; otherwise the user needs to install or start Postgres manually.
        try {
            await execAsync('docker --version');
        } catch (e) {
            console.error('Docker is not installed. Please install Docker Desktop or start PostgreSQL manually.');
            return false;
        }
        try {
            await execAsync('docker compose up -d db');
            const ready = await waitForPostgres(adminConfig);
            return ready;
        } catch (e) {
            console.error('Failed to start PostgreSQL via docker compose:', e.message);
            return false;
        }
    }
}

async function main() {
    try {
        console.log('🧙 Starting database setup wizard...');
        const dbName = 'ofem_' + crypto.randomBytes(4).toString('hex');
        const dbUser = 'user_' + crypto.randomBytes(4).toString('hex');
        const dbPassword = crypto.randomBytes(10).toString('hex');
        console.log(`Generated database name: ${dbName}`);
        console.log(`Generated user: ${dbUser}`);

        // Step 1: connect as admin user
        const adminConfig = {
            user: process.env.DB_ADMIN_USER || 'postgres',
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: 'postgres'
        };
        if (process.env.DB_ADMIN_PASSWORD) {
            adminConfig.password = process.env.DB_ADMIN_PASSWORD;
        }

        console.log('Connecting to PostgreSQL...');
        const ok = await ensurePostgres(adminConfig);
        if (!ok) {
            throw new Error('Could not connect to PostgreSQL. Is it running?');
        }
        const adminClient = new Client(adminConfig);
        await adminClient.connect();
        await adminClient.query(`CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword}'`);
        await adminClient.query(`CREATE DATABASE "${dbName}" OWNER "${dbUser}"`);
        await adminClient.end();
        console.log('Database and user created.');

        // Step 2: create table in the new database
        const newClient = new Client({
            user: dbUser,
            password: dbPassword,
            host: adminConfig.host,
            port: adminConfig.port,
            database: dbName
        });
        await newClient.connect();
        await newClient.query(createTableQuery);
        await newClient.end();
        console.log('Fans table created.');

        // Step 3: update .env with new credentials, preserving other values
        const envPath = path.join(__dirname, '.env');
        const exampleEnvPath = path.join(__dirname, '.env.example');
        if (!fs.existsSync(envPath) && fs.existsSync(exampleEnvPath)) {
            fs.copyFileSync(exampleEnvPath, envPath);
        }
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }
        const setEnv = (key, value) => {
            const regex = new RegExp(`^${key}=.*$`, 'm');
            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `${key}=${value}`);
            } else {
                envContent += `\n${key}=${value}`;
            }
        };
        const ensureEnv = (key, value) => {
            const regex = new RegExp(`^${key}=.*$`, 'm');
            if (!regex.test(envContent)) {
                envContent += `\n${key}=${value}`;
            }
        };
        setEnv('DB_NAME', dbName);
        setEnv('DB_USER', dbUser);
        setEnv('DB_PASSWORD', dbPassword);
        ensureEnv('DB_HOST', adminConfig.host);
        ensureEnv('DB_PORT', adminConfig.port);
        if (!envContent.endsWith('\n')) envContent += '\n';
        fs.writeFileSync(envPath, envContent);
        console.log('.env file updated.');

        console.log('✅ Database setup complete!');
        console.log(`   DB_NAME=${dbName}`);
        console.log(`   DB_USER=${dbUser}`);
        console.log(`   DB_PASSWORD=${dbPassword}`);
        console.log('Add your API keys to .env and run ./start.command to launch the app.');
    } catch (err) {
        console.error('❌ Setup failed:', err.message || err);
        if (err.stack) console.error(err.stack);
        process.exit(1);
    }
}

main();

/* End of File – Last modified 2025-08-02 */
