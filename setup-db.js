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
const dotenv = require('dotenv');

dotenv.config();

const createTableQuery = `
CREATE TABLE IF NOT EXISTS fans (
    id BIGINT PRIMARY KEY,
    username TEXT,
    name TEXT,
    avatar TEXT,
    header TEXT,
    website TEXT,
    location TEXT,
    gender TEXT,
    birthday TEXT,
    about TEXT,
    notes TEXT,
    lastSeen TEXT,
    joined TEXT,
    canReceiveChatMessage BOOLEAN,
    canSendChatMessage BOOLEAN,
    isBlocked BOOLEAN,
    isMuted BOOLEAN,
    isRestricted BOOLEAN,
    isHidden BOOLEAN,
    isBookmarked BOOLEAN,
    issubscribed BOOLEAN,
    subscribedBy TEXT,
    subscribedOn TEXT,
    subscribedUntil TEXT,
    renewedAd BOOLEAN,
    isFriend BOOLEAN,
    tipsSum INTEGER,
    postsCount INTEGER,
    photosCount INTEGER,
    videosCount INTEGER,
    audiosCount INTEGER,
    mediaCount INTEGER,
    subscribersCount INTEGER,
    favoritesCount INTEGER,
    avatarThumbs JSONB,
    headerSize JSONB,
    headerThumbs JSONB,
    listsStates JSONB,
    subscribedByData JSONB,
    subscribedOnData JSONB,
    promoOffers JSONB,
    parker_name TEXT,
    is_custom BOOLEAN DEFAULT FALSE,
    updatedAt TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

// Run a shell command and return a promise.
function execAsync(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (error, stdout, stderr) => {
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
    } catch {
      await new Promise((res) => setTimeout(res, 1000));
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
  } catch {
    console.log(
      'PostgreSQL not reachable, attempting to start via docker compose...',
    );
    // First confirm docker is installed; otherwise the user needs to install or start Postgres manually.
    try {
      await execAsync('docker --version');
    } catch {
      console.error(
        'Docker is not installed. Please install Docker Desktop or start PostgreSQL manually.',
      );
      return false;
    }
    try {
      await execAsync('docker compose up -d db');
      const ready = await waitForPostgres(adminConfig);
      return ready;
    } catch (e) {
      console.error(
        'Failed to start PostgreSQL via docker compose:',
        e.message,
      );
      return false;
    }
  }
}

async function main() {
  try {
    console.log('🧙 Starting database setup wizard...');

    // If DB credentials already exist, use them directly
    const existing = {
      name: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
    };
    const hasExisting = Object.values(existing).every(Boolean);
    if (hasExisting) {
      console.log('Using existing database credentials from .env');
      const client = new Client({
        user: existing.user,
        password: existing.password,
        host: existing.host,
        port: existing.port,
        database: existing.name,
      });
      try {
        await client.connect();
      } catch (e) {
        console.error(
          'Could not connect to database with provided credentials:',
          e.message,
        );
        process.exit(1);
      }
      await client.query(createTableQuery);
      await client.end();
      console.log('Database connection successful. Migrations will run next.');
      return;
    }

    // No credentials provided: generate a fresh database
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
      database: 'postgres',
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
    await adminClient.query(
      `CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword}'`,
    );
    await adminClient.query(`CREATE DATABASE "${dbName}" OWNER "${dbUser}"`);
    await adminClient.end();
    console.log('Database and user created.');

    // Step 2: create table in the new database
    const newClient = new Client({
      user: dbUser,
      password: dbPassword,
      host: adminConfig.host,
      port: adminConfig.port,
      database: dbName,
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
    let lines = [];
    if (fs.existsSync(envPath)) {
      const existingLines = fs
        .readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .filter(
          (line) =>
            !line.startsWith('DB_NAME=') &&
            !line.startsWith('DB_USER=') &&
            !line.startsWith('DB_PASSWORD=') &&
            !line.startsWith('DB_HOST=') &&
            !line.startsWith('DB_PORT='),
        );
      lines = existingLines;
    }
    lines.push(`DB_NAME=${dbName}`);
    lines.push(`DB_USER=${dbUser}`);
    lines.push(`DB_PASSWORD=${dbPassword}`);
    lines.push(`DB_HOST=${adminConfig.host}`);
    lines.push(`DB_PORT=${adminConfig.port}`);
    fs.writeFileSync(envPath, lines.join('\n') + '\n');
    console.log('.env file updated.');

    console.log('✅ Database setup complete!');
    console.log(`   DB_NAME=${dbName}`);
    console.log(`   DB_USER=${dbUser}`);
    console.log(`   DB_PASSWORD=${dbPassword}`);
    console.log(
      'Add your API keys to .env and run `npm run start` to launch the app.',
    );
  } catch (err) {
    console.error('❌ Setup failed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();

/* End of File – Last modified 2025-08-02 */
