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
        headers: { 'Authorization': `Bearer ${process.env.ONLYFANS_API_KEY}` },
        timeout: 30000
});
const openaiAxios = axios.create({ timeout: 30000 });
// OpenAI model configuration with fallback
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
let OFAccountId = null;
const REQUIRED_ENV_VARS = ['ONLYFANS_API_KEY', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'OPENAI_API_KEY'];
// Configurable cap on OnlyFans records to fetch when paging. Prevents runaway loops if
// the API keeps returning data. Override with OF_FETCH_LIMIT environment variable.
const DEFAULT_OF_FETCH_LIMIT = 1000;
const OF_FETCH_LIMIT = parseInt(process.env.OF_FETCH_LIMIT, 10) || DEFAULT_OF_FETCH_LIMIT;

// Flags indicating availability of background-task tables
let hasScheduledMessagesTable = true;
let hasPpvSetsTable = true;

// Utility to check for table existence using information_schema.columns
async function tableExists(tableName) {
        try {
                const res = await pool.query(
                        `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
                        [tableName]
                );
                return res.rowCount > 0;
        } catch (err) {
                console.error(`Error checking for table ${tableName}:`, sanitizeError(err));
                return false;
        }
}

function getMissingEnvVars(list = REQUIRED_ENV_VARS) {
        return list.filter(v => !process.env[v]);
}
const MAX_OF_BACKOFF = 32000;
let ofBackoffDelay = 1000;
// Wrapper to handle OnlyFans API rate limiting with retries
async function ofApiRequest(requestFn, maxRetries = 5) {
       maxRetries++; // include initial attempt
       for (let attempt = 0; attempt < maxRetries; attempt++) {
               try {
                       const res = await requestFn();
                       ofBackoffDelay = 1000; // reset after success
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
                       const wait = ofBackoffDelay;
                       console.warn(`OnlyFans API rate limit. Retry ${attempt + 1} in ${wait / 1000}s`);
                       await new Promise(r => setTimeout(r, wait));
                       ofBackoffDelay = Math.min(ofBackoffDelay * 2, MAX_OF_BACKOFF);
               }
       }
}

// Wrapper to handle OpenAI rate limiting with retries
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
                                                : 'OpenAI API server error'
                                );
                                aiErr.status = status;
                                throw aiErr;
                        }
                        const retryAfter = parseInt(err.response.headers['retry-after'], 10);
                        const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : delay;
                        console.warn(`OpenAI API error ${status}. Retry ${attempt + 1} in ${wait}ms`);
                        await new Promise(r => setTimeout(r, wait));
                        delay *= 2;
                }
        }
}

async function getOFAccountId(refresh = false) {
       if (!refresh && OFAccountId) return OFAccountId;
       const accountsResp = await ofApiRequest(() => ofApi.get('/accounts'));
       const rawAccounts = accountsResp.data?.data || accountsResp.data;
       const accounts = Array.isArray(rawAccounts) ? rawAccounts : rawAccounts?.accounts || [];
       if (!accounts || accounts.length === 0) {
               throw new Error('No OnlyFans account is connected to this API key.');
       }
       OFAccountId = accounts[0].id;
       console.log(`Using OnlyFans account: ${OFAccountId}`);
       return OFAccountId;
}
// Determine if an OnlyFans account appears system generated
function isSystemGenerated(username = "", profileName = "") {
        const usernameSystem = /^u\d+$/.test(username) || /^\d+$/.test(username);
        const profileSystem = profileName.trim() === "" || /^\d+$/.test(profileName);
        return usernameSystem && profileSystem;
}

// Validate parkerName output and provide deterministic fallbacks
function isValidParkerName(name = "") {
        return (
                typeof name === "string" &&
                name.length >= 2 &&
                !name.includes("...") &&
                /^[A-Za-z][A-Za-z\s'-]*$/.test(name)
        );
}

function capitalize(word = "") {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function cleanCandidate(name = "") {
        return name.replace(/[^A-Za-z\s'-]/g, " ").trim();
}

function deterministicFallback(username = "", profileName = "") {
        const profileCandidate = capitalize(cleanCandidate(profileName).split(/\s+/)[0] || "");
        if (isValidParkerName(profileCandidate)) {
                console.log(`Fallback to profile name: ${profileCandidate}`);
                return profileCandidate;
        }

        let userCandidate = username
                .replace(/[_-]+/g, " ")
                .replace(/([a-z])([A-Z])/g, '$1 $2');
        userCandidate = capitalize(cleanCandidate(userCandidate).split(/\s+/)[0] || "");
        if (isValidParkerName(userCandidate)) {
                console.log(`Fallback to username: ${userCandidate}`);
                return userCandidate;
        }

        console.log(`Fallback to default name: Cuddles`);
        return "Cuddles";
}

function ensureValidParkerName(name, username, profileName) {
        if (isValidParkerName(name)) return name;
        console.log(`Invalid Parker name "${name}" detected. Using fallback.`);
        return deterministicFallback(username, profileName);
}

// Remove emoji characters from a string
function removeEmojis(str = "") {
        return str.replace(/\p{Extended_Pictographic}/gu, "");
}

let sendPersonalizedMessage = async function (
        fanId,
        greeting = "",
        body = "",
        price = 0,
        lockedText = false,
        mediaFiles = [],
        previews = []
) {
        if (!fanId || (!greeting && !body)) {
                throw new Error('Missing userId or message.');
        }
       let template = [greeting, body].filter(Boolean).join(' ').trim();
       const accountId = await getOFAccountId();
        const dbRes = await pool.query('SELECT parker_name, username, location FROM fans WHERE id=$1', [fanId]);
        const row = dbRes.rows[0] || {};
        const parkerName = removeEmojis(row.parker_name || "");
        const userName = removeEmojis(row.username || "");
        const userLocation = removeEmojis(row.location || "");
        template = template.replace(/\{name\}|\[name\]|\{parker_name\}/g, parkerName);
        template = template.replace(/\{username\}/g, userName);
        template = template.replace(/\{location\}/g, userLocation);
        const formatted = getEditorHtml(template);
        const mediaIds = Array.isArray(mediaFiles)
                ? mediaFiles.map(Number).filter(Number.isFinite)
                : [];
        const previewIds = Array.isArray(previews)
                ? previews
                        .map(Number)
                        .filter(id => mediaIds.includes(id))
                : [];
        const payload = {
                text: formatted,
                mediaFiles: mediaIds,
                previews: previewIds,
                price: typeof price === 'number' ? price : 0,
                lockedText: lockedText === true
        };
       await ofApiRequest(() => ofApi.post(`/${accountId}/chats/${fanId}/messages`, payload));
        await pool.query(
                'INSERT INTO messages (fan_id, direction, body, price) VALUES ($1, $2, $3, $4)',
                [fanId, 'outgoing', formatted, payload.price ?? null]
        );
        let logMsg = `Sent message to ${fanId}: ${template.substring(0, 30)}...`;
        if (payload.mediaFiles.length) logMsg += ` [media:${payload.mediaFiles.length}]`;
        if (payload.price) logMsg += ` [price:${payload.price}]`;
console.log(logMsg);
};



app.post('/api/refreshFans', async (req, res) => {
        const missing = [];
        if (!process.env.ONLYFANS_API_KEY) missing.push('ONLYFANS_API_KEY');
        if (missing.length) {
                return res.status(400).json({ error: `Missing environment variable(s): ${missing.join(', ')}` });
        }

       try {
               const accountId = await getOFAccountId(true);

               // 2. Determine which subset of users to fetch
               const validFilters = new Set(['all', 'active', 'expired']);
               const rawFilter = (req.query.filter || process.env.OF_FAN_FILTER || 'all').toLowerCase();
               const filter = validFilters.has(rawFilter) ? rawFilter : 'all';

                // 3. Fetch all fans and following users
                const limit = 32;
                const fetchPaged = async (endpoint) => {
                        const results = [];
                        let offset = 0;
                        let totalCount = null;
                        while (true) {
                                try {
                                        const resp = await ofApiRequest(() => ofApi.get(endpoint, { params: { limit, offset } }));
                                        const page = resp.data?.data?.list || resp.data?.list || resp.data;
                                        const count = resp.data?.data?.count ?? resp.data?.count;
                                        if (totalCount === null && Number.isFinite(count)) totalCount = count;
                                        if (!page || page.length === 0) break;
                                        results.push(...page);
                                        offset += page.length;
                                        if (totalCount !== null && offset >= totalCount) break;
                                        if (offset >= OF_FETCH_LIMIT) {
                                                console.warn(`Fetch ${endpoint} reached configured limit ${OF_FETCH_LIMIT}, stopping.`);
                                                break;
                                        }
                                } catch (err) {
                                        const status = err.response?.status;
                                        if (status === 429) throw err;
                                        console.warn(`Fetch ${endpoint} failed at offset ${offset} (status ${status || 'unknown'}). Returning partial results.`);
                                        break;
                                }
                        }
                        return results;
                };

               const fansList = await fetchPaged(`/${accountId}/fans/${filter}`);
               const followingList = await fetchPaged(`/${accountId}/following/${filter}`);
                const fanMap = new Map();
                [...fansList, ...followingList].forEach(user => {
                        fanMap.set(user.id, user);
                });
                const allFans = Array.from(fanMap.values());
                console.log(`Fetched ${allFans.length} unique fans and followings from OnlyFans.`);

                // 4. Load existing fans from DB
                const dbRes = await pool.query('SELECT id, parker_name, is_custom FROM fans');
                const existingFans = {};
                for (const row of dbRes.rows) {
                        existingFans[row.id] = { parker_name: row.parker_name, is_custom: row.is_custom };
                }

                const processFan = async (fan) => {
                        const fanId = fan.id.toString();
                        const username = fan.username || "";
                        const profileName = fan.name || "";
                        const {
                                avatar = null,
                                header = null,
                                website = null,
                                location = null,
                                gender = null,
                                birthday = null,
                                about = null,
                                notes = null,
                                lastSeen = null,
                                joined = null,
                                canReceiveChatMessage,
                                canSendChatMessage,
                                isBlocked,
                                isMuted,
                                isRestricted,
                                isHidden,
                                isBookmarked,
                                isSubscribed,
                                subscribedBy = null,
                                subscribedOn = null,
                                subscribedUntil = null,
                                renewedAd,
                                isFriend,
                                tipsSum,
                                postsCount,
                                photosCount,
                                videosCount,
                                audiosCount,
                                mediaCount,
                                subscribersCount,
                                favoritesCount,
                                avatarThumbs,
                                headerSize,
                                headerThumbs,
                                listsStates,
                                subscribedByData,
                                subscribedOnData,
                                promoOffers
                        } = fan;

                        const parseTimestamp = (value) => {
                                if (value === null || value === undefined) return null;
                                const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
                                return isNaN(date.getTime()) ? null : date.toISOString();
                        };

                        const parseBoolean = (value) => {
                                if (value === null || value === undefined) return null;
                                return !!value;
                        };

                        const parseNumber = (value) => {
                                if (value === null || value === undefined) return null;
                                const num = Number(value);
                                return Number.isNaN(num) ? null : num;
                        };

                        const lastSeenTs = parseTimestamp(lastSeen);
                        const joinedTs = parseTimestamp(joined);
                        const subscribedOnTs = parseTimestamp(subscribedOn);
                        const subscribedUntilTs = parseTimestamp(subscribedUntil);

                        const avatarThumbsJson = avatarThumbs ? JSON.stringify(avatarThumbs) : null;
                        const headerSizeJson = headerSize ? JSON.stringify(headerSize) : null;
                        const headerThumbsJson = headerThumbs ? JSON.stringify(headerThumbs) : null;
                        const listsStatesJson = listsStates ? JSON.stringify(listsStates) : null;
                        const subscribedByDataJson = subscribedByData ? JSON.stringify(subscribedByData) : null;
                        const subscribedOnDataJson = subscribedOnData ? JSON.stringify(subscribedOnData) : null;
                        const promoOffersJson = promoOffers ? JSON.stringify(promoOffers) : null;

                        const tipsSumVal = parseNumber(tipsSum);
                        const postsCountVal = parseNumber(postsCount);
                        const photosCountVal = parseNumber(photosCount);
                        const videosCountVal = parseNumber(videosCount);
                        const audiosCountVal = parseNumber(audiosCount);
                        const mediaCountVal = parseNumber(mediaCount);
                        const subscribersCountVal = parseNumber(subscribersCount);
                        const favoritesCountVal = parseNumber(favoritesCount);

                        if (existingFans[fanId]) {
                                await pool.query(
                                        `UPDATE fans SET
                                                username=$2,
                                                name=$3,
                                                avatar=$4,
                                                header=$5,
                                                website=$6,
                                                location=$7,
                                                gender=$8,
                                                birthday=$9,
                                                about=$10,
                                                notes=$11,
                                                lastSeen=$12,
                                                joined=$13,
                                                canReceiveChatMessage=$14,
                                                canSendChatMessage=$15,
                                                isBlocked=$16,
                                                isMuted=$17,
                                                isRestricted=$18,
                                                isHidden=$19,
                                                isBookmarked=$20,
                                                isSubscribed=$21,
                                                subscribedBy=$22,
                                                subscribedOn=$23,
                                                subscribedUntil=$24,
                                                renewedAd=$25,
                                                isFriend=$26,
                                                tipsSum=$27,
                                                postsCount=$28,
                                                photosCount=$29,
                                                videosCount=$30,
                                                audiosCount=$31,
                                                mediaCount=$32,
                                                subscribersCount=$33,
                                                favoritesCount=$34,
                                                avatarThumbs=$35,
                                                headerSize=$36,
                                                headerThumbs=$37,
                                                listsStates=$38,
                                                subscribedByData=$39,
                                                subscribedOnData=$40,
                                                promoOffers=$41,
                                                updatedAt=NOW()
                                        WHERE id=$1`,
                                        [
                                                fanId,
                                                username,
                                                profileName,
                                                avatar,
                                                header,
                                                website,
                                                location,
                                                gender,
                                                birthday,
                                                about,
                                                notes,
                                                lastSeenTs,
                                                joinedTs,
                                                parseBoolean(canReceiveChatMessage),
                                                parseBoolean(canSendChatMessage),
                                                parseBoolean(isBlocked),
                                                parseBoolean(isMuted),
                                                parseBoolean(isRestricted),
                                                parseBoolean(isHidden),
                                                parseBoolean(isBookmarked),
                                                parseBoolean(isSubscribed),
                                                subscribedBy,
                                                subscribedOnTs,
                                                subscribedUntilTs,
                                                parseBoolean(renewedAd),
                                                parseBoolean(isFriend),
                                                tipsSumVal,
                                                postsCountVal,
                                                photosCountVal,
                                                videosCountVal,
                                                audiosCountVal,
                                                mediaCountVal,
                                                subscribersCountVal,
                                                favoritesCountVal,
                                                avatarThumbsJson,
                                                headerSizeJson,
                                                headerThumbsJson,
                                                listsStatesJson,
                                                subscribedByDataJson,
                                                subscribedOnDataJson,
                                                promoOffersJson
                                        ]
                                );
                        } else {
                                await pool.query(
                                        `INSERT INTO fans (
                                                id, username, name, avatar, header, website, location, gender, birthday, about, notes,
                                                lastSeen, joined, canReceiveChatMessage, canSendChatMessage, isBlocked, isMuted, isRestricted,
                                                isHidden, isBookmarked, isSubscribed, subscribedBy, subscribedOn, subscribedUntil, renewedAd,
                                                isFriend, tipsSum, postsCount, photosCount, videosCount, audiosCount, mediaCount,
                                                subscribersCount, favoritesCount, avatarThumbs, headerSize, headerThumbs, listsStates,
                                                subscribedByData, subscribedOnData, promoOffers, parker_name, is_custom
                                        ) VALUES (
                                                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43
                                        )`,
                                        [
                                                fanId,
                                                username,
                                                profileName,
                                                avatar,
                                                header,
                                                website,
                                                location,
                                                gender,
                                                birthday,
                                                about,
                                                notes,
                                                lastSeenTs,
                                                joinedTs,
                                                parseBoolean(canReceiveChatMessage),
                                                parseBoolean(canSendChatMessage),
                                                parseBoolean(isBlocked),
                                                parseBoolean(isMuted),
                                                parseBoolean(isRestricted),
                                                parseBoolean(isHidden),
                                                parseBoolean(isBookmarked),
                                                parseBoolean(isSubscribed),
                                                subscribedBy,
                                                subscribedOnTs,
                                                subscribedUntilTs,
                                                parseBoolean(renewedAd),
                                                parseBoolean(isFriend),
                                                tipsSumVal,
                                                postsCountVal,
                                                photosCountVal,
                                                videosCountVal,
                                                audiosCountVal,
                                                mediaCountVal,
                                                subscribersCountVal,
                                                favoritesCountVal,
                                                avatarThumbsJson,
                                                headerSizeJson,
                                                headerThumbsJson,
                                                listsStatesJson,
                                                subscribedByDataJson,
                                                subscribedOnDataJson,
                                                promoOffersJson,
                                                existingFans[fanId]?.parker_name || null,
                                                existingFans[fanId]?.is_custom || false
                                        ]
                                );
                        }
                };

                for (const fan of allFans) {
                        await processFan(fan);
                }

                console.log('RefreshFans: Completed updating fan records.');
                const all = await pool.query('SELECT * FROM fans');
                res.json({ fans: all.rows });
        } catch (err) {
                console.error('Error in /api/refreshFans:', sanitizeError(err));
                const status =
                        err.status ||
                        (err.message && err.message.includes('No OnlyFans account') ? 400 : 500);
                const message =
                        status === 429
                                ? 'OnlyFans API rate limit exceeded. Please try again later.'
                                : (err.message || 'Failed to refresh fan list.');
                res.status(status).json({ error: message });
        }
});

let parkerUpdateInProgress = false;

app.post('/api/updateParkerNames', async (req, res) => {
        const missing = [];
        if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
        if (missing.length) {
                return res.status(400).json({ error: `Missing environment variable(s): ${missing.join(', ')}` });
        }

        if (parkerUpdateInProgress) {
                return res.status(409).json({ error: 'Parker name update already in progress.' });
        }

        parkerUpdateInProgress = true;

        (async () => {
                try {
                        const dbRes = await pool.query('SELECT id, username, name, parker_name, is_custom FROM fans');
                        const toProcess = dbRes.rows.filter(f => (!f.parker_name || f.parker_name === '') && !f.is_custom);

                        const systemPrompt = `You are Parker’s conversational assistant. Decide how to address a subscriber by evaluating their username and profile name.

1. If the profile name contains a plausible real first name, use its first word.
2. Otherwise derive the name from the username: split camelCase or underscores, remove digits, and use the first resulting word.
3. Return "Cuddles" only when both the username and profile name look system generated (e.g. username is 'u' followed by digits or purely numeric and the profile name is blank or numeric).
4. Do not use abbreviations, initials, or ellipses. Provide a single fully spelled name with the first letter capitalized.

Respond with only the chosen name.`;

                        const BATCH_SIZE = 5;
                        const failedFanIds = [];

                        const processFan = async (fan) => {
                                const fanId = fan.id;
                                const username = fan.username || '';
                                const profileName = fan.name || '';

                                try {
                                        let parkerName;
                                        if (isSystemGenerated(username, profileName)) {
                                                parkerName = 'Cuddles';
                                        } else {
                                                const userPrompt = `Subscriber username: "${username}". Profile name: "${profileName}". What should be the display name?`;
                                                const completion = await openaiRequest(() =>
                                                        openaiAxios.post(
                                                                'https://api.openai.com/v1/chat/completions',
                                                                {
                                                                        model: OPENAI_MODEL,
                                                                        messages: [
                                                                                { role: 'system', content: systemPrompt },
                                                                                { role: 'user', content: userPrompt }
                                                                        ],
                                                                        max_tokens: 10,
                                                                        temperature: 0.3
                                                                },
                                                                { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
                                                        )
                                                );
                                                parkerName = completion.data.choices[0].message.content.trim();
                                                console.log(`${OPENAI_MODEL} name for ${username}: ${parkerName}`);
                                        }

                                        const originalName = parkerName;
                                        parkerName = ensureValidParkerName(parkerName, username, profileName);
                                        if (parkerName !== originalName) {
                                                // Parker name was adjusted to meet validation rules
                                        }

                                        await pool.query('UPDATE fans SET parker_name=$2, is_custom=false, updatedAt=NOW() WHERE id=$1', [fanId, parkerName]);
                                } catch (err) {
                                        console.error(`Failed to process fan ${fanId}:`, sanitizeError(err));
                                        failedFanIds.push(fanId);
                                }
                        };

                        for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
                                const batch = toProcess.slice(i, i + BATCH_SIZE);
                                await Promise.all(batch.map(processFan));
                        }

                        if (failedFanIds.length > 0) {
                                console.log('Failed to update Parker names for fan IDs:', failedFanIds);
                        }
                } catch (err) {
                        console.error('Error in /api/updateParkerNames:', sanitizeError(err));
                } finally {
                        parkerUpdateInProgress = false;
                }
        })();

        res.json({ started: true });
});

/* Allow manual editing of ParkerGivenName in the database */
app.put('/api/fans/:id', async (req, res) => {
        try {
                const fanId = req.params.id;
                const rawName = req.body.parker_name;
                if (!fanId || !rawName) {
                        return res.status(400).json({ error: "Missing fan id or name." });
                }
                const sanitized = removeEmojis(rawName).trim();
                const checked = ensureValidParkerName(sanitized, "", "");
                if (checked !== sanitized) {
                        return res.status(400).json({ error: "Invalid Parker name." });
                }
                await pool.query(
                        'UPDATE fans SET parker_name=$1, is_custom=$2 WHERE id=$3',
                        [ checked, true, fanId ]
                );
                console.log(`User manually set ParkerName for fan ${fanId} -> "${checked}"`);
                res.json({ success: true });
        } catch (err) {
                console.error("Error in /api/fans/:id PUT:", sanitizeError(err));
                res.status(500).json({ error: "Failed to update name." });
        }
});

// Retrieve all media from OnlyFans vault with pagination
app.get('/api/vault-media', async (req, res) => {
       try {
               const accountId = await getOFAccountId();
               const media = [];
               const limit = 100;
               let offset = 0;
               while (true) {
                       const resp = await ofApiRequest(() =>
                               ofApi.get(`/${accountId}/media/vault`, {
                                       params: { limit, offset }
                               })
                       );
                       const items = resp.data?.media || resp.data?.list || resp.data?.data || resp.data;
                       if (!Array.isArray(items) || items.length === 0) break;
                       media.push(...items);
                       offset += limit;
               }

               res.json({ media });
       } catch (err) {
               console.error('Error fetching vault media:', sanitizeError(err));
               const status = err.message.includes('OnlyFans account') ? 400 : 500;
               res.status(status).json({ error: status === 400 ? err.message : 'Failed to fetch vault media' });
       }
});

// PPV management endpoints
app.get('/api/ppv', async (req, res) => {
        try {
                const dbRes = await pool.query('SELECT id, ppv_number, description, price, vault_list_id, schedule_day, schedule_time, last_sent_at, created_at FROM ppv_sets ORDER BY ppv_number');
                const ppvs = dbRes.rows.map(({ schedule_day, schedule_time, ...rest }) => ({
                        ...rest,
                        scheduleDay: schedule_day,
                        scheduleTime: schedule_time
                }));
                res.json({ ppvs });
        } catch (err) {
                console.error('Error fetching PPVs:', sanitizeError(err));
                res.status(500).json({ error: 'Failed to fetch PPVs' });
        }
});

app.post('/api/ppv', async (req, res) => {
        const { ppvNumber, description, price, mediaFiles, previews, scheduleDay, scheduleTime } = req.body || {};

        if ((scheduleDay == null) !== (scheduleTime == null)) {
                return res.status(400).json({ error: 'Both scheduleDay and scheduleTime must be provided together' });
        }
        if (scheduleDay != null) {
                if (!Number.isInteger(scheduleDay) || scheduleDay < 1 || scheduleDay > 31) {
                        return res.status(400).json({ error: 'scheduleDay must be an integer between 1 and 31' });
                }
                if (typeof scheduleTime !== 'string' || !/^\d{2}:\d{2}$/.test(scheduleTime)) {
                        return res.status(400).json({ error: 'scheduleTime must be in HH:MM format' });
                }
                const [h, m] = scheduleTime.split(':').map(Number);
                if (h < 0 || h > 23 || m < 0 || m > 59) {
                        return res.status(400).json({ error: 'scheduleTime must be in 24-hour HH:MM format' });
                }
        }

        if (!Number.isInteger(ppvNumber) || typeof description !== 'string' || description.trim() === '' || !Number.isFinite(price) || !Array.isArray(mediaFiles) || mediaFiles.length === 0 || !Array.isArray(previews)) {
                return res.status(400).json({ error: 'Invalid PPV data.' });
        }
       let vaultListId;
       let accountId;
       try {
               accountId = await getOFAccountId();
               const listResp = await ofApiRequest(() => ofApi.post(`/${accountId}/media/vault/lists`, { name: `PPV ${ppvNumber}` }));
               vaultListId = listResp.data?.id || listResp.data?.list?.id;
               await ofApiRequest(() => ofApi.post(`/${accountId}/media/vault/lists/${vaultListId}/media`, { media_ids: mediaFiles }));

               const client = await pool.connect();
               let ppvRow;
               try {
                       await client.query('BEGIN');
const setRes = await client.query('INSERT INTO ppv_sets (ppv_number, description, price, vault_list_id, schedule_day, schedule_time) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [ppvNumber, description, price, vaultListId, scheduleDay, scheduleTime]);
                        ppvRow = setRes.rows[0];
                        for (const mediaId of mediaFiles) {
                                const isPreview = previews.includes(mediaId);
                                await client.query('INSERT INTO ppv_media (ppv_id, media_id, is_preview) VALUES ($1,$2,$3)', [ppvRow.id, mediaId, isPreview]);
                        }
                        await client.query('COMMIT');
                } catch (dbErr) {
                               await client.query('ROLLBACK');
                               try {
                                       await ofApiRequest(() => ofApi.delete(`/${accountId}/media/vault/lists/${vaultListId}`));
                                       vaultListId = null;
                               } catch (cleanupErr) {
                                        console.error('Error cleaning up vault list:', cleanupErr.response ? cleanupErr.response.data || cleanupErr.response.statusText : cleanupErr.message);
                               }
                               throw dbErr;
                       } finally {
                               client.release();
                       }
                const ppv = {
                        ...ppvRow,
                        scheduleDay: ppvRow.schedule_day,
                        scheduleTime: ppvRow.schedule_time,
                        media: mediaFiles.map(id => ({ media_id: id, is_preview: previews.includes(id) }))
                };
                delete ppv.schedule_day;
                delete ppv.schedule_time;
                res.status(201).json({ ppv });
       } catch (err) {
               if (vaultListId && accountId) {
                       try {
                               await ofApiRequest(() => ofApi.delete(`/${accountId}/media/vault/lists/${vaultListId}`));
                       } catch (cleanupErr) {
                               console.error('Error cleaning up vault list:', cleanupErr.response ? cleanupErr.response.data || cleanupErr.response.statusText : cleanupErr.message);
                       }
               }
               console.error('Error creating PPV:', err.response ? err.response.data || err.response.statusText : err.message);
               const status = err.message.includes('OnlyFans account') ? 400 : 500;
               res.status(status).json({ error: status === 400 ? err.message : 'Failed to create PPV' });
       }
});

app.put('/api/ppv/:id', async (req, res) => {
        try {
                const id = req.params.id;
                const { description, price, scheduleDay, scheduleTime } = req.body || {};

                const existingRes = await pool.query('SELECT schedule_day, schedule_time FROM ppv_sets WHERE id=$1', [id]);
                if (existingRes.rowCount === 0) {
                        return res.status(404).json({ error: 'PPV not found' });
                }
                const existing = existingRes.rows[0];

                if ((scheduleDay !== undefined) !== (scheduleTime !== undefined)) {
                        return res.status(400).json({ error: 'Both scheduleDay and scheduleTime must be provided together' });
                }
                if (scheduleDay !== undefined && scheduleDay !== null) {
                        if (!Number.isInteger(scheduleDay) || scheduleDay < 1 || scheduleDay > 31) {
                                return res.status(400).json({ error: 'scheduleDay must be an integer between 1 and 31' });
                        }
                        if (typeof scheduleTime !== 'string' || !/^\d{2}:\d{2}$/.test(scheduleTime)) {
                                return res.status(400).json({ error: 'scheduleTime must be in HH:MM format' });
                        }
                        const [h, m] = scheduleTime.split(':').map(Number);
                        if (h < 0 || h > 23 || m < 0 || m > 59) {
                                return res.status(400).json({ error: 'scheduleTime must be in 24-hour HH:MM format' });
                        }
                }

                const fields = [];
                const values = [];
                let idx = 1;
                if (description !== undefined) { fields.push(`description=$${idx++}`); values.push(description); }
                if (price !== undefined) { fields.push(`price=$${idx++}`); values.push(price); }
                if (scheduleDay !== undefined) {
                        fields.push(`schedule_day=$${idx++}`); values.push(scheduleDay);
                        fields.push(`schedule_time=$${idx++}`); values.push(scheduleTime);
                }
                if (!fields.length) {
                        return res.status(400).json({ error: 'No valid fields to update.' });
                }

                values.push(id);
                const updateRes = await pool.query(`UPDATE ppv_sets SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`, values);
                const updated = updateRes.rows[0];

                if (scheduleDay !== undefined && (existing.schedule_day !== scheduleDay || existing.schedule_time !== scheduleTime)) {
                        await pool.query('UPDATE ppv_sets SET last_sent_at = NULL WHERE id=$1', [id]);
                        console.log(`Reset last_sent_at for PPV ${id} due to schedule change`);
                        updated.last_sent_at = null;
                }

                const ppv = {
                        ...updated,
                        scheduleDay: updated.schedule_day,
                        scheduleTime: updated.schedule_time
                };
                delete ppv.schedule_day;
                delete ppv.schedule_time;
                res.json({ ppv });
        } catch (err) {
                console.error('Error updating PPV:', sanitizeError(err));
                res.status(500).json({ error: 'Failed to update PPV' });
        }
});

app.delete('/api/ppv/:id', async (req, res) => {
        try {
                const id = req.params.id;
                const dbRes = await pool.query('SELECT vault_list_id FROM ppv_sets WHERE id=$1', [id]);
                if (dbRes.rows.length === 0) {
                        return res.status(404).json({ error: 'PPV not found' });
                }
               const vaultListId = dbRes.rows[0].vault_list_id;
               if (vaultListId) {
                       let accountId;
                       try {
                               accountId = await getOFAccountId();
                       } catch (_) {
                               accountId = null;
                       }
                       if (accountId) {
                               try {
                                       await ofApiRequest(() => ofApi.delete(`/${accountId}/media/vault/lists/${vaultListId}`));
                               } catch (apiErr) {
                                       console.error('Error deleting OnlyFans vault list:', apiErr.response ? apiErr.response.data || apiErr.response.statusText : apiErr.message);
                               }
                       }
               }
                await pool.query('DELETE FROM ppv_sets WHERE id=$1', [id]);
                res.json({ success: true });
        } catch (err) {
                console.error('Error deleting PPV:', sanitizeError(err));
                res.status(500).json({ error: 'Failed to delete PPV' });
        }
});

/* Story 2: Send Personalized DM to All Fans */
app.post('/api/sendMessage', async (req, res) => {
        const missing = getMissingEnvVars();
        if (missing.length) {
                return res.status(400).json({ error: `Missing environment variable(s): ${missing.join(', ')}` });
        }
        try {
                const fanId = req.body.userId;
                const greeting = req.body.greeting || "";
                const body = req.body.body || "";

                // Normalize and sanitize media and preview arrays
                let mediaFiles = Array.isArray(req.body.mediaFiles)
                        ? req.body.mediaFiles.map(Number).filter(Number.isFinite)
                        : [];
                let previews = Array.isArray(req.body.previews)
                        ? req.body.previews.map(Number).filter(Number.isFinite)
                        : [];

                // Deduplicate and remove overlaps
                const mediaSet = new Set(mediaFiles);
                const previewSet = new Set(previews);
                for (const id of [...previewSet]) {
                        if (mediaSet.has(id)) {
                                mediaSet.delete(id);
                                previewSet.delete(id);
                        }
                }
                mediaFiles = Array.from(mediaSet);
                previews = Array.from(previewSet);

                // Determine whether text should be locked
                const lockedText = req.body.lockedText === true;

                // Parse price; default to 0 if NaN or neither media nor locked text
                let price = parseFloat(req.body.price);
                if (isNaN(price) || (mediaFiles.length === 0 && !lockedText)) price = 0;

                await sendPersonalizedMessage(fanId, greeting, body, price, lockedText, mediaFiles, previews);
                res.json({ success: true });
        } catch (err) {
                console.error("Error sending message to fan:", err.response ? err.response.data || err.response.statusText : err.message);
                const status = err.status || err.response?.status;
                const message = status === 429 ? 'OnlyFans API rate limit exceeded. Please try again later.' : (err.response ? err.response.statusText || err.response.data : err.message);
                res.status(status || 500).json({ error: message });
        }
});

app.post('/api/scheduleMessage', async (req, res) => {
        try {
                const greeting = req.body.greeting || "";
                const body = req.body.body || "";
                const recipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
                const scheduledTime = req.body.scheduledTime;
                const price = req.body.price;
                const lockedText = req.body.lockedText;
                const mediaFiles = Array.isArray(req.body.mediaFiles) ? req.body.mediaFiles : [];
                const previews = Array.isArray(req.body.previews) ? req.body.previews : [];
                if (recipients.length === 0 || (!greeting && !body) || !scheduledTime) {
                        return res.status(400).json({ error: 'Missing recipients, message, or scheduledTime.' });
                }
                const scheduledAt = new Date(scheduledTime);
                if (isNaN(scheduledAt)) {
                        return res.status(400).json({ error: 'Invalid scheduledTime.' });
                }
                await pool.query(
                        'INSERT INTO scheduled_messages (greeting, body, recipients, media_files, previews, price, locked_text, scheduled_at, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
                        [greeting, body, recipients, mediaFiles, previews, price ?? null, lockedText || null, scheduledAt, 'pending']
                );
                res.json({ success: true });
        } catch (err) {
                console.error('Error scheduling message:', sanitizeError(err));
                res.status(500).json({ error: err.message });
        }
});

app.get('/api/scheduledMessages', async (req, res) => {
        try {
                const dbRes = await pool.query("SELECT id, greeting, body, recipients, media_files, previews, price, locked_text, scheduled_at, status FROM scheduled_messages WHERE status='pending' ORDER BY scheduled_at");
                res.json({ messages: dbRes.rows });
        } catch (err) {
                console.error('Error fetching scheduled messages:', sanitizeError(err));
                res.status(500).json({ error: err.message });
        }
});

app.put('/api/scheduledMessages/:id', async (req, res) => {
        try {
                const fields = [];
                const values = [];
                let idx = 1;
                if (req.body.greeting !== undefined) { fields.push(`greeting=$${idx++}`); values.push(req.body.greeting); }
                if (req.body.body !== undefined) { fields.push(`body=$${idx++}`); values.push(req.body.body); }
                if (req.body.price !== undefined) { fields.push(`price=$${idx++}`); values.push(req.body.price); }
                if (req.body.lockedText !== undefined) { fields.push(`locked_text=$${idx++}`); values.push(req.body.lockedText); }
                if (req.body.scheduledTime) {
                        const newDate = new Date(req.body.scheduledTime);
                        if (isNaN(newDate)) return res.status(400).json({ error: 'Invalid scheduledTime.' });
                        fields.push(`scheduled_at=$${idx++}`);
                        values.push(newDate);
                }
                if (!fields.length) {
                        return res.status(400).json({ error: 'No valid fields to update.' });
                }
                values.push(req.params.id);
                await pool.query(`UPDATE scheduled_messages SET ${fields.join(', ')} WHERE id=$${idx}`, values);
                res.json({ success: true });
        } catch (err) {
                console.error('Error updating scheduled message:', sanitizeError(err));
                res.status(500).json({ error: err.message });
        }
});

app.delete('/api/scheduledMessages/:id', async (req, res) => {
        try {
                await pool.query('UPDATE scheduled_messages SET status=$1 WHERE id=$2', ['canceled', req.params.id]);
                res.json({ success: true });
        } catch (err) {
                console.error('Error canceling scheduled message:', sanitizeError(err));
                res.status(500).json({ error: err.message });
        }
});

// Retrieve message history for a fan
app.get('/api/messages/history', async (req, res) => {
        try {
                const fanId = req.query.fanId;
                let limit = parseInt(req.query.limit, 10);
                if (!fanId) {
                        return res.status(400).json({ error: 'fanId required' });
                }
                if (!Number.isFinite(limit) || limit <= 0) limit = 20;
               let accountId;
               try {
                       accountId = await getOFAccountId();
               } catch (err) {
                       return res.status(400).json({ error: err.message });
               }
               const resp = await ofApiRequest(() => ofApi.get(`/${accountId}/chats/${fanId}/messages`, { params: { limit } }));
               const raw = resp.data?.messages || resp.data?.list || resp.data?.data?.messages || resp.data?.data?.list || [];
               const messages = Array.isArray(raw) ? raw : [];
               for (const m of messages) {
                       const msgId = m.id;
                       const direction = (m.fromUser?.id || m.user?.id || m.senderId) === accountId ? 'outgoing' : 'incoming';
                       const body = m.text || m.body || '';
                       const price = m.price ?? null;
                        const created = new Date((m.createdAt || m.created_at || m.postedAt || m.time || 0) * 1000);
                        await pool.query(
                                'INSERT INTO messages (id, fan_id, direction, body, price, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET fan_id=EXCLUDED.fan_id, direction=EXCLUDED.direction, body=EXCLUDED.body, price=EXCLUDED.price, created_at=EXCLUDED.created_at',
                                [msgId, fanId, direction, body, price, created]
                        );
                        m.direction = direction;
                }
                res.json({ messages });
        } catch (err) {
                console.error('Error fetching message history:', err.response ? err.response.data || err.response.statusText : err.message);
                const status = err.status || err.response?.status;
                const message = status === 429 ? 'OnlyFans API rate limit exceeded. Please try again later.' : (err.response ? err.response.statusText || err.response.data : err.message);
                res.status(status || 500).json({ error: message });
        }
});

// Endpoint to get all fans from DB (for initial page load if needed)
app.get('/api/fans', async (req, res) => {
        try {
                const dbRes = await pool.query(`
                        SELECT
                                id,
                                username,
                                name,
                                avatar,
                                header,
                                website,
                                location,
                                gender,
                                birthday,
                                about,
                                notes,
                                lastSeen AS "lastSeen",
                                joined AS "joined",
                                canReceiveChatMessage AS "canReceiveChatMessage",
                                canSendChatMessage AS "canSendChatMessage",
                                isBlocked AS "isBlocked",
                                isMuted AS "isMuted",
                                isRestricted AS "isRestricted",
                                isHidden AS "isHidden",
                                isBookmarked AS "isBookmarked",
                                isSubscribed AS "isSubscribed",
                                subscribedBy AS "subscribedBy",
                                subscribedOn AS "subscribedOn",
                                subscribedUntil AS "subscribedUntil",
                                renewedAd AS "renewedAd",
                                isFriend AS "isFriend",
                                tipsSum AS "tipsSum",
                                postsCount AS "postsCount",
                                photosCount AS "photosCount",
                                videosCount AS "videosCount",
                                audiosCount AS "audiosCount",
                                mediaCount AS "mediaCount",
                                subscribersCount AS "subscribersCount",
                                favoritesCount AS "favoritesCount",
                                avatarThumbs AS "avatarThumbs",
                                headerSize AS "headerSize",
                                headerThumbs AS "headerThumbs",
                                listsStates AS "listsStates",
                                subscribedByData AS "subscribedByData",
                                subscribedOnData AS "subscribedOnData",
                                promoOffers AS "promoOffers",
                                parker_name,
                                is_custom,
                                updatedAt AS "updatedAt"
                        FROM fans
                        ORDER BY id`);
                res.json({ fans: dbRes.rows });
        } catch (err) {
                console.error("Error in GET /api/fans:", sanitizeError(err));
                res.status(500).json({ error: "Failed to retrieve fans." });
        }
});

// Retrieve fans that are not currently followed
app.get('/api/fans/unfollowed', async (req, res) => {
        try {
                const dbRes = await pool.query('SELECT id, username FROM fans WHERE isSubscribed = FALSE ORDER BY id');
                res.json({ fans: dbRes.rows });
        } catch (err) {
                console.error('Error in GET /api/fans/unfollowed:', sanitizeError(err));
                res.status(500).json({ error: 'Failed to retrieve unfollowed fans.' });
        }
});

// Follow a single fan by ID
app.post('/api/fans/:id/follow', async (req, res) => {
        try {
                const fanId = req.params.id;
                if (!fanId) return res.status(400).json({ error: 'Missing fan id.' });
               let accountId;
               try {
                       accountId = await getOFAccountId();
               } catch (err) {
                       return res.status(400).json({ error: err.message });
               }

               await ofApiRequest(() => ofApi.post(`/${accountId}/users/${fanId}/follow`));
                await pool.query('UPDATE fans SET isSubscribed = TRUE WHERE id=$1', [fanId]);
                res.json({ success: true });
        } catch (err) {
                console.error('Error in POST /api/fans/:id/follow:', sanitizeError(err));
                const status = err.status || err.response?.status;
                const message = status === 429
                        ? 'OnlyFans API rate limit exceeded. Please try again later.'
                        : (err.response ? err.response.statusText || err.response.data : err.message);
                res.status(status || 500).json({ error: message });
        }
});

// Bulk follow all unfollowed fans with streaming progress
app.post('/api/fans/followAll', async (req, res) => {
        let accountId;
        try {
                accountId = await getOFAccountId();
        } catch (err) {
                return res.status(400).json({ error: err.message });
        }

        let fans;
        try {
                const dbRes = await pool.query('SELECT id, username FROM fans WHERE isSubscribed = FALSE ORDER BY id');
                fans = dbRes.rows;
        } catch (err) {
                console.error('Error in POST /api/fans/followAll:', sanitizeError(err));
                return res.status(500).json({ error: 'Failed to fetch fans.' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        if (res.flushHeaders) res.flushHeaders();

        for (const fan of fans) {
                try {
                        await ofApiRequest(() => ofApi.post(`/${accountId}/users/${fan.id}/follow`));
                        await pool.query('UPDATE fans SET isSubscribed = TRUE WHERE id=$1', [fan.id]);
                        res.write(`data: ${JSON.stringify({ id: fan.id, username: fan.username, success: true })}\n\n`);
                } catch (err) {
                        const msg = err.response ? err.response.statusText || err.response.data : err.message;
                        res.write(`data: ${JSON.stringify({ id: fan.id, username: fan.username, success: false, error: msg })}\n\n`);
                }
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
});

// System status endpoint
app.get('/api/status', async (req, res) => {
        const status = {
                env: {},
                database: {},
                onlyfans: {},
                openai: {},
                files: { envFile: fs.existsSync(path.join(__dirname, '.env')) },
                node: { version: process.version }
        };
        const requiredEnv = ['ONLYFANS_API_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT'];
        requiredEnv.forEach(k => {
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
                status.onlyfans.error = err.response ? err.response.statusText || err.response.data : err.message;
        }
        try {
                await openaiAxios.get('https://api.openai.com/v1/models', {
                        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
                });
                status.openai.ok = true;
        } catch (err) {
                status.openai.ok = false;
                status.openai.error = err.response ? err.response.statusText || err.response.data : err.message;
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
                const dbRes = await pool.query("SELECT * FROM scheduled_messages WHERE status='pending' AND scheduled_at <= NOW()");
                for (const row of dbRes.rows) {
                        const recipients = Array.isArray(row.recipients) ? row.recipients : [];
                        let allSent = true;
                        for (const fanId of recipients) {
                                try {
                                        await sendPersonalizedMessage(
                                                fanId,
                                                row.greeting || '',
                                                row.body || '',
                                                row.price,
                                                row.locked_text,
                                                row.media_files || [],
                                                row.previews || []
                                        );
                                } catch (err) {
                                        allSent = false;
                                        console.error(`Error sending scheduled message ${row.id} to ${fanId}:`, err.message);
                                }
                        }
                        const newStatus = allSent ? 'sent' : 'failed';
                        await pool.query('UPDATE scheduled_messages SET status=$1 WHERE id=$2', [newStatus, row.id]);
                }
        } catch (err) {
                console.error('Error processing scheduled messages:', sanitizeError(err));
        }
}

function shouldSendNow(ppv, now = new Date()) {
        const { schedule_day: scheduleDay, schedule_time: scheduleTime, last_sent_at: lastSentAt } = ppv;
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

async function processRecurringPPVs() {
       if (!hasPpvSetsTable) return;
       const missing = getMissingEnvVars();
       if (missing.length) {
               console.error(`Missing environment variable(s): ${missing.join(', ')}`);
               return;
       }
       try {
               const ppvRes = await pool.query('SELECT id, description, price, schedule_day, schedule_time, last_sent_at FROM ppv_sets WHERE schedule_day IS NOT NULL AND schedule_time IS NOT NULL');
               if (ppvRes.rows.length === 0) return;
               const fansRes = await pool.query('SELECT id FROM fans WHERE isSubscribed = TRUE AND canReceiveChatMessage = TRUE');
               const fanIds = fansRes.rows.map(r => r.id);
               for (const ppv of ppvRes.rows) {
                       if (!shouldSendNow(ppv)) continue;
                       const { id, description, price } = ppv;
                       const mediaRes = await pool.query('SELECT media_id, is_preview FROM ppv_media WHERE ppv_id=$1', [id]);
                       const mediaFiles = mediaRes.rows.map(r => r.media_id);
                       const previews = mediaRes.rows.filter(r => r.is_preview).map(r => r.media_id);
                       for (const fanId of fanIds) {
                               try {
                                       await sendPersonalizedMessage(fanId, '', description || '', price, false, mediaFiles, previews);
                               } catch (err) {
                                       console.error(`Error sending PPV ${id} to fan ${fanId}:`, err.message);
                               }
                       }
                       await pool.query('UPDATE ppv_sets SET last_sent_at = NOW() WHERE id=$1', [id]);
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
async function initScheduling() {
        hasScheduledMessagesTable = await tableExists('scheduled_messages');
        if (!hasScheduledMessagesTable) {
                console.warn("scheduled_messages table missing; skipping scheduled message processing");
        }
        hasPpvSetsTable = await tableExists('ppv_sets');
        if (!hasPpvSetsTable) {
                console.warn("ppv_sets table missing; skipping recurring PPV processing");
        }
        if (hasScheduledMessagesTable || hasPpvSetsTable) {
                setInterval(processAllSchedules, 60000);
                await processAllSchedules();
        }
}

if (require.main === module) {
        app.listen(port, () => {
                console.log(`OFEM server listening on http://localhost:${port}`);
        });
        initScheduling();
}

// Export app for testing
module.exports = app;
module.exports.shouldSendNow = shouldSendNow;
module.exports.processRecurringPPVs = processRecurringPPVs;
module.exports.sendPersonalizedMessage = (...args) => sendPersonalizedMessage(...args);
module.exports._setSendPersonalizedMessage = fn => {
        sendPersonalizedMessage = fn;
};

/* End of File – Last modified 2025-08-02 */
