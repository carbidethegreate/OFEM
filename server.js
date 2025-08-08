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
dotenv.config();

// Database connection pool
const pool = require('./db');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Server', 'OFEM');
  next();
});
app.use(express.json());

// OnlyFans API client (bearer auth)
const ofApi = axios.create({
  baseURL: 'https://app.onlyfansapi.com/api',
  headers: { Authorization: `Bearer ${process.env.ONLYFANS_API_KEY}` },
  timeout: 30000,
});
const openaiAxios = axios.create({ timeout: 30000 });
// OpenAI model configuration with fallback
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
let OFAccountId = null;
const REQUIRED_ENV_VARS = [
  'ONLYFANS_API_KEY',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'OPENAI_API_KEY',
];
// Configurable cap on OnlyFans records to fetch when paging. Prevents runaway loops if
// the API keeps returning data. Override with OF_FETCH_LIMIT environment variable.
const DEFAULT_OF_FETCH_LIMIT = 1000;
const OF_FETCH_LIMIT =
  parseInt(process.env.OF_FETCH_LIMIT, 10) || DEFAULT_OF_FETCH_LIMIT;

// Flags indicating availability of background-task tables
let hasScheduledMessagesTable = true;
let hasPpvSetsTable = true;

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

function getMissingEnvVars(list = REQUIRED_ENV_VARS) {
  return list.filter((v) => !process.env[v]);
}

async function verifyOnlyFansToken() {
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
/**
 * Perform an OnlyFans API request with exponential backoff for rate limiting.
 * Retries on HTTP 429 responses up to maxRetries attempts.
 * @param {Function} requestFn async function that performs the request
 * @param {number} [maxRetries=5] number of retries after the initial attempt
 * @returns {Promise<import('axios').AxiosResponse>} Resolves with the API response
 * @throws {Error} when the request fails or rate limit is exceeded
 */
async function ofApiRequest(requestFn, maxRetries = 5) {
  maxRetries++; // include initial attempt
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
      if (status !== 429) throw err;
      if (attempt === maxRetries - 1) {
        const rateErr = new Error('OnlyFans API rate limit exceeded');
        rateErr.status = 429;
        throw rateErr;
      }
      const wait = ofBackoffDelayMs;
      console.warn(
        `OnlyFans API rate limit. Retry ${attempt + 1} in ${wait / 1000}s`,
      );
      await new Promise((r) => setTimeout(r, wait));
      ofBackoffDelayMs = Math.min(
        ofBackoffDelayMs * 2,
        MAX_OF_BACKOFF_MS,
      );
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

async function getOFAccountId(refresh = false) {
  if (!refresh && OFAccountId) return OFAccountId;
  const accountsResp = await ofApiRequest(() => ofApi.get('/accounts'));
  const rawAccounts = accountsResp.data?.data || accountsResp.data;
  const accounts = Array.isArray(rawAccounts)
    ? rawAccounts
    : rawAccounts?.accounts || [];
  if (!accounts || accounts.length === 0) {
    throw new Error('No OnlyFans account is connected to this API key.');
  }
  OFAccountId = accounts[0].id;
  console.log(`Using OnlyFans account: ${OFAccountId}`);
  return OFAccountId;
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
  lockedText = false,
  mediaFiles = [],
  previews = [],
) {
  if (!fanId || (!greeting && !body)) {
    throw new Error('Missing userId or message.');
  }
  let template = [greeting, body].filter(Boolean).join(' ').trim();
  const accountId = await getOFAccountId();
  const dbRes = await pool.query(
    'SELECT parker_name, username, location, isSubscribed AS "isSubscribed", canReceiveChatMessage AS "canReceiveChatMessage" FROM fans WHERE id=$1',
    [fanId],
  );
  const row = dbRes.rows[0] || {};
  if (!row.isSubscribed || !row.canReceiveChatMessage) {
    const err = new Error(
      'Fan is not subscribed or cannot receive chat messages',
    );
    err.code = 'FAN_NOT_ELIGIBLE';
    throw err;
  }
  const parkerName = removeEmojis(row.parker_name || '');
  const userName = removeEmojis(row.username || '');
  const userLocation = removeEmojis(row.location || '');
  template = template.replace(/\{name\}|\[name\]|\{parker_name\}/g, parkerName);
  template = template.replace(/\{username\}/g, userName);
  template = template.replace(/\{location\}/g, userLocation);
  if (template.trim().length === 0) {
    const err = new Error(
      'Message template empty after placeholder substitution; provide fallback text.',
    );
    err.status = 400;
    throw err;
  }
  const formatted = getEditorHtml(template);
  const mediaIds = Array.isArray(mediaFiles)
    ? mediaFiles.map(Number).filter(Number.isFinite)
    : [];
  const previewIds = Array.isArray(previews)
    ? previews.map(Number).filter((id) => mediaIds.includes(id))
    : [];
  const payload = {
    text: formatted,
    mediaFiles: mediaIds,
    previews: previewIds,
    price: typeof price === 'number' ? price : 0,
    lockedText: lockedText === true,
  };
  await ofApiRequest(() =>
    ofApi.post(`/${accountId}/chats/${fanId}/messages`, payload),
  );
  await pool.query(
    'INSERT INTO messages (fan_id, direction, body, price) VALUES ($1, $2, $3, $4)',
    [fanId, 'outgoing', formatted, payload.price ?? null],
  );
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
app.use('/api', fansRoutes);
app.use('/api', ppvRoutes);
app.use('/api', messagesRoutes);

// System status endpoint
app.get('/api/status', async (req, res) => {
  const status = {
    env: {},
    database: {},
    onlyfans: {},
    openai: {},
    files: { envFile: fs.existsSync(path.join(__dirname, '.env')) },
    node: { version: process.version },
  };
  const requiredEnv = [
    'ONLYFANS_API_KEY',
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'DB_HOST',
    'DB_PORT',
  ];
  requiredEnv.forEach((k) => {
    status.env[k] = !!process.env[k];
  });
  try {
    await pool.query('SELECT 1');
    status.database.ok = true;
  } catch (err) {
    status.database.ok = false;
    status.database.error = err.message;
  }
  try {
    await ofApi.get('/accounts');
    status.onlyfans.ok = true;
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
  try {
    const ppvRes = await pool.query(
      'SELECT id, message, price, schedule_day, schedule_time, last_sent_at FROM ppv_sets WHERE schedule_day IS NOT NULL AND schedule_time IS NOT NULL',
    );
    if (ppvRes.rows.length === 0) return;
    const fansRes = await pool.query(
      'SELECT id FROM fans WHERE isSubscribed = TRUE AND canReceiveChatMessage = TRUE',
    );
    const fanIds = fansRes.rows.map((r) => r.id);
    for (const ppv of ppvRes.rows) {
      if (!shouldSendNow(ppv)) continue;
      const { id, message, price } = ppv;
      const mediaRes = await pool.query(
        'SELECT media_id, is_preview FROM ppv_media WHERE ppv_id=$1',
        [id],
      );
      const mediaFiles = mediaRes.rows.map((r) => r.media_id);
      const previews = mediaRes.rows
        .filter((r) => r.is_preview)
        .map((r) => r.media_id);
      for (const fanId of fanIds) {
        try {
          await sendMessageToFan(
            fanId,
            '',
            message || '',
            price,
            false,
            mediaFiles,
            previews,
          );
        } catch (err) {
          if (err.code === 'FAN_NOT_ELIGIBLE') {
            console.log(
              `Skipping fan ${fanId} for PPV ${id}: ${err.message}`,
            );
            continue;
          }
          console.error(
            `Error sending PPV ${id} to fan ${fanId}:`,
            err.message,
          );
        }
      }
      await pool.query('UPDATE ppv_sets SET last_sent_at = NOW() WHERE id=$1', [
        id,
      ]);
    }
  } catch (err) {
    console.error('Error processing recurring PPVs:', sanitizeError(err));
  }
}

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

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
    setInterval(processAllSchedules, 60000);
    await processAllSchedules();
  }
}

if (require.main === module) {
  (async () => {
    const missing = getMissingEnvVars(['ONLYFANS_API_KEY']);
    if (missing.length) {
      console.error(
        `Missing environment variable(s): ${missing.join(', ')}`,
      );
      process.exit(1);
    }
    await verifyOnlyFansToken();
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
