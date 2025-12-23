/*  OnlyFans Express Messenger (OFEM)
    File: server.js
    Purpose: Express server for OFEM (OnlyFans integration and ChatGPT usage)
    Created: 2025-08-02 – v1.0
*/

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const getEditorHtml = require('./getEditorHtml');
const { sanitizeError } = require('./sanitizeError');
const sanitizeMediaIds = require('./sanitizeMediaIds');
dotenv.config();

const DEFAULT_ONLYFANS_API_BASE = 'https://app.onlyfansapi.com/api';
function resolveOnlyFansApiBase() {
  const raw = (process.env.ONLYFANS_API_BASE || '').trim();
  if (!raw) return DEFAULT_ONLYFANS_API_BASE;
  return raw.replace(/\/+$/, '');
}
const ONLYFANS_API_BASE = resolveOnlyFansApiBase();
const usingDefaultOnlyfansBase = !(process.env.ONLYFANS_API_BASE || '').trim();

// Database connection pool
const pool = require('./db');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Server', 'OFEM');
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    console.error('Payload too large:', err?.message);
    return res.status(413).json({
      error:
        'Request body too large. Please reduce payload size or upload media separately before scheduling.',
    });
  }
  next(err);
});

// In-memory activity log capturing console output
const activityLogs = [];
function pushLog(level, args) {
  const msg = args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  activityLogs.push({ time: new Date().toISOString(), level, msg });
  if (activityLogs.length > 1000) activityLogs.shift();
}
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
console.log = (...args) => {
  pushLog('info', args);
  originalConsoleLog(...args);
};
console.error = (...args) => {
  pushLog('error', args);
  originalConsoleError(...args);
};

// OnlyFans API client (bearer auth)
const ofApi = axios.create({
  baseURL: ONLYFANS_API_BASE,
  headers: { Authorization: `Bearer ${process.env.ONLYFANS_API_KEY}` },
  timeout: 30000,
});
const openaiAxios = axios.create({ timeout: 30000 });
// OpenAI model configuration with fallback
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
let OFAccountId = null;
const CORE_DB_ENV_VARS = ['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT'];
const CORE_API_ENV_VARS = ['ONLYFANS_API_KEY', 'OPENAI_API_KEY'];
const REQUIRED_ENV_VARS = [
  ...CORE_API_ENV_VARS,
  ...CORE_DB_ENV_VARS,
  'ONLYFANS_ACCOUNT_ID',
];
// Configurable cap on OnlyFans records to fetch when paging. Prevents runaway loops if
// the API keeps returning data. Override with OF_FETCH_LIMIT environment variable.
const DEFAULT_OF_FETCH_LIMIT = 1000;
const OF_FETCH_LIMIT =
  parseInt(process.env.OF_FETCH_LIMIT, 10) || DEFAULT_OF_FETCH_LIMIT;
const ENABLE_BULK_SCHEDULE =
  process.env.ENABLE_BULK_SCHEDULE === 'false' ? false : true;
const USE_V1_MEDIA_UPLOAD = process.env.OF_USE_V1_MEDIA_UPLOAD === 'true';

// Flags indicating availability of background-task tables
let hasScheduledMessagesTable = true;
let hasPpvSetsTable = true;
let hasScheduledPostsTable = true;
let hasBulkScheduleTables = true;
let hasScheduledItemsTables = true;

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

const createBulkScheduleItemsTable = `
CREATE TABLE IF NOT EXISTS bulk_schedule_items (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT,
  source_filename TEXT,
  image_url_cf TEXT,
  caption TEXT,
  schedule_time TIMESTAMPTZ,
  timezone TEXT,
  destination TEXT,
  legacy_scheduled_post_id BIGINT,
  post_media_id BIGINT,
  message_media_id BIGINT,
  of_post_id BIGINT,
  of_message_id BIGINT,
  of_post_queue_id BIGINT,
  of_message_queue_id BIGINT,
  local_status TEXT DEFAULT 'draft',
  post_status TEXT,
  message_status TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const alterBulkScheduleItemsTable = `
ALTER TABLE bulk_schedule_items
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS source_filename TEXT,
  ADD COLUMN IF NOT EXISTS image_url_cf TEXT,
  ADD COLUMN IF NOT EXISTS caption TEXT,
  ADD COLUMN IF NOT EXISTS schedule_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS destination TEXT,
  ADD COLUMN IF NOT EXISTS legacy_scheduled_post_id BIGINT,
  ADD COLUMN IF NOT EXISTS post_media_id BIGINT,
  ADD COLUMN IF NOT EXISTS message_media_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_post_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_message_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_post_queue_id BIGINT,
  ADD COLUMN IF NOT EXISTS of_message_queue_id BIGINT,
  ADD COLUMN IF NOT EXISTS local_status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS post_status TEXT,
  ADD COLUMN IF NOT EXISTS message_status TEXT,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
`;

const bulkDestinationConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'bulk_schedule_items'
      AND constraint_name = 'bulk_schedule_items_destination_check'
  ) THEN
    ALTER TABLE bulk_schedule_items
      ADD CONSTRAINT bulk_schedule_items_destination_check
      CHECK (destination IN ('post', 'message', 'both'));
  END IF;
END $$;
`;

const bulkLocalStatusConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'bulk_schedule_items'
      AND constraint_name = 'bulk_schedule_items_local_status_check'
  ) THEN
    ALTER TABLE bulk_schedule_items
      ADD CONSTRAINT bulk_schedule_items_local_status_check
      CHECK (local_status IN ('draft', 'pending', 'scheduled', 'queued', 'sent', 'error'));
  END IF;
END $$;
`;

const createBulkLogsTable = `
CREATE TABLE IF NOT EXISTS bulk_logs (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT REFERENCES bulk_schedule_items(id),
  level TEXT,
  event TEXT,
  message TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const alterBulkLogsTable = `
ALTER TABLE bulk_logs
  ADD COLUMN IF NOT EXISTS item_id BIGINT REFERENCES bulk_schedule_items(id),
  ADD COLUMN IF NOT EXISTS level TEXT,
  ADD COLUMN IF NOT EXISTS event TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
`;

const bulkLogLevelConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'bulk_logs'
      AND constraint_name = 'bulk_logs_level_check'
  ) THEN
    ALTER TABLE bulk_logs
      ADD CONSTRAINT bulk_logs_level_check
      CHECK (level IN ('info', 'warn', 'error'));
  END IF;
END $$;
`;

const bulkLogsIndex = `
CREATE INDEX IF NOT EXISTS idx_bulk_logs_item_id_created_at
  ON bulk_logs (item_id, created_at);
`;

const bulkLegacyIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_schedule_legacy_id
  ON bulk_schedule_items(legacy_scheduled_post_id)
  WHERE legacy_scheduled_post_id IS NOT NULL;
`;

const createScheduledItemsTable = `
CREATE TABLE IF NOT EXISTS scheduled_items (
  id BIGSERIAL PRIMARY KEY,
  source_filename TEXT,
  media_url TEXT,
  caption TEXT,
  message_body TEXT,
  schedule_time TIMESTAMPTZ,
  scheduled_at_utc TIMESTAMPTZ,
  timezone TEXT,
  mode TEXT DEFAULT 'both',
  status TEXT DEFAULT 'ready',
  upload_strategy_note TEXT,
  of_media_id_post BIGINT,
  of_media_id_message BIGINT,
  of_queue_id_post BIGINT,
  of_message_batch_id TEXT,
  of_message_job_id TEXT,
  post_status TEXT,
  message_status TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const alterScheduledItemsTable = `
ALTER TABLE scheduled_items
  ADD COLUMN IF NOT EXISTS source_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS caption TEXT,
  ADD COLUMN IF NOT EXISTS message_body TEXT,
  ADD COLUMN IF NOT EXISTS schedule_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_at_utc TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS upload_strategy_note TEXT,
  ADD COLUMN IF NOT EXISTS of_media_id_post BIGINT,
  ADD COLUMN IF NOT EXISTS of_media_id_message BIGINT,
  ADD COLUMN IF NOT EXISTS of_queue_id_post BIGINT,
  ADD COLUMN IF NOT EXISTS of_message_batch_id TEXT,
  ADD COLUMN IF NOT EXISTS of_message_job_id TEXT,
  ADD COLUMN IF NOT EXISTS post_status TEXT,
  ADD COLUMN IF NOT EXISTS message_status TEXT,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
`;

const scheduledModeConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'scheduled_items'
      AND constraint_name = 'scheduled_items_mode_check'
  ) THEN
    ALTER TABLE scheduled_items
      ADD CONSTRAINT scheduled_items_mode_check
      CHECK (mode IN ('post', 'message', 'both'));
  END IF;
END $$;
`;

const scheduledStatusConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'scheduled_items'
      AND constraint_name = 'scheduled_items_status_check'
  ) THEN
    ALTER TABLE scheduled_items
      ADD CONSTRAINT scheduled_items_status_check
      CHECK (status IN ('ready', 'queued', 'sent', 'error', 'scheduled'));
  END IF;
END $$;
`;

const createScheduledItemLogsTable = `
CREATE TABLE IF NOT EXISTS scheduled_item_logs (
  id BIGSERIAL PRIMARY KEY,
  scheduled_item_id BIGINT REFERENCES scheduled_items(id) ON DELETE CASCADE,
  step TEXT,
  phase TEXT,
  level TEXT,
  message TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const alterScheduledItemLogsTable = `
ALTER TABLE scheduled_item_logs
  ADD COLUMN IF NOT EXISTS scheduled_item_id BIGINT REFERENCES scheduled_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS step TEXT,
  ADD COLUMN IF NOT EXISTS phase TEXT,
  ADD COLUMN IF NOT EXISTS level TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
`;

const scheduledUtcBackfill = `
UPDATE scheduled_items
SET scheduled_at_utc = schedule_time
WHERE scheduled_at_utc IS NULL
  AND schedule_time IS NOT NULL;
`;

const scheduledLogLevelConstraint = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'scheduled_item_logs'
      AND constraint_name = 'scheduled_item_logs_level_check'
  ) THEN
    ALTER TABLE scheduled_item_logs
      ADD CONSTRAINT scheduled_item_logs_level_check
      CHECK (level IN ('info', 'warn', 'error'));
  END IF;
END $$;
`;

const scheduledLogsIndex = `
CREATE INDEX IF NOT EXISTS idx_scheduled_item_logs_item_id_created_at
  ON scheduled_item_logs (scheduled_item_id, created_at);
`;

// Utility to check for table existence using information_schema.columns
async function tableExists(tableName) {
  try {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
      [tableName],
    );
    return res.rowCount > 0;
  } catch (err) {
    console.error(`Error checking for table ${tableName}:`, sanitizeError(err));
    return false;
  }
}

async function ensureScheduledPostsTable() {
  try {
    const exists = await tableExists('scheduled_posts');
    if (!exists) {
      console.warn(
        'scheduled_posts table missing; attempting to create it automatically',
      );
      await pool.query(createScheduledPostsTable);
    }
    await pool.query(alterScheduledPostsTable);
    hasScheduledPostsTable = true;
  } catch (err) {
    hasScheduledPostsTable = false;
    console.error(
      'scheduled_posts table unavailable; run migrations to enable bulk post scheduling:',
      sanitizeError(err),
    );
  }
}

async function ensureBulkScheduleTables() {
  if (!ENABLE_BULK_SCHEDULE) {
    hasBulkScheduleTables = false;
    console.warn(
      'Bulk schedule tables disabled via ENABLE_BULK_SCHEDULE=false; legacy flow remains available.',
    );
    return;
  }
  try {
    await pool.query(createBulkScheduleItemsTable);
    await pool.query(alterBulkScheduleItemsTable);
    await pool.query(bulkDestinationConstraint);
    await pool.query(bulkLocalStatusConstraint);
    await pool.query(createBulkLogsTable);
    await pool.query(alterBulkLogsTable);
    await pool.query(bulkLogLevelConstraint);
    await pool.query(bulkLogsIndex);
    await pool.query(bulkLegacyIndex);
    hasBulkScheduleTables = true;
  } catch (err) {
    hasBulkScheduleTables = false;
    console.error(
      'bulk_schedule_items/bulk_logs tables unavailable; run migrations to enable bulk scheduling:',
      sanitizeError(err),
    );
  }
}

async function ensureScheduledItemsTables() {
  try {
    await pool.query(createScheduledItemsTable);
    await pool.query(alterScheduledItemsTable);
    await pool.query(scheduledModeConstraint);
    await pool.query(scheduledStatusConstraint);
    await pool.query(createScheduledItemLogsTable);
    await pool.query(alterScheduledItemLogsTable);
    await pool.query(scheduledLogLevelConstraint);
    await pool.query(scheduledLogsIndex);
    await pool.query(scheduledUtcBackfill);
    hasScheduledItemsTables = true;
  } catch (err) {
    hasScheduledItemsTables = false;
    console.error(
      'scheduled_items/scheduled_item_logs tables unavailable; run migrations to enable scheduled queueing:',
      sanitizeError(err),
    );
  }
}

function getMissingEnvVars(list = REQUIRED_ENV_VARS) {
  return list.filter((v) => !process.env[v]);
}

function getStartupMissingEnvVars() {
  const missing = new Set(getMissingEnvVars(CORE_API_ENV_VARS));
  if (!process.env.DATABASE_URL) {
    getMissingEnvVars(CORE_DB_ENV_VARS).forEach((v) => missing.add(v));
  }
  return [...missing];
}

function getOnlyFansConfigStatus() {
  const apiKey = (process.env.ONLYFANS_API_KEY || '').trim();
  const baseUrl = (ONLYFANS_API_BASE || '').trim();
  return {
    apiKeyMissing: !apiKey,
    baseMissing: !baseUrl,
    baseEnvMissing: !(process.env.ONLYFANS_API_BASE || '').trim(),
    baseUrl,
    usingDefault: usingDefaultOnlyfansBase,
  };
}

async function verifyOnlyFansToken() {
  const config = getOnlyFansConfigStatus();
  if (config.apiKeyMissing || config.baseMissing) {
    const missingParts = [];
    if (config.apiKeyMissing) missingParts.push('ONLYFANS_API_KEY');
    if (config.baseMissing) missingParts.push('ONLYFANS_API_BASE');
    console.error(
      `Missing OnlyFans configuration: ${missingParts.join(', ')}.`,
    );
    process.exit(1);
  }
  try {
    await ofApi.get('/accounts');
  } catch (err) {
    const status = err.response?.status;
    const msg =
      status === 401
        ? 'Invalid ONLYFANS_API_KEY: authorization failed.'
        : `Unable to reach OnlyFans API: ${err.message}`;
    console.error(msg);
    process.exit(1);
  }
}
const MAX_OF_BACKOFF_MS = 32000;
let ofBackoffDelayMs = 1000;
function parseRetryAfterMs(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const raw =
    headers['retry-after'] ||
    headers['Retry-After'] ||
    headers['Retry-after'] ||
    headers['RETRY-AFTER'];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}
/**
 * Perform an OnlyFans API request with exponential backoff for rate limiting.
 * Retries on HTTP 429/5xx responses up to maxRetries attempts.
 * @param {Function} requestFn async function that performs the request
 * @param {number} [maxRetries=5] number of retries after the initial attempt
 * @returns {Promise<import('axios').AxiosResponse>} Resolves with the API response
 * @throws {Error} when the request fails or rate limit is exceeded
 */
async function ofApiRequest(requestFn, maxRetries = 5) {
  maxRetries++; // include initial attempt
  let delay = ofBackoffDelayMs;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await requestFn();
      ofBackoffDelayMs = 1000; // reset after success
      return res;
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        console.error('OnlyFans API request timed out');
        const timeoutErr = new Error('OnlyFans API request timed out');
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      const status = err.response?.status;
      const retriable =
        status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
      if (!retriable) throw err;
      if (attempt === maxRetries - 1) {
        if (status === 429) {
          const rateErr = new Error('OnlyFans API rate limit exceeded');
          rateErr.status = 429;
          throw rateErr;
        }
        throw err;
      }
      const retryAfter = parseRetryAfterMs(err.response?.headers);
      const wait = Math.max(delay, retryAfter || 0);
      console.warn(
        `OnlyFans API rate limit/server error (${status}). Retry ${attempt + 1} in ${wait / 1000}s`,
      );
      await new Promise((r) => setTimeout(r, wait));
      delay = Math.min(delay * 2, MAX_OF_BACKOFF_MS);
      ofBackoffDelayMs = delay;
    }
  }
}

/**
 * Perform an OpenAI API request with retries on rate limits or server errors.
 * @param {Function} requestFn async function that performs the request
 * @param {number} [maxRetries=5] number of retries after the initial attempt
 * @returns {Promise<import('axios').AxiosResponse>} Resolves with the API response
 * @throws {Error} when the request ultimately fails
 */
async function openaiRequest(requestFn, maxRetries = 5) {
  maxRetries++; // include initial attempt
  let delay = 1000; // start with 1s
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        console.error('OpenAI API request timed out');
        const timeoutErr = new Error('OpenAI API request timed out');
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      const status = err.response?.status;
      const retriable = status === 429 || (status >= 500 && status < 600);
      if (!retriable) throw err;
      if (attempt === maxRetries - 1) {
        const aiErr = new Error(
          status === 429
            ? 'OpenAI API rate limit exceeded'
            : 'OpenAI API server error',
        );
        aiErr.status = status;
        throw aiErr;
      }
      const retryAfter = parseInt(err.response.headers['retry-after'], 10);
      const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : delay;
      console.warn(
        `OpenAI API error ${status}. Retry ${attempt + 1} in ${wait}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
      delay *= 2;
    }
  }
}

function resolveConfiguredOFAccountId() {
  const envAccountId = (process.env.ONLYFANS_ACCOUNT_ID || '').trim();
  return envAccountId || null;
}

async function getOFAccountId(refresh = false) {
  const configuredAccountId = resolveConfiguredOFAccountId();
  if (configuredAccountId) {
    if (refresh || OFAccountId !== configuredAccountId) {
      OFAccountId = configuredAccountId;
      console.log(`Using OnlyFans account: ${OFAccountId}`);
    }
    return OFAccountId;
  }
  if (!refresh && OFAccountId) return OFAccountId;
  const err = new Error(
    'ONLYFANS_ACCOUNT_ID is required. Set it to your OnlyFans account ID or slug.',
  );
  err.status = 400;
  throw err;
}
// Determine if an OnlyFans account appears system generated
function isSystemGenerated(username = '', profileName = '') {
  const usernameSystem = /^u\d+$/.test(username) || /^\d+$/.test(username);
  const profileSystem = profileName.trim() === '' || /^\d+$/.test(profileName);
  return usernameSystem && profileSystem;
}

// Validate Parker name output and provide deterministic fallbacks.
// A Parker name is a friendly nickname Parker uses to address a fan.
function isValidParkerName(name = '') {
  return (
    typeof name === 'string' &&
    name.length >= 2 &&
    !name.includes('...') &&
    /^[A-Za-z][A-Za-z\s'-]*$/.test(name)
  );
}

function capitalize(word = '') {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function cleanCandidate(name = '') {
  return name.replace(/[^A-Za-z\s'-]/g, ' ').trim();
}

/**
 * Compute a deterministic fallback Parker name when none is provided or valid.
 * 1. Prefer the first word of the profile name if it resembles a real name.
 * 2. Else derive a name from the username by splitting symbols or camelCase.
 * 3. If all else fails, fall back to "Cuddles".
 */
function getParkerFallbackName(username = '', profileName = '') {
  const profileCandidate = capitalize(
    cleanCandidate(profileName).split(/\s+/)[0] || '',
  );
  if (isValidParkerName(profileCandidate)) {
    console.log(`Fallback to profile name: ${profileCandidate}`);
    return profileCandidate;
  }

  let userCandidate = username
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  userCandidate = capitalize(
    cleanCandidate(userCandidate).split(/\s+/)[0] || '',
  );
  if (isValidParkerName(userCandidate)) {
    console.log(`Fallback to username: ${userCandidate}`);
    return userCandidate;
  }

  console.log(`Fallback to default name: Cuddles`);
  return 'Cuddles';
}

/**
 * Ensure a Parker name meets validation rules; otherwise compute a fallback.
 * Parker names are the nicknames used in personalized messages.
 * @param {string} name proposed Parker name
 * @param {string} username fan's OnlyFans username
 * @param {string} profileName fan's profile display name
 * @returns {string} sanitized Parker name guaranteed to be valid
 */
function ensureValidParkerName(name, username, profileName) {
  if (isValidParkerName(name)) return name;
  console.log(`Invalid Parker name "${name}" detected. Using fallback.`);
  return getParkerFallbackName(username, profileName);
}

// Remove emoji characters from a string
function removeEmojis(str = '') {
  return str.replace(/\p{Extended_Pictographic}/gu, '');
}

/**
 * Send a formatted message to a specific fan with optional media and pricing.
 * Replaces template placeholders such as `{parker_name}` and `{username}`.
 */
let sendMessageToFan = async function (
  fanId,
  greeting = '',
  body = '',
  price = 0,
  lockedText = '',
  mediaFiles = [],
  previews = [],
) {
  if (!fanId || (!greeting && !body && !lockedText && mediaFiles.length === 0)) {
    throw new Error('Missing userId or message.');
  }
  let template = [greeting, body].filter(Boolean).join(' ').trim();
  const accountId = await getOFAccountId();
  const dbRes = await pool.query(
    'SELECT parker_name, username, location, canreceivechatmessage FROM fans WHERE id=$1',
    [fanId],
  );
  const row = dbRes.rows[0] || {};
  if (!row.canreceivechatmessage) {
    const err = new Error('Fan cannot receive chat messages');
    err.code = 'FAN_NOT_ELIGIBLE';
    throw err;
  }
  const parkerName = removeEmojis(row.parker_name || '');
  const userName = removeEmojis(row.username || '');
  const userLocation = removeEmojis(row.location || '');
  template = template.replace(/\{name\}|\[name\]|\{parker_name\}/g, parkerName);
  template = template.replace(/\{username\}/g, userName);
  template = template.replace(/\{location\}/g, userLocation);
  if (template.trim().length === 0 && !lockedText) {
    const err = new Error(
      'Message template empty after placeholder substitution; provide fallback text.',
    );
    err.status = 400;
    throw err;
  }
  const formatted = getEditorHtml(template);
  const mediaIds = sanitizeMediaIds(mediaFiles);
  const previewIds = sanitizeMediaIds(previews).filter((id) =>
    mediaIds.includes(id),
  );
  const payload = {
    text: formatted,
    mediaFiles: mediaIds,
    previews: previewIds,
    price: typeof price === 'number' ? price : 0,
  };
  if (lockedText) payload.lockedText = lockedText;
  const resp = await ofApiRequest(() =>
    ofApi.post(`/${accountId}/chats/${fanId}/messages`, payload),
  );
  const msgId =
    resp.data?.id ||
    resp.data?.message_id ||
    resp.data?.messageId ||
    resp.data?.message?.id;
  if (msgId != null) {
    await pool.query(
      'INSERT INTO messages (id, fan_id, direction, body, price) VALUES ($1, $2, $3, $4, $5)',
      [msgId.toString(), fanId, 'outgoing', formatted, payload.price ?? null],
    );
  }
  let logMsg = `Sent message to ${fanId}: ${template.substring(0, 30)}...`;
  if (payload.mediaFiles.length)
    logMsg += ` [media:${payload.mediaFiles.length}]`;
  if (payload.price) logMsg += ` [price:${payload.price}]`;
  console.log(logMsg);
};

const fansRoutes = require('./routes/fans')({
  getOFAccountId,
  ofApiRequest,
  ofApi,
  pool,
  sanitizeError,
  openaiAxios,
  openaiRequest,
  ensureValidParkerName,
  isSystemGenerated,
  removeEmojis,
  OPENAI_MODEL,
  OF_FETCH_LIMIT,
});
const ppvRoutes = require('./routes/ppv')({
  getOFAccountId,
  ofApiRequest,
  ofApi,
  pool,
  sanitizeError,
  sendMessageToFan,
});
const vaultListsRoutes = require('./routes/vaultLists')({
  getOFAccountId,
  ofApiRequest,
  ofApi,
  pool,
  sanitizeError,
  OF_FETCH_LIMIT,
});
const messagesRoutes = require('./routes/messages')({
  getOFAccountId,
  ofApiRequest,
  ofApi,
  pool,
  sanitizeError,
  sendMessageToFan,
  getMissingEnvVars,
});
const webhookRoutes = require('./routes/webhooks')({
  pool,
  sanitizeError,
  sendMessageToFan,
  openaiAxios,
  openaiRequest,
});
const logsRoutes = require('./routes/logs')({
  pool,
  hasBulkScheduleTables: () => hasBulkScheduleTables && ENABLE_BULK_SCHEDULE,
});
const bulkScheduleRoutes = require('./routes/bulkSchedule')({
  pool,
  sanitizeError,
  getMissingEnvVars,
  getOFAccountId,
  ofApiRequest,
  ofApi,
  hasBulkScheduleTables: () => hasBulkScheduleTables && ENABLE_BULK_SCHEDULE,
  OF_FETCH_LIMIT,
  useV1MediaUpload: USE_V1_MEDIA_UPLOAD,
});
const scheduledItemsRoutes = require('./routes/scheduledItems')({
  pool,
  sanitizeError,
  getMissingEnvVars,
  getOFAccountId,
  ofApiRequest,
  ofApi,
  OF_FETCH_LIMIT,
  hasScheduledItemsTables: () => hasScheduledItemsTables,
  useV1MediaUpload: USE_V1_MEDIA_UPLOAD,
});
app.use('/api', fansRoutes);
app.use('/api', ppvRoutes);
app.use('/api', vaultListsRoutes);
app.use('/api', messagesRoutes);
app.use('/api', webhookRoutes);
app.use('/api', logsRoutes);
app.use('/api', bulkScheduleRoutes);
app.use('/api', scheduledItemsRoutes);

// System status endpoint
app.get('/api/status', async (req, res) => {
  const status = {
    env: {},
    database: {},
    onlyfans: {
      base_url: ONLYFANS_API_BASE,
      using_default_base: usingDefaultOnlyfansBase,
    },
    openai: {},
    files: { envFile: fs.existsSync(path.join(__dirname, '.env')) },
    node: { version: process.version },
    features: { bulk_schedule_enabled: ENABLE_BULK_SCHEDULE },
  };
  const requiredEnv = [
    'ONLYFANS_API_KEY',
    'ONLYFANS_ACCOUNT_ID',
    'ONLYFANS_API_BASE',
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'DB_HOST',
    'DB_PORT',
  ];
  requiredEnv.forEach((k) => {
    const usingDatabaseUrl = !!process.env.DATABASE_URL && k.startsWith('DB_');
    status.env[k] = !!process.env[k] || usingDatabaseUrl;
  });
  try {
    await pool.query('SELECT 1');
    status.database.ok = true;
  } catch (err) {
    status.database.ok = false;
    status.database.error = err.message;
  }
  try {
    const config = getOnlyFansConfigStatus();
    status.onlyfans.missing_api_key = config.apiKeyMissing;
    status.onlyfans.missing_base_url = config.baseMissing;
    status.onlyfans.missing_base_env = config.baseEnvMissing;
    if (config.apiKeyMissing) {
      status.onlyfans.ok = false;
      status.onlyfans.error = 'Missing ONLYFANS_API_KEY';
    } else if (config.baseMissing) {
      status.onlyfans.ok = false;
      status.onlyfans.error = 'Missing ONLYFANS_API_BASE';
    } else {
      await ofApi.get('/accounts');
      status.onlyfans.ok = true;
    }
  } catch (err) {
    status.onlyfans.ok = false;
    status.onlyfans.error = err.response
      ? err.response.statusText || err.response.data
      : err.message;
  }
  try {
    await openaiAxios.get('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    status.openai.ok = true;
  } catch (err) {
    status.openai.ok = false;
    status.openai.error = err.response
      ? err.response.statusText || err.response.data
      : err.message;
  }
  status.database.scheduled_posts_table = hasScheduledPostsTable;
  if (!hasScheduledPostsTable) {
    status.database.scheduled_posts_message =
      'scheduled_posts table missing; run migrations to enable scheduled posts';
  }
  status.database.bulk_schedule_tables = hasBulkScheduleTables;
  if (!hasBulkScheduleTables) {
    status.database.bulk_schedule_message = ENABLE_BULK_SCHEDULE
      ? 'bulk_schedule_items/bulk_logs tables missing; run migrations to enable bulk scheduling'
      : 'Bulk scheduling disabled via ENABLE_BULK_SCHEDULE=false';
  }
  status.database.scheduled_item_tables = hasScheduledItemsTables;
  if (!hasScheduledItemsTables) {
    status.database.scheduled_item_message =
      'scheduled_items/scheduled_item_logs tables missing; run migrations to enable scheduled queueing';
  }
  res.json(status);
});

async function processScheduledMessages() {
  if (!hasScheduledMessagesTable) return;
  const missing = getMissingEnvVars();
  if (missing.length) {
    console.error(`Missing environment variable(s): ${missing.join(', ')}`);
    return;
  }
  try {
    const dbRes = await pool.query(
      "SELECT * FROM scheduled_messages WHERE status='pending' AND scheduled_at <= NOW()",
    );
    for (const row of dbRes.rows) {
      const recipients = Array.isArray(row.recipients) ? row.recipients : [];
      let allSent = true;
      for (const fanId of recipients) {
        try {
          await sendMessageToFan(
            fanId,
            row.greeting || '',
            row.body || '',
            row.price,
            row.locked_text,
            row.media_files || [],
            row.previews || [],
          );
        } catch (err) {
          if (err.code === 'FAN_NOT_ELIGIBLE') {
            console.log(
              `Skipping fan ${fanId} for scheduled message ${row.id}: ${err.message}`,
            );
            continue;
          }
          allSent = false;
          console.error(
            `Error sending scheduled message ${row.id} to ${fanId}:`,
            err.message,
          );
        }
      }
      const newStatus = allSent ? 'sent' : 'failed';
      await pool.query('UPDATE scheduled_messages SET status=$1 WHERE id=$2', [
        newStatus,
        row.id,
      ]);
    }
  } catch (err) {
    console.error('Error processing scheduled messages:', sanitizeError(err));
  }
}

/**
 * Determine whether a PPV set should be sent at the current time.
 * @param {Object} ppv PPV record with scheduling fields
 * @param {Date} [now=new Date()] current time for evaluation
 * @returns {boolean} true if the PPV should be sent now
 */
function shouldSendNow(ppv, now = new Date()) {
  const {
    schedule_day: scheduleDay,
    schedule_time: scheduleTime,
    last_sent_at: lastSentAt,
  } = ppv;
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  if (scheduleDay > lastDayOfMonth) return false;
  if (scheduleDay !== day) return false;
  const match = /^([0-9]{2}):([0-9]{2})$/.exec(scheduleTime);
  if (!match) return false;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const scheduledMinutes = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  if (minutesNow < scheduledMinutes) return false;
  if (lastSentAt) {
    const last = new Date(lastSentAt);
    if (last.getFullYear() === year && last.getMonth() === month) return false;
  }
  return true;
}

/**
 * Send recurring PPV messages to all subscribed fans when their schedule is due.
 */
async function processRecurringPPVs() {
  if (!hasPpvSetsTable) return;
  const missing = getMissingEnvVars();
  if (missing.length) {
    console.error(`Missing environment variable(s): ${missing.join(', ')}`);
    return;
  }
  const now = new Date();
  const day = now.getDate();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const ppvRes = await pool.query(
      `SELECT id, message, price, vault_list_id FROM ppv_sets
       WHERE schedule_day = $1 AND schedule_time = $2
       AND (last_sent_at IS NULL OR last_sent_at < $3)`,
      [day, timeStr, monthStart],
    );
    if (ppvRes.rows.length === 0) return;
    const fansRes = await pool.query(
      'SELECT id FROM fans WHERE issubscribed = TRUE AND canreceivechatmessage = TRUE',
    );
    const fanIds = fansRes.rows.map((r) => r.id);
    for (const ppv of ppvRes.rows) {
      const { id, message, price } = ppv;
      const mediaRes = await pool.query(
        'SELECT media_id, is_preview FROM ppv_media WHERE ppv_id=$1',
        [id],
      );
      const mediaFiles = mediaRes.rows.map((r) => r.media_id);
      const previews = mediaRes.rows
        .filter((r) => r.is_preview)
        .map((r) => r.media_id);
      let allSucceeded = true;
      for (const fanId of fanIds) {
        try {
          await sendMessageToFan(
            fanId,
            '',
            message || '',
            price,
            '',
            mediaFiles,
            previews,
          );
        } catch (err) {
          allSucceeded = false;
          console.error(
            `Error sending PPV ${id} to fan ${fanId}:`,
            err.message,
          );
        }
      }
      if (allSucceeded) {
        await pool.query('UPDATE ppv_sets SET last_sent_at = $1 WHERE id=$2', [
          now,
          id,
        ]);

      }
    }
  } catch (err) {
    console.error('Error processing recurring PPVs:', sanitizeError(err));
  }
}

// Serve frontend static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Import bulk upload route
const bulkUploadRoutes = require('./routes/bulkUpload');
app.use('/api', bulkUploadRoutes);

async function processAllSchedules() {
  await processScheduledMessages();
  await processRecurringPPVs();
}

// Start the server only if this file is executed directly (not required by tests)
const port = process.env.PORT || 3000;
/**
 * Initialize background scheduling for pending messages and recurring PPVs.
 * Runs immediately and then every minute if the relevant tables exist.
 */
async function initScheduling() {
  hasScheduledMessagesTable = await tableExists('scheduled_messages');
  if (!hasScheduledMessagesTable) {
    console.warn(
      'scheduled_messages table missing; skipping scheduled message processing',
    );
  }
  hasPpvSetsTable = await tableExists('ppv_sets');
  if (!hasPpvSetsTable) {
    console.warn('ppv_sets table missing; skipping recurring PPV processing');
  }
  if (hasScheduledMessagesTable || hasPpvSetsTable) {
    if (process.env.NODE_ENV !== 'test') {
      setInterval(processAllSchedules, 60000);
    }
    await processAllSchedules();
  }
}

if (require.main === module) {
  (async () => {
    const missingCritical = getStartupMissingEnvVars();
    if (missingCritical.length) {
      console.error(
        `Missing environment variable(s): ${missingCritical.join(', ')}`,
      );
      process.exit(1);
    }
    const missingAccount = getMissingEnvVars(['ONLYFANS_ACCOUNT_ID']);
    if (missingAccount.length) {
      console.warn(
        'ONLYFANS_ACCOUNT_ID is not set. The server will start, but OnlyFans requests that need an account will fail until it is configured. ' +
          'If deploying on Render, confirm the variable is present on the service Environment tab and redeploy.',
      );
    }
    const ofConfig = getOnlyFansConfigStatus();
    if (ofConfig.baseEnvMissing) {
      console.warn(
        `ONLYFANS_API_BASE is not set; defaulting to ${DEFAULT_ONLYFANS_API_BASE}`,
      );
    }
    await ensureScheduledPostsTable();
    await ensureBulkScheduleTables();
    await ensureScheduledItemsTables();
    await verifyOnlyFansToken();
    if (scheduledItemsRoutes.startWorker) {
      scheduledItemsRoutes.startWorker();
    }
    app.listen(port, () => {
      console.log(`OFEM server listening on http://localhost:${port}`);
    });
    initScheduling();
  })();
}

// Export app for testing
module.exports = app;
module.exports.shouldSendNow = shouldSendNow;
module.exports.processRecurringPPVs = processRecurringPPVs;
module.exports.sendMessageToFan = (...args) => sendMessageToFan(...args);
module.exports._setSendMessageToFan = (fn) => {
  sendMessageToFan = fn;
};

/* End of File – Last modified 2025-08-02 */
