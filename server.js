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
async function ofApiRequest(fn, maxRetries = 5) {
        let attempt = 0;
        let delay = 1000; // start with 1s
        while (true) {
                try {
                        return await fn();
                } catch (err) {
                        const status = err.response?.status;
                        if (status === 429 && attempt < maxRetries) {
                                const retryAfter = parseInt(err.response.headers['retry-after'], 10);
                                const wait = !isNaN(retryAfter) ? retryAfter * 1000 : delay;
                                await new Promise(r => setTimeout(r, wait));
                                attempt++;
                                delay *= 2;
                                continue;
                        }
                        if (status === 429) {
                                const rateErr = new Error('OnlyFans API rate limit exceeded');
                                rateErr.status = 429;
                                throw rateErr;
                        }
                        throw err;
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
                const limit = 50;
                const fetchFans = async (type) => {
                        const results = [];
                        let offset = 0;
                        while (true) {
                                const resp = await ofApiRequest(() => ofApi.get(`/${OFAccountId}/fans/${type}`, { params: { limit, offset } }));
                                const page = resp.data?.data?.list || resp.data?.list || resp.data;
                                if (!page || page.length === 0) break;
                                results.push(...page);
                                if (page.length < limit) break;
                                offset += limit;
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
		const systemPrompt = 
		"You are Parker’s conversational assistant. Each time a subscriber sends you a message, first determine how to address them by applying these rules to their username/handle:\\n" +
		"1. If they’ve chosen a custom handle (letters or words, no 'u'+numbers), shorten it to its first letter plus '...'. For example, 'JazzFan99' -> 'J...'.\\n" +
		"2. If it’s a default handle ('u' followed by digits), replace it with 'Cuddles'. For example, 'u12345678' -> 'Cuddles'.\\n" +
		"3. If the handle is 'u'+digits followed by letters (e.g. 'u2468markxyz'), extract the first real name part after the digits and capitalize it. For example, 'u2468markxyz' -> 'Mark'.\\n" +
		"4. If the handle is one concatenated name (camelCase or all lower/upper, no spaces), split it into words and use the first part. For example, 'JohnSmith' -> 'John'.\\n" +
		"5. If the profile name already appears as 'First Last', just use the first name (e.g. 'Alice Johnson' -> 'Alice').\\n" +
		"Once you’ve decided on the display name, provide just that name and nothing else. Never use the word 'baby' as a name.";
		
		// 5. Update/insert each fan in database with ParkerGivenName
		const updatedFans = [];
		for (const fan of allFans) {
			const fanId = fan.id.toString();
			const username = fan.username || "";
			const profileName = fan.name || "";
			let parkerName = existingFans[fanId] ? existingFans[fanId].parker_name : null;
			const isCustom = existingFans[fanId] ? existingFans[fanId].is_custom : false;
			
			// Generate ParkerGivenName if not set yet and not manually overridden
			if ((!parkerName || parkerName === "") && !isCustom) {
				const userPrompt = `Subscriber username: "${username}". Profile name: "${profileName}". What should be the display name?`;
				const completion = await openai.createChatCompletion({
					model: "gpt-4",
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: userPrompt }
					],
					max_tokens: 10,
					temperature: 0.3
				});
				parkerName = completion.data.choices[0].message.content.trim();
				console.log(`GPT-4 name for ${username}: ${parkerName}`);
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
				parker_name: parkerName || existingFans[fanId]?.parker_name || ""
			});
		}
		
		console.log("UpdateFans: Completed updating fan names.");
		res.json({ fans: updatedFans });
        } catch (err) {
                console.error("Error in /api/updateFans:", err);
                if (err.status === 429) {
                        return res.status(429).send('OnlyFans API rate limit exceeded. Please try again later.');
                }
                res.status(500).send(err.message || "Failed to update fan names.");
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
