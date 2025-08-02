// server.js content will be filled in next step/* OnlyFans Express Messenger (OFEM)
File: server.js
Purpose: Express server for OFEM (OnlyFans integration and ChatGPT usage)
Created: 2025-08-02 – v1.0
*/

const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const { Configuration, OpenAIApi } = require('openai');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(express.json());

// Database setup
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Ensure fans table exists
const initDb = async () => {
	await pool.query(`CREATE TABLE IF NOT EXISTS fans (
		id BIGINT PRIMARY KEY,
		username TEXT,
		name TEXT,
		parker_name TEXT,
		is_custom BOOLEAN DEFAULT FALSE
	)`);
	console.log("Database initialized (fans table ready).");
};

// OnlyFans API client (bearer auth)
const ofApi = axios.create({
	baseURL: 'https://app.onlyfansapi.com/api',
	headers: { 'Authorization': `Bearer ${process.env.ONLYFANS_API_KEY}` }
});
let OFAccountId = null;

/* Story 1: Update Fan Names – Fetch fans from OnlyFans and generate display names using GPT-4. */
app.post('/api/updateFans', async (req, res) => {
	try {
		// 1. Verify API key and get connected account ID
		const accountsResp = await ofApi.get('/accounts');
		const accounts = accountsResp.data.accounts || accountsResp.data;
		if (!accounts || accounts.length === 0) {
			return res.status(400).send("No OnlyFans account is connected to this API key.");
		}
		OFAccountId = accounts[0].id;
		console.log(`Using OnlyFans account: ${OFAccountId}`);
		
		// 2. Fetch all fans (active + expired subscribers)
		let allFans = [];
		let offset = 0;
		const limit = 50;
		while (true) {
			const fansResp = await ofApi.get(`/${OFAccountId}/fans`, { params: { limit, offset } });
			const fansPage = fansResp.data.fans || fansResp.data;
			if (!fansPage) break;
			allFans = allFans.concat(fansPage);
			if (fansPage.length < limit) break;
			offset += limit;
		}
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
			const accountsResp = await ofApi.get('/accounts');
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
			message = message.replace("{name}", parkerName).replace("[name]", parkerName);
		} else {
			message = `Hi ${parkerName || "there"}! ${message}`;
		}
		// TODO: If not already connected with this user and their profile is free, one could call a subscribe endpoint here.
		// Send message via OnlyFans API
		await ofApi.post(`/${OFAccountId}/chats/${fanId}/messages`, { text: message });
		console.log(`Sent message to ${fanId}: ${message.substring(0, 30)}...`);
		res.json({ success: true });
	} catch (err) {
		console.error("Error sending message to fan:", err.response ? err.response.data || err.response.statusText : err.message);
		// Even if message sending fails (e.g., user not reachable), we don't throw, just return success false.
		res.json({ success: false, error: err.response ? err.response.statusText || err.response.data : err.message });
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

// Serve frontend static files
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// Start the server after initializing DB
initDb().then(() => {
	const port = process.env.PORT || 3000;
	app.listen(port, () => {
		console.log(`OFEM server listening on http://localhost:${port}`);
	});
}).catch(err => {
	console.error("Failed to start server:", err);
});

/* End of File – Last modified 2025-08-02 */