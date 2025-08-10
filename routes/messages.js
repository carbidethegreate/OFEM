const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const sanitizeMediaIds = require('../sanitizeMediaIds');

module.exports = function ({
  getOFAccountId,
  ofApiRequest,
  ofApi,
  pool,
  sanitizeError,
  sendMessageToFan,
  getMissingEnvVars,
}) {
  const router = express.Router();
  const upload = multer();

  async function getActiveFans({ allowAllIfEmpty = true } = {}) {
    // Try multiple schemas, prefer explicit OnlyFans id if present
    const { rows } = await pool.query(`
      SELECT
        COALESCE(of_user_id, ofuserid, user_id, userid, id)::text AS recipient_id,
        username,
        COALESCE(active, is_active, subscribed, is_subscribed)::boolean AS active_flag
      FROM fans
      ORDER BY 1 ASC
    `);
    let list = rows
      .map((r) => r.recipient_id)
      .filter((v) => v && v !== 'null' && v !== '0');
    // If there is an explicit active flag, filter by it, otherwise keep all
    const hasActiveCol = rows.some(
      (r) => r.active_flag !== null && r.active_flag !== undefined,
    );
    if (hasActiveCol) {
      list = rows
        .filter((r) => r.active_flag)
        .map((r) => r.recipient_id)
        .filter(Boolean);
    }
    if ((!list || list.length === 0) && allowAllIfEmpty) {
      // Fallback to any id-like columns without requiring active
      const { rows: anyRows } = await pool.query(`
        SELECT COALESCE(of_user_id, ofuserid, user_id, userid, id)::text AS recipient_id
        FROM fans
        WHERE COALESCE(of_user_id, ofuserid, user_id, userid, id) IS NOT NULL
      `);
      list = anyRows.map((r) => r.recipient_id).filter(Boolean);
    }
    return list;
  }

  router.post('/vault-media', upload.array('media'), async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }
      const accountId = await getOFAccountId();
      const ids = [];
      for (const file of req.files) {
        const form = new FormData();
        form.append('media', file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });
        const resp = await ofApiRequest(() =>
          ofApi.post(`/${accountId}/media/upload`, form, {
            headers: form.getHeaders(),
          }),
        );
        const id =
          resp.data?.media?.id ||
          resp.data?.id ||
          resp.data?.mediaId ||
          resp.data?.media_id;
        if (id != null) ids.push(id);
      }
      res.json({ mediaIds: ids });
    } catch (err) {
      console.error('Error uploading vault media:', sanitizeError(err));
      const status = err.message.includes('OnlyFans account') ? 400 : 500;
      res.status(status).json({
        error: status === 400 ? err.message : 'Failed to upload vault media',
      });
    }
  });

  router.post('/vault-media/scrape', async (req, res) => {
    try {
      const url = req.body?.url;
      if (typeof url !== 'string' || !url.trim()) {
        return res.status(400).json({ error: 'url required' });
      }
      const accountId = await getOFAccountId();
      const resp = await ofApiRequest(() =>
        ofApi.post(`/${accountId}/media/scrape`, { url }),
      );
      const id =
        resp.data?.media?.id ||
        resp.data?.id ||
        resp.data?.mediaId ||
        resp.data?.media_id;
      if (id != null) {
        await pool.query(
          'INSERT INTO vault_media (id) VALUES ($1) ON CONFLICT DO NOTHING',
          [id],
        );
      }
      res.json({ mediaId: id });
    } catch (err) {
      console.error('Error scraping vault media:', sanitizeError(err));
      const status = err.message.includes('OnlyFans account') ? 400 : 500;
      res.status(status).json({
        error: status === 400 ? err.message : 'Failed to scrape vault media',
      });
    }
  });

  /* Story 2: Send Personalized DM to All Fans */
  router.post('/sendMessage', async (req, res) => {
    const missing = getMissingEnvVars();
    if (missing.length) {
      return res.status(400).json({
        error: `Missing environment variable(s): ${missing.join(', ')}`,
      });
    }
    try {
      const fanId = req.body.userId;
      const greeting = req.body.greeting || '';
      const body = req.body.body || '';

      // Normalize IDs and remove duplicates/overlaps
      let mediaFiles = sanitizeMediaIds(req.body.mediaFiles);
      let previews = sanitizeMediaIds(req.body.previews);
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

      // Locked text string (paywalled message)
      const lockedText =
        typeof req.body.lockedText === 'string' ? req.body.lockedText : '';

      // Parse price; default to 0 if NaN or neither media nor locked text
      let price = parseFloat(req.body.price);
      if (isNaN(price) || (mediaFiles.length === 0 && !lockedText)) price = 0;

      await sendMessageToFan(
        fanId,
        greeting,
        body,
        price,
        lockedText,
        mediaFiles,
        previews,
      );
      res.json({ success: true });
    } catch (err) {
      if (err.code === 'FAN_NOT_ELIGIBLE') {
        return res.status(400).json({ error: err.message });
      }
      const ofError = err.onlyfans_response?.body?.error;
      console.error(
        'Error sending message to fan:',
        err.response
          ? err.response.data || err.response.statusText
          : err.message,
        ofError || '',
      );
      const status = err.status || err.response?.status;
      let message =
        status === 429
          ? 'OnlyFans API rate limit exceeded. Please try again later.'
          : err.response
            ? err.response.statusText || err.response.data
            : err.message;
      if (ofError) message += ` (OnlyFans error: ${ofError})`;
      res.status(status || 500).json({ error: message });
    }
  });

  router.post('/scheduleMessage', async (req, res) => {
    try {
      const greeting = req.body.greeting || '';
      const body = req.body.body || '';
      const recipients = Array.isArray(req.body.recipients)
        ? req.body.recipients
        : [];
      const scheduledTime = req.body.scheduledTime;
      const price = req.body.price;
      const lockedText = req.body.lockedText;
      const mediaFiles = sanitizeMediaIds(req.body.mediaFiles);
      const previews = sanitizeMediaIds(req.body.previews);
      if (recipients.length === 0 || (!greeting && !body) || !scheduledTime) {
        return res
          .status(400)
          .json({ error: 'Missing recipients, message, or scheduledTime.' });
      }
      const scheduledAt = new Date(scheduledTime);
      if (isNaN(scheduledAt)) {
        return res.status(400).json({ error: 'Invalid scheduledTime.' });
      }
      await pool.query(
        'INSERT INTO scheduled_messages (greeting, body, recipients, media_files, previews, price, locked_text, scheduled_at, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          greeting,
          body,
          recipients,
          mediaFiles,
          previews,
          price ?? null,
          lockedText || null,
          scheduledAt,
          'pending',
        ],
      );
      res.json({ success: true });
    } catch (err) {
      console.error('Error scheduling message:', sanitizeError(err));
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/scheduledMessages', async (req, res) => {
    try {
      const dbRes = await pool.query(
        "SELECT id, greeting, body, recipients, media_files, previews, price, locked_text, scheduled_at, status FROM scheduled_messages WHERE status='pending' ORDER BY scheduled_at",
      );
      res.json({ messages: dbRes.rows });
    } catch (err) {
      console.error('Error fetching scheduled messages:', sanitizeError(err));
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/scheduledMessages/:id', async (req, res) => {
    try {
      const fields = [];
      const values = [];
      let idx = 1;
      if (req.body.greeting !== undefined) {
        fields.push(`greeting=$${idx++}`);
        values.push(req.body.greeting);
      }
      if (req.body.body !== undefined) {
        fields.push(`body=$${idx++}`);
        values.push(req.body.body);
      }
      if (req.body.price !== undefined) {
        fields.push(`price=$${idx++}`);
        values.push(req.body.price);
      }
      if (req.body.lockedText !== undefined) {
        fields.push(`locked_text=$${idx++}`);
        values.push(req.body.lockedText);
      }
      if (req.body.scheduledTime) {
        const newDate = new Date(req.body.scheduledTime);
        if (isNaN(newDate))
          return res.status(400).json({ error: 'Invalid scheduledTime.' });
        fields.push(`scheduled_at=$${idx++}`);
        values.push(newDate);
      }
      if (!fields.length) {
        return res.status(400).json({ error: 'No valid fields to update.' });
      }
      values.push(req.params.id);
      await pool.query(
        `UPDATE scheduled_messages SET ${fields.join(', ')} WHERE id=$${idx}`,
        values,
      );
      res.json({ success: true });
    } catch (err) {
      console.error('Error updating scheduled message:', sanitizeError(err));
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/scheduledMessages/:id', async (req, res) => {
    try {
      await pool.query('UPDATE scheduled_messages SET status=$1 WHERE id=$2', [
        'canceled',
        req.params.id,
      ]);
      res.json({ success: true });
    } catch (err) {
      console.error('Error canceling scheduled message:', sanitizeError(err));
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/messages/send', async (req, res) => {
    const missing = getMissingEnvVars();
    if (missing.length) {
      return res.status(400).json({
        error: `Missing environment variable(s): ${missing.join(', ')}`,
      });
    }
    try {
      const { text, price, lockedText, mediaIds, scope, recipients } =
        req.body || {};
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
      }

      let targets = Array.isArray(recipients) ? recipients.filter(Boolean) : [];
      if (targets.length === 0) {
        // Respect scope, default to all when not provided
        const wantAll = scope === 'allActiveFans' || !scope;
        if (wantAll) {
          targets = await getActiveFans({ allowAllIfEmpty: true });
        }
      }
      if (!targets.length) {
        return res.status(400).json({ error: 'no recipients resolved' });
      }

      targets = targets
        .map((t) => (typeof t === 'string' ? parseInt(t, 10) : t))
        .filter((v) => Number.isFinite(v));

      const limit = Number(process.env.SEND_CONCURRENCY || 3);
      const queue = [...targets];
      let sent = 0;
      const errors = [];

      async function worker() {
        while (queue.length) {
          const fanId = queue.shift();
          try {
            await sendMessageToFan(
              fanId,
              '',
              text,
              typeof price === 'number' ? price : parseFloat(price) || 0,
              typeof lockedText === 'string' ? lockedText : '',
              Array.isArray(mediaIds) ? mediaIds : [],
              [],
            );
            sent++;
          } catch (e) {
            errors.push({
              recipientId: fanId,
              message: sanitizeError(e).message || 'send failed',
            });
          }
        }
      }

      await Promise.all(Array.from({ length: limit }, worker));

      res.json({ queued: targets.length, sent, failed: errors.length, errors });
    } catch (err) {
      console.error('Error sending messages:', sanitizeError(err));
      res.status(500).json({ error: 'failed to send messages' });
    }
  });

  router.post('/schedule', async (req, res) => {
    try {
      const { text, price, mediaIds, scheduleAt, scope, recipients } = req.body || {};
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
      }
      if (!scheduleAt) {
        return res.status(400).json({ error: 'scheduleAt is required' });
      }
      let targets = Array.isArray(recipients) ? recipients.filter(Boolean) : [];
      if (targets.length === 0) {
        const wantAll = scope === 'allActiveFans' || !scope;
        if (wantAll) {
          targets = await getActiveFans({ allowAllIfEmpty: true });
        }
      }
      if (!targets.length) {
        return res.status(400).json({ error: 'no recipients resolved' });
      }
      targets = targets
        .map((t) => (typeof t === 'string' ? parseInt(t, 10) : t))
        .filter((v) => Number.isFinite(v));
      const { rows } = await pool.query(
        `INSERT INTO scheduled_messages (greeting, body, recipients, media_files, previews, price, locked_text, scheduled_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          '',
          text,
          targets,
          Array.isArray(mediaIds) ? mediaIds : [],
          [],
          price ?? null,
          null,
          new Date(scheduleAt),
          'pending',
        ],
      );
      res.json({ scheduled: true, id: rows[0].id, recipients: targets.length });
    } catch (err) {
      console.error('Error scheduling messages:', sanitizeError(err));
      res.status(500).json({ error: 'failed to schedule messages' });
    }
  });

  // Retrieve message history for a fan
  router.get('/messages/history', async (req, res) => {
    try {
      const fanId = req.query.fanId;
      let limit = parseInt(req.query.limit, 10);
      if (!fanId) {
        return res.status(400).json({ error: 'fanId required' });
      }
      if (!Number.isFinite(limit) || limit <= 0) limit = 20;
      if (limit > 100) limit = 100;
      let accountId;
      try {
        accountId = await getOFAccountId();
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const resp = await ofApiRequest(() =>
        ofApi.get(`/${accountId}/chats/${fanId}/messages`, {
          params: { limit },
        }),
      );
      const raw =
        resp.data?.messages ||
        resp.data?.list ||
        resp.data?.data?.messages ||
        resp.data?.data?.list ||
        [];
      const messages = Array.isArray(raw) ? raw : [];
      for (const m of messages) {
        const msgId = m.id;
        const direction =
          (m.fromUser?.id || m.user?.id || m.senderId) === accountId
            ? 'outgoing'
            : 'incoming';
        const body = m.text || m.body || '';
        const price = m.price ?? null;
        const created = new Date(
          (m.createdAt || m.created_at || m.postedAt || m.time || 0) * 1000,
        );
        await pool.query(
          'INSERT INTO messages (id, fan_id, direction, body, price, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET fan_id=EXCLUDED.fan_id, direction=EXCLUDED.direction, body=EXCLUDED.body, price=EXCLUDED.price, created_at=EXCLUDED.created_at',
          [msgId, fanId, direction, body, price, created],
        );
        m.direction = direction;
      }
      res.json({ messages });
    } catch (err) {
      console.error(
        'Error fetching message history:',
        err.response
          ? err.response.data || err.response.statusText
          : err.message,
      );
      const status = err.status || err.response?.status;
      const message =
        status === 429
          ? 'OnlyFans API rate limit exceeded. Please try again later.'
          : err.response
            ? err.response.statusText || err.response.data
            : err.message;
      res.status(status || 500).json({ error: message });
    }
  });

  return router;
};
