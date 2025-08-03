/*  OnlyFans Express Messenger (OFEM)
    File: server.js
    Purpose: Express server for OFEM (OnlyFans integration and ChatGPT usage)
    Created: 2025-08-02 – v1.0
*/

const express = require('express');
const axios = require('axios');
const { Configuration, OpenAIApi } = require('openai');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const getEditorHtml = require('./getEditorHtml');
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
let OFAccountId = null;
// Wrapper to handle OnlyFans API rate limiting with retries
async function ofApiRequest(requestFn, maxRetries = 5) {
        let delay = 1000; // start with 1s
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                        return await requestFn();
                } catch (err) {
                        if (err.code === 'ECONNABORTED') {
                                console.error('OnlyFans API request timed out');
                                const timeoutErr = new Error('OnlyFans API request timed out');
                                timeoutErr.status = 504;
                                throw timeoutErr;
                        }
                        const status = err.response?.status;
                        if (status !== 429) throw err;
                        if (attempt === maxRetries) {
                                const rateErr = new Error('OnlyFans API rate limit exceeded');
                                rateErr.status = 429;
                                throw rateErr;
                        }
                        const retryAfter = parseInt(err.response.headers['retry-after'], 10);
                        const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : delay;
                        await new Promise(r => setTimeout(r, wait));
                        delay *= 2;
                }
        }
}

// Wrapper to handle OpenAI rate limiting with retries
async function openaiRequest(requestFn, maxRetries = 5) {
        let delay = 1000; // start with 1s
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
                        if (status !== 429) throw err;
                        if (attempt === maxRetries) {
                                const aiErr = new Error('OpenAI API rate limit exceeded');
                                aiErr.status = 429;
                                throw aiErr;
                        }
                        const retryAfter = parseInt(err.response.headers['retry-after'], 10);
                        const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : delay;
                        console.warn(`OpenAI rate limit hit. Retry ${attempt + 1} in ${wait}ms`);
                        await new Promise(r => setTimeout(r, wait));
                        delay *= 2;
                }
        }
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

async function sendPersonalizedMessage(fanId, greeting = "", body = "", price, lockedText, mediaFiles = [], previews = []) {
        if (!fanId || (!greeting && !body)) {
                throw new Error('Missing userId or message.');
        }
        let template = [greeting, body].filter(Boolean).join(' ').trim();
        if (!OFAccountId) {
                const accountsResp = await ofApiRequest(() => ofApi.get('/accounts'));
                const accounts = accountsResp.data.accounts || accountsResp.data;
                if (!accounts || accounts.length === 0) {
                        throw new Error('No OnlyFans account available.');
                }
                OFAccountId = accounts[0].id;
        }
        const dbRes = await pool.query('SELECT parker_name, username, location FROM fans WHERE id=$1', [fanId]);
        const row = dbRes.rows[0] || {};
        const parkerName = removeEmojis(row.parker_name || "");
        const userName = removeEmojis(row.username || "");
        const userLocation = removeEmojis(row.location || "");
        template = template.replace(/\{name\}|\[name\]|\{parker_name\}/g, parkerName);
        template = template.replace(/\{username\}/g, userName);
        template = template.replace(/\{location\}/g, userLocation);
        const formatted = getEditorHtml(template);
        const payload = { text: formatted };
        if (price !== undefined) payload.price = price;
        if (lockedText) payload.lockedText = lockedText;
        if (Array.isArray(mediaFiles) && mediaFiles.length) payload.mediaFiles = mediaFiles;
        if (Array.isArray(previews) && previews.length) payload.previews = previews;
        await ofApiRequest(() => ofApi.post(`/${OFAccountId}/chats/${fanId}/messages`, payload));
        await pool.query(
                'INSERT INTO messages (fan_id, direction, body, price) VALUES ($1, $2, $3, $4)',
                [fanId, 'outgoing', formatted, price ?? null]
        );
        console.log(`Sent message to ${fanId}: ${template.substring(0, 30)}...`);
}


/* Story 1: Update Fan Names – Fetch fans from OnlyFans and generate display names using GPT-4. */
app.post('/api/updateFans', async (req, res) => {
        const missing = [];
        if (!process.env.ONLYFANS_API_KEY) missing.push('ONLYFANS_API_KEY');
        if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
        if (missing.length) {
                return res.status(400).json({ error: `Missing environment variable(s): ${missing.join(', ')}` });
        }

        try {
                // 1. Verify API key and get connected account ID
                const accountsResp = await ofApiRequest(() => ofApi.get('/accounts'));
                const rawAccounts = accountsResp.data?.data || accountsResp.data;
                const accounts = Array.isArray(rawAccounts) ? rawAccounts : rawAccounts?.accounts || [];
                if (!accounts || accounts.length === 0) {
                        return res.status(400).send("No OnlyFans account is connected to this API key.");
                }
                OFAccountId = accounts[0].id;
                console.log(`Using OnlyFans account: ${OFAccountId}`);

                // 2. Fetch all fans (active + expired subscribers)
                // OnlyFans API appears to cap page size at 32 items
                const limit = 32;
                const fetchFans = async (type) => {
                        const results = [];
                        let offset = 0;
                        const RUNAWAY_LIMIT = 1000; // safeguard against runaway offsets
                        while (true) {
                                try {
                                        const resp = await ofApiRequest(() => ofApi.get(`/${OFAccountId}/fans/${type}`, { params: { limit, offset } }));
                                        const page = resp.data?.data?.list || resp.data?.list || resp.data;
                                        if (!page || page.length === 0) break;
                                        results.push(...page);
                                        offset += page.length;
                                        if (offset > RUNAWAY_LIMIT) {
                                                console.warn(`Fetch fans ${type}: offset exceeded ${RUNAWAY_LIMIT}, stopping.`);
                                                break;
                                        }
                                } catch (err) {
                                        const status = err.response?.status;
                                        if (status === 429) throw err; // rate limit errors should still bubble up
                                        console.warn(`Fetch fans ${type} failed at offset ${offset} (status ${status || 'unknown'}). Returning partial results.`);
                                        break;
                                }
                        }
                        return results;
                };
                const activeFans = await fetchFans('active');
                const expiredFans = await fetchFans('expired');
                const fanMap = new Map();
                [...activeFans, ...expiredFans].forEach(f => { fanMap.set(f.id, f); });
                const allFans = Array.from(fanMap.values());
                console.log(`Fetched ${allFans.length} fans from OnlyFans.`);
		
		// 3. Load existing fans from DB
		const dbRes = await pool.query('SELECT id, parker_name, is_custom FROM fans');
		const existingFans = {};
		for (const row of dbRes.rows) {
			existingFans[row.id] = { parker_name: row.parker_name, is_custom: row.is_custom };
		}
		
                // 4. Prepare OpenAI API for GPT-4 usage
                const openai = new OpenAIApi(
                        new Configuration({ apiKey: process.env.OPENAI_API_KEY }),
                        undefined,
                        openaiAxios
                );
                const systemPrompt = `You are Parker’s conversational assistant. Decide how to address a subscriber by evaluating their username and profile name.

1. If the profile name contains a plausible real first name, use its first word.
2. Otherwise derive the name from the username: split camelCase or underscores, remove digits, and use the first resulting word.
3. Return "Cuddles" only when both the username and profile name look system generated (e.g. username is 'u' followed by digits or purely numeric and the profile name is blank or numeric).
4. Do not use abbreviations, initials, or ellipses. Provide a single fully spelled name with the first letter capitalized.

Respond with only the chosen name.`;
		
                // 5. Update/insert each fan in database with ParkerGivenName
                const totalFans = allFans.length;
                let processed = 0;
                const BATCH_SIZE = 5; // limit concurrent OpenAI requests
                const updatedFans = [];

                const processFan = async (fan) => {
                        const fanId = fan.id.toString();
                        const username = fan.username || "";
                        const profileName = fan.name || "";
                        let parkerName = existingFans[fanId] ? existingFans[fanId].parker_name : null;
                        let isCustom = existingFans[fanId] ? existingFans[fanId].is_custom : false;

                        // Extract additional OnlyFans properties
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

                        // Generate ParkerGivenName if not set yet and not manually overridden
                        if ((!parkerName || parkerName === "") && !isCustom) {
                                if (isSystemGenerated(username, profileName)) {
                                        parkerName = "Cuddles";
                                } else {
                                        const userPrompt = `Subscriber username: "${username}". Profile name: "${profileName}". What should be the display name?`;
                                        const completion = await openaiRequest(() => openai.createChatCompletion({
                                                model: "gpt-4",
                                                messages: [
                                                        { role: "system", content: systemPrompt },
                                                        { role: "user", content: userPrompt }
                                                ],
                                                max_tokens: 10,
                                                temperature: 0.3
                                        }));
                                        parkerName = completion.data.choices[0].message.content.trim();
                                        console.log(`GPT-4 name for ${username}: ${parkerName}`);
                                }
                        }

                        const originalName = parkerName;
                        parkerName = ensureValidParkerName(parkerName, username, profileName);
                        if (parkerName !== originalName) {
                                isCustom = false;
                        }

                        // Upsert in database (insert new or update existing)
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
                                                parker_name=$42,
                                                is_custom=$43,
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
                                                promoOffersJson,
                                                parkerName || existingFans[fanId].parker_name,
                                                isCustom
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
                                                parkerName || null,
                                                false
                                        ]
                                );
                        }
                        updatedFans.push({
                                id: fanId,
                                username: username,
                                name: profileName,
                                parker_name: parkerName || existingFans[fanId]?.parker_name || "",
                        });
                        processed++;
                        console.log(`Processed ${processed}/${totalFans} fans`);
                };

                for (let i = 0; i < allFans.length; i += BATCH_SIZE) {
                        const batch = allFans.slice(i, i + BATCH_SIZE);
                        await Promise.all(batch.map(processFan));
                }

                console.log("UpdateFans: Completed updating fan names.");
                res.json({ fans: updatedFans });
        } catch (err) {
                console.error("Error in /api/updateFans:", err);
                const status = err.status || 500;
                const message = status === 429 ? 'OnlyFans API rate limit exceeded. Please try again later.' : (err.message || 'Failed to update fan names.');
                res.status(status).json({ error: message });
        }
});

/* Allow manual editing of ParkerGivenName in the database */
app.put('/api/fans/:id', async (req, res) => {
        try {
                const fanId = req.params.id;
                const rawName = req.body.parker_name;
                if (!fanId || !rawName) {
                        return res.status(400).send("Missing fan id or name.");
                }
                const sanitized = removeEmojis(rawName).trim();
                const checked = ensureValidParkerName(sanitized, "", "");
                if (checked !== sanitized) {
                        return res.status(400).send("Invalid Parker name.");
                }
                await pool.query(
                        'UPDATE fans SET parker_name=$1, is_custom=$2 WHERE id=$3',
                        [ checked, true, fanId ]
                );
                console.log(`User manually set ParkerName for fan ${fanId} -> "${checked}"`);
                res.json({ success: true });
        } catch (err) {
                console.error("Error in /api/fans/:id PUT:", err);
                res.status(500).send("Failed to update name.");
        }
});

// Retrieve all media from OnlyFans vault with pagination
app.get('/api/vault-media', async (req, res) => {
        try {
                // Resolve OnlyFans account ID if not already known
                if (!OFAccountId) {
                        const accountsResp = await ofApiRequest(() => ofApi.get('/accounts'));
                        const rawAccounts = accountsResp.data?.data || accountsResp.data;
                        const accounts = Array.isArray(rawAccounts) ? rawAccounts : rawAccounts?.accounts || [];
                        if (!accounts || accounts.length === 0) {
                                return res.status(400).send('No OnlyFans account is connected to this API key.');
                        }
                        OFAccountId = accounts[0].id;
                        console.log(`Using OnlyFans account: ${OFAccountId}`);
                }

                const media = [];
                const limit = 100;
                let offset = 0;
                while (true) {
                        const resp = await ofApiRequest(() =>
                                ofApi.get(`/${OFAccountId}/media/vault`, {
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
                console.error('Error fetching vault media:', err);
                res.status(500).json({ error: 'Failed to fetch vault media' });
        }
});

/* Story 2: Send Personalized DM to All Fans */
app.post('/api/sendMessage', async (req, res) => {
        try {
                const fanId = req.body.userId;
                const greeting = req.body.greeting || "";
                const body = req.body.body || "";
                const price = req.body.price;
                const lockedText = req.body.lockedText;
                const mediaFiles = Array.isArray(req.body.mediaFiles) ? req.body.mediaFiles : [];
                const previews = Array.isArray(req.body.previews) ? req.body.previews : [];
                await sendPersonalizedMessage(fanId, greeting, body, price, lockedText, mediaFiles, previews);
                res.json({ success: true });
        } catch (err) {
                console.error("Error sending message to fan:", err.response ? err.response.data || err.response.statusText : err.message);
                const status = err.status || err.response?.status;
                const message = status === 429 ? 'OnlyFans API rate limit exceeded. Please try again later.' : (err.response ? err.response.statusText || err.response.data : err.message);
                res.status(status || 500).json({ success: false, error: message });
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
                console.error('Error scheduling message:', err);
                res.status(500).json({ success: false, error: err.message });
        }
});

app.get('/api/scheduledMessages', async (req, res) => {
        try {
                const dbRes = await pool.query("SELECT id, greeting, body, recipients, media_files, previews, price, locked_text, scheduled_at, status FROM scheduled_messages WHERE status='pending' ORDER BY scheduled_at");
                res.json({ messages: dbRes.rows });
        } catch (err) {
                console.error('Error fetching scheduled messages:', err);
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
                console.error('Error updating scheduled message:', err);
                res.status(500).json({ success: false, error: err.message });
        }
});

app.delete('/api/scheduledMessages/:id', async (req, res) => {
        try {
                await pool.query('UPDATE scheduled_messages SET status=$1 WHERE id=$2', ['canceled', req.params.id]);
                res.json({ success: true });
        } catch (err) {
                console.error('Error canceling scheduled message:', err);
                res.status(500).json({ success: false, error: err.message });
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
                // Ensure account id
                if (!OFAccountId) {
                        const accountsResp = await ofApiRequest(() => ofApi.get('/accounts'));
                        const accounts = accountsResp.data.accounts || accountsResp.data;
                        if (!accounts || accounts.length === 0) {
                                return res.status(400).json({ error: 'No OnlyFans account available.' });
                        }
                        OFAccountId = accounts[0].id;
                }
                const resp = await ofApiRequest(() => ofApi.get(`/${OFAccountId}/chats/${fanId}/messages`, { params: { limit } }));
                const raw = resp.data?.messages || resp.data?.list || resp.data?.data?.messages || resp.data?.data?.list || [];
                const messages = Array.isArray(raw) ? raw : [];
                for (const m of messages) {
                        const msgId = m.id;
                        const direction = (m.fromUser?.id || m.user?.id || m.senderId) === OFAccountId ? 'outgoing' : 'incoming';
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
                console.error("Error in GET /api/fans:", err);
                res.status(500).send("Failed to retrieve fans.");
        }
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
        const requiredEnv = ['ONLYFANS_API_KEY', 'OPENAI_API_KEY', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT'];
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
                const openai = new OpenAIApi(
                        new Configuration({ apiKey: process.env.OPENAI_API_KEY }),
                        undefined,
                        openaiAxios
                );
                await openai.listModels();
                status.openai.ok = true;
        } catch (err) {
                status.openai.ok = false;
                status.openai.error = err.response ? err.response.statusText || err.response.data : err.message;
        }
        res.json(status);
});

async function processScheduledMessages() {
        try {
                const dbRes = await pool.query("SELECT * FROM scheduled_messages WHERE status='pending' AND scheduled_at <= NOW()");
                for (const row of dbRes.rows) {
                        const recipients = Array.isArray(row.recipients) ? row.recipients : [];
                        for (const fanId of recipients) {
                                try {
                                        await sendPersonalizedMessage(fanId, row.greeting || '', row.body || '', row.price, row.locked_text, row.media_files || [], row.previews || []);
                                } catch (err) {
                                        console.error(`Error sending scheduled message ${row.id} to ${fanId}:`, err.message);
                                }
                        }
                        await pool.query('UPDATE scheduled_messages SET status=$1 WHERE id=$2', ['sent', row.id]);
                }
        } catch (err) {
                console.error('Error processing scheduled messages:', err);
        }
}

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Start the server only if this file is executed directly (not required by tests)
const port = process.env.PORT || 3000;
if (require.main === module) {
        app.listen(port, () => {
                console.log(`OFEM server listening on http://localhost:${port}`);
        });
        setInterval(processScheduledMessages, 60000);
        processScheduledMessages();
}

// Export app for testing
module.exports = app;

/* End of File – Last modified 2025-08-02 */
