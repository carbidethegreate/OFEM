const express = require('express');
const multer = require('multer');
const FormData = require('form-data');

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

  router.get('/vault-media', async (req, res) => {
    try {
      const accountId = await getOFAccountId();
      const media = [];
      const limit = 100;
      let offset = 0;
      while (true) {
        const resp = await ofApiRequest(() =>
          ofApi.get(`/${accountId}/media/vault`, {
            params: { limit, offset },
          }),
        );
        const items =
          resp.data?.media || resp.data?.list || resp.data?.data || resp.data;
        if (!Array.isArray(items) || items.length === 0) break;
        media.push(...items);
        offset += limit;
      }

      for (const m of media) {
        const id = m.id;
        const likes = m.likes ?? m.likesCount ?? null;
        const tips = m.tips ?? null;
        const thumb =
          m.thumb_url ||
          m.thumbUrl ||
          m.thumb?.url ||
          m.thumb?.src ||
          null;
        const preview =
        m.preview_url ||
        m.previewUrl ||
        m.preview?.url ||
        m.preview?.src ||
        null;
        const createdRaw =
          m.created_at || m.createdAt || m.time || m.postedAt || null;
        let created = null;
        if (createdRaw != null) {
          created = new Date(
            typeof createdRaw === 'number' ? createdRaw * 1000 : createdRaw,
          );
        }
        await pool.query(
          'INSERT INTO vault_media (id, likes, tips, thumb_url, preview_url, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET likes=EXCLUDED.likes, tips=EXCLUDED.tips, thumb_url=EXCLUDED.thumb_url, preview_url=EXCLUDED.preview_url, created_at=EXCLUDED.created_at',
          [id, likes, tips, thumb, preview, created],
        );
      }

      const dbRes = await pool.query(
        'SELECT id, likes, tips, thumb_url, preview_url, created_at FROM vault_media ORDER BY id',
      );
      res.json(dbRes.rows);
    } catch (err) {
      console.error('Error fetching vault media:', sanitizeError(err));
      const status = err.message.includes('OnlyFans account') ? 400 : 500;
      res.status(status).json({
        error: status === 400 ? err.message : 'Failed to fetch vault media',
      });
    }
  });

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
      const mediaFiles = Array.isArray(req.body.mediaFiles)
        ? req.body.mediaFiles
        : [];
      const previews = Array.isArray(req.body.previews)
        ? req.body.previews
        : [];
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

  // Retrieve message history for a fan
  router.get('/messages/history', async (req, res) => {
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
