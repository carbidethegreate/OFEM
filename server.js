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
        headers: { 'Authorization': `Bearer ${process.env.ONLYFANS_API_KEY}` }
});
let OFAccountId = null;
// Wrapper to handle OnlyFans API rate limiting with retries
async function ofApiRequest(requestFn, maxRetries = 5) {
        let delay = 1000; // start with 1s
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                        return await requestFn();
                } catch (err) {
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
// Escape HTML entities to prevent HTML injection in user-supplied text
function escapeHtml(unsafe = "") {
        return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
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


/* Story 1: Update Fan Names – Fetch fans from OnlyFans and generate display names using GPT-4. */
app.post('/api/updateFans', async (req, res) => {
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
                        while (true) {
                                const resp = await ofApiRequest(() => ofApi.get(`/${OFAccountId}/fans/${type}`, { params: { limit, offset } }));
                                const page = resp.data?.data?.list || resp.data?.list || resp.data;
                                if (!page || page.length === 0) break;
                                results.push(...page);
                                offset += page.length;
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
		const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));
                const systemPrompt = `You are Parker’s conversational assistant. Decide how to address a subscriber by evaluating their username and profile name.

1. If the profile name contains a plausible real first name, use its first word.
2. Otherwise derive the name from the username: split camelCase or underscores, remove digits, and use the first resulting word.
3. Return "Cuddles" only when both the username and profile name look system generated (e.g. username is 'u' followed by digits or purely numeric and the profile name is blank or numeric).
4. Do not use abbreviations, initials, or ellipses. Provide a single fully spelled name with the first letter capitalized.

Respond with only the chosen name.`;
		
                // 5. Update/insert each fan in database with ParkerGivenName
                // Send progress updates to the client using Server-Sent Events
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.flushHeaders();

                const totalFans = allFans.length;
                let processed = 0;
                const sendProgress = () => {
                        res.write(`event: progress\\ndata: ${JSON.stringify({ processed, total: totalFans })}\\n\\n`);
                };

                const BATCH_SIZE = 5; // limit concurrent OpenAI requests
                const updatedFans = [];
                sendProgress();

                const processFan = async (fan) => {
                        const fanId = fan.id.toString();
                        const username = fan.username || "";
                        const profileName = fan.name || "";
                        let parkerName = existingFans[fanId] ? existingFans[fanId].parker_name : null;
                        let isCustom = existingFans[fanId] ? existingFans[fanId].is_custom : false;

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
                                        'UPDATE fans SET username=$2, name=$3, parker_name=$4, is_custom=$5 WHERE id=$1',
                                        [fanId, username, profileName, parkerName || existingFans[fanId].parker_name, isCustom]
                                );
                        } else {
                                await pool.query(
                                        'INSERT INTO fans (id, username, name, parker_name, is_custom) VALUES ($1, $2, $3, $4, $5)',
                                        [fanId, username, profileName, parkerName || null, false]
                                );
                        }
                        updatedFans.push({
                                id: fanId,
                                username: username,
                                name: profileName,
                                parker_name: parkerName || existingFans[fanId]?.parker_name || "",
                        });
                        processed++;
                        sendProgress();
                };

                for (let i = 0; i < allFans.length; i += BATCH_SIZE) {
                        const batch = allFans.slice(i, i + BATCH_SIZE);
                        await Promise.all(batch.map(processFan));
                }

                console.log("UpdateFans: Completed updating fan names.");
                res.write(`event: complete\\ndata: ${JSON.stringify({ fans: updatedFans })}\\n\\n`);
                res.end();
        } catch (err) {
                console.error("Error in /api/updateFans:", err);
                const status = err.status || 500;
                const message = status === 429 ? 'OnlyFans API rate limit exceeded. Please try again later.' : (err.message || 'Failed to update fan names.');
                if (res.headersSent) {
                        res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
                        res.end();
                } else {
                        res.status(status).send(message);
                }
        }
});

/* Allow manual editing of ParkerGivenName in the database */
app.put('/api/fans/:id', async (req, res) => {
	try {
		const fanId = req.params.id;
		const newName = req.body.parker_name;
		if (!fanId || !newName) {
			return res.status(400).send("Missing fan id or name.");
		}
		await pool.query(
			'UPDATE fans SET parker_name=$1, is_custom=$2 WHERE id=$3',
			[ newName, true, fanId ]
		);
		console.log(`User manually set ParkerName for fan ${fanId} -> "${newName}"`);
		res.json({ success: true });
	} catch (err) {
		console.error("Error in /api/fans/:id PUT:", err);
		res.status(500).send("Failed to update name.");
	}
});

/* Story 2: Send Personalized DM to All Fans */
app.post('/api/sendMessage', async (req, res) => {
	try {
		const fanId = req.body.userId;
		let message = req.body.message;
		if (!fanId || !message) {
			return res.status(400).send("Missing userId or message.");
		}
		// Ensure we have OnlyFans account ID (if updateFans not run, fetch now as fallback)
                  if (!OFAccountId) {
                          const accountsResp = await ofApiRequest(() => ofApi.get('/accounts'));
                          const accounts = accountsResp.data.accounts || accountsResp.data;
			if (!accounts || accounts.length === 0) {
				return res.status(400).send("No OnlyFans account available.");
			}
			OFAccountId = accounts[0].id;
		}
		// Get ParkerGivenName for personalization
		const dbRes = await pool.query('SELECT parker_name FROM fans WHERE id=$1', [fanId]);
		const parkerName = dbRes.rows.length ? dbRes.rows[0].parker_name : "";
                // Personalize message with name
                if (message.includes("{name}") || message.includes("[name]")) {
                        message = message.replace(/\{name\}|\[name\]/g, parkerName);
                } else {
                        message = `Hi ${parkerName || "there"}! ${message}`;
                }
		// TODO: If not already connected with this user and their profile is free, one could call a subscribe endpoint here.
		// Send message via OnlyFans API
		const formatted = `<p>${escapeHtml(message)}</p>`;
                  await ofApiRequest(() => ofApi.post(`/${OFAccountId}/chats/${fanId}/messages`, { text: formatted }));
		console.log(`Sent message to ${fanId}: ${message.substring(0, 30)}...`);
		res.json({ success: true });
          } catch (err) {
                  console.error("Error sending message to fan:", err.response ? err.response.data || err.response.statusText : err.message);
                  const status = err.status || err.response?.status;
                  const message = status === 429 ? 'OnlyFans API rate limit exceeded. Please try again later.' : (err.response ? err.response.statusText || err.response.data : err.message);
                  res.status(status || 500).json({ success: false, error: message });
          }
  });

// Endpoint to get all fans from DB (for initial page load if needed)
app.get('/api/fans', async (req, res) => {
        try {
                const dbRes = await pool.query('SELECT id, username, name, parker_name FROM fans ORDER BY id');
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
                const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));
                await openai.listModels();
                status.openai.ok = true;
        } catch (err) {
                status.openai.ok = false;
                status.openai.error = err.response ? err.response.statusText || err.response.data : err.message;
        }
        res.json(status);
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
        console.log(`OFEM server listening on http://localhost:${port}`);
});

/* End of File – Last modified 2025-08-02 */
