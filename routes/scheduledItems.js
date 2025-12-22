const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const { createScheduledItemLogger } = require('../utils/scheduledItemLogs');
const { sanitizeError } = require('../sanitizeError');

module.exports = function ({
  pool,
  sanitizeError: sanitizeErrorFromServer,
  getMissingEnvVars,
  getOFAccountId,
  ofApiRequest,
  ofApi,
  OF_FETCH_LIMIT = 1000,
  hasScheduledItemsTables = () => true,
  useV1MediaUpload = process.env.OF_USE_V1_MEDIA_UPLOAD === 'true',
}) {
  const router = express.Router();
  router.use(express.json({ limit: '10mb' }));

  const sanitizeErrorFn = sanitizeErrorFromServer || sanitizeError;
  const { appendLog, fetchLogs } = createScheduledItemLogger({
    pool,
    sanitizeError: sanitizeErrorFn,
  });

  function normalizeMode(mode) {
    if (!mode) return 'both';
    const normalized = String(mode).toLowerCase();
    return ['post', 'message', 'both'].includes(normalized) ? normalized : 'both';
  }

  function normalizeQueueStatus(status) {
    if (!status) return null;
    const normalized = String(status).toLowerCase();
    const allowed = ['queued', 'sent', 'ready', 'draft', 'scheduled'];
    return allowed.includes(normalized) ? normalized : status;
  }

  function coalesceId(...candidates) {
    for (const c of candidates) {
      const num = typeof c === 'string' ? parseInt(c, 10) : c;
      if (num != null && !Number.isNaN(num) && num !== 0) return num;
    }
    return null;
  }

  function ensureTablesAvailable(res) {
    if (hasScheduledItemsTables()) return true;
    res.status(503).json({
      error:
        'scheduled_items/scheduled_item_logs tables missing; run migrations to enable scheduled queueing',
    });
    return false;
  }

  function ensureOnlyfansEnv(res) {
    const missing = getMissingEnvVars([
      'ONLYFANS_API_KEY',
      'ONLYFANS_ACCOUNT_ID',
    ]);
    if (missing.length) {
      res.status(400).json({
        error: `Missing environment variable(s): ${missing.join(', ')}`,
      });
      return false;
    }
    return true;
  }

  function parseDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatItem(row) {
    if (!row) return null;
    const scheduleSource = row.scheduled_at_utc || row.schedule_time;
    const scheduleIso = scheduleSource
      ? new Date(scheduleSource).toISOString()
      : null;
    return {
      id: row.id,
      source_filename: row.source_filename,
      media_url: row.media_url,
      caption: row.caption,
      message_body: row.message_body,
      schedule_time: scheduleIso,
      scheduled_at_utc: scheduleIso,
      timezone: row.timezone,
      mode: normalizeMode(row.mode),
      both_disabled: Boolean(row.both_disabled),
      status: row.status,
      upload_strategy_note: row.upload_strategy_note,
      of_media_id_post: row.of_media_id_post,
      of_media_id_message: row.of_media_id_message,
      of_queue_id_post: row.of_queue_id_post,
      of_message_batch_id: row.of_message_batch_id,
      of_message_job_id: row.of_message_job_id,
      message_batch_id: row.of_message_batch_id,
      post_status: row.post_status,
      message_status: row.message_status,
      last_error: row.last_error,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  function normalizeAccountId(accountId) {
    const raw = typeof accountId === 'string' ? accountId.trim() : '';
    if (!raw) throw new Error('OnlyFans account ID is missing for upload');
    const trimmed = raw.replace(/^\/+|\/+$/g, '');
    const firstSegment = trimmed.split('/').filter(Boolean)[0];
    if (!firstSegment) throw new Error('OnlyFans account ID is invalid for upload');
    if (firstSegment !== trimmed) {
      console.warn('Normalizing OnlyFans account ID for upload', {
        accountId,
        normalized: firstSegment,
      });
    }
    return firstSegment;
  }

  function resolveUploadTarget(accountId) {
    const normalizedAccountId = normalizeAccountId(accountId);
    if (useV1MediaUpload) {
      return {
        uploadUrl: '/v1/media/upload-media-to-the-only-fans-cdn',
        accountId: normalizedAccountId,
        useV1: true,
      };
    }
    const uploadUrl = `/${normalizedAccountId}/media/upload`;
    if (!/^\/[^/]+\/media\/upload$/.test(uploadUrl)) {
      throw new Error(`Resolved upload URL is invalid: ${uploadUrl}`);
    }
    return {
      uploadUrl,
      accountId: normalizedAccountId,
      useV1: false,
    };
  }

  function pickFilename(preferred, fallbackBase) {
    const safePreferred =
      typeof preferred === 'string' && preferred.trim()
        ? preferred.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '')
        : null;
    if (safePreferred) return safePreferred;
    const rand = Math.random().toString(36).slice(2, 8);
    return `${fallbackBase || 'upload'}-${rand}.jpg`;
  }

  async function downloadMediaFile(url, filenameHint) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const contentType =
      response.headers['content-type'] || 'application/octet-stream';
    const filename = pickFilename(filenameHint, 'scheduled-upload');
    return {
      buffer: Buffer.from(response.data),
      contentType,
      filename,
    };
  }

  async function logStep(itemId, step, phase, message, meta) {
    const level = phase === 'error' ? 'error' : 'info';
    await appendLog({
      itemId,
      step,
      phase,
      level,
      message,
      meta,
    });
  }

  async function uploadSingleUseMedia({
    imageUrl,
    filenameHint,
    destination,
    itemId,
  }) {
    await logStep(itemId, 'upload_media', 'start', 'Starting media upload', {
      destination,
      filename: filenameHint,
    });
    if (!imageUrl) {
      const err = new Error('Missing media_url for upload');
      await logStep(itemId, 'upload_media', 'error', err.message, {
        destination,
      });
      throw err;
    }
    try {
      const { buffer, contentType, filename } = await downloadMediaFile(
        imageUrl,
        filenameHint,
      );
      const form = new FormData();
      form.append('file', buffer, { filename, contentType });
      const accountId = await getOFAccountId();
      const uploadTarget = resolveUploadTarget(accountId);
      await logStep(
        itemId,
        'upload_media',
        'info',
        'Resolved upload endpoint',
        {
          destination,
          filename,
          accountId: uploadTarget.accountId,
          uploadUrl: uploadTarget.uploadUrl,
          useV1Upload: uploadTarget.useV1,
        },
      );
      const resp = await ofApiRequest(() =>
        ofApi.post(uploadTarget.uploadUrl, form, {
          headers: form.getHeaders(),
        }),
      );
      const mediaId = coalesceId(
        resp.data?.prefixed_id,
        resp.data?.media_id,
        resp.data?.mediaId,
        resp.data?.id,
        resp.data?.media?.id,
        resp.data?.media?.media_id,
      );
      if (!mediaId) {
        throw new Error('Upload succeeded but media ID is missing');
      }
      await logStep(itemId, 'upload_media', 'end', 'Media uploaded', {
        destination,
        mediaId,
      });
      return { mediaId, raw: resp.data };
    } catch (err) {
      const sanitized = sanitizeErrorFn(err);
      await logStep(
        itemId,
        'upload_media',
        'error',
        sanitized?.message || err.message || 'Upload failed',
        sanitized,
      );
      throw err;
    }
  }

  function parseQueueResult(payload) {
    if (!payload || typeof payload !== 'object') return {};
    const layers = [payload, payload?.data, payload?.data?.queue, payload?.queue].filter(
      Boolean,
    );
    let queueId = null;
    let postId = null;
    let status = null;
    for (const layer of layers) {
      if (!layer || typeof layer !== 'object') continue;
      queueId =
        queueId ??
        coalesceId(
          layer.queue_id,
          layer.queueId,
          layer.queue_item_id,
          layer.queueItemId,
          layer.id,
        );
      postId =
        postId ??
        coalesceId(layer.post_id, layer.postId, layer.post?.id, layer?.id);
      status =
        status ??
        normalizeQueueStatus(
          layer.status || layer.queue_status || layer.queueStatus,
        );
    }
    return { queueId, postId, status };
  }

  async function publishQueueItem(itemId, queueId) {
    if (!queueId) return { queueId: null, status: null };
    const accountId = normalizeAccountId(await getOFAccountId());
    await logStep(itemId, 'publish_queue_item', 'start', 'Publishing queue item', {
      queueId,
    });
    const resp = await ofApiRequest(() =>
      ofApi.put(`/${accountId}/queue/${queueId}/publish`),
    );
    const parsed = parseQueueResult(resp?.data);
    await logStep(itemId, 'publish_queue_item', 'end', 'Queue item published', {
      queueId: parsed.queueId || queueId,
      status: parsed.status || 'queued',
    });
    return {
      queueId: parsed.queueId || queueId,
      status: parsed.status || 'queued',
    };
  }

  async function createPostQueueItem({ itemId, postMediaId, text, schedule }) {
    const accountId = normalizeAccountId(await getOFAccountId());
    const payload = {
      text: text || '',
      mediaIds: postMediaId ? [postMediaId] : [],
    };
    if (schedule) {
      payload.scheduledDate = schedule.toISOString();
    } else {
      payload.saveForLater = true;
    }

    await logStep(itemId, 'create_post_queue', 'start', 'Creating queued post', {
      schedule_time: schedule ? schedule.toISOString() : null,
    });
    const resp = await ofApiRequest(() =>
      ofApi.post(`/${accountId}/posts`, payload),
    );
    const parsed = parseQueueResult(resp?.data);
    if (!parsed.queueId) {
      throw new Error('Queue creation succeeded but queue ID is missing');
    }
    await logStep(itemId, 'create_post_queue', 'end', 'Post queued', {
      queueId: parsed.queueId,
      postId: parsed.postId,
      status: parsed.status || 'queued',
    });
    const publishResult = await publishQueueItem(itemId, parsed.queueId);
    return {
      queueId: publishResult.queueId || parsed.queueId,
      postId: parsed.postId,
      status: publishResult.status || parsed.status || 'queued',
    };
  }

  async function fetchActiveFollowings(limit = OF_FETCH_LIMIT) {
    const ids = new Set();
    const pageSize = Math.max(1, Math.min(50, limit));
    const accountId = await getOFAccountId();
    let offset = 0;
    while (ids.size < limit) {
      const resp = await ofApiRequest(() =>
        ofApi.get(`/${accountId}/following/active`, {
          params: { limit: pageSize, offset },
        }),
      );
      const payload = resp?.data || {};
      const data = payload.data || payload;
      const rows =
        data.list ||
        data.followings ||
        data.users ||
        payload.list ||
        payload.followings ||
        payload.users ||
        [];
      const list = Array.isArray(rows) ? rows : [];
      for (const u of list) {
        const id = coalesceId(u?.id, u?.user_id, u?.userId, u?.of_user_id);
        if (id != null) ids.add(Number(id));
        if (ids.size >= limit) break;
      }
      const total =
        data.count ??
        data.total ??
        data.totalCount ??
        payload.count ??
        payload.total ??
        payload.totalCount;
      const numericTotal = Number(total);
      const totalIsValid = Number.isFinite(numericTotal);
      const nextOffset = offset + list.length;
      const hasMoreFlag =
        data.hasMore ??
        data.has_more ??
        payload.hasMore ??
        payload.has_more ??
        (totalIsValid ? nextOffset < numericTotal : undefined) ??
        (payload._pagination?.next_page ? true : undefined);
      const hasMore =
        hasMoreFlag !== undefined
          ? hasMoreFlag
          : list.length > 0 && list.length >= pageSize;
      if (!hasMore || list.length === 0 || ids.size >= limit) break;
      offset = nextOffset;
    }
    return Array.from(ids).slice(0, limit);
  }

  async function sendMassMessage({
    itemId,
    messageMediaId,
    text,
    recipients,
  }) {
    const accountId = normalizeAccountId(await getOFAccountId());
    const payload = {
      recipientIds: recipients,
      mediaIds: messageMediaId ? [messageMediaId] : [],
      text: text || '',
    };
    await logStep(itemId, 'send_message', 'start', 'Submitting messages', {
      recipients: recipients.length,
      media_id: messageMediaId,
    });
    const resp = await ofApiRequest(() =>
      ofApi.post(`/${accountId}/messages`, payload),
    );
    const batchId = coalesceId(
      resp.data?.message_batch_id,
      resp.data?.messageBatchId,
      resp.data?.batchId,
      resp.data?.batch_id,
      resp.data?.data?.batch_id,
    );
    const jobId = coalesceId(
      resp.data?.jobId,
      resp.data?.job_id,
      resp.data?.data?.job_id,
    );
    const status =
      normalizeQueueStatus(
          resp.data?.status ||
            resp.data?.queueStatus ||
            resp.data?.queue_status ||
          resp.data?.data?.queue_status ||
          resp.data?.message_status ||
          resp.data?.messageStatus,
      ) || 'sent';
    await logStep(itemId, 'send_message', 'end', 'Messages submitted', {
      batchId,
      jobId,
      recipients: recipients.length,
      status,
    });
    return { batchId, jobId, status };
  }

  async function ensureMediaId({
    item,
    destination,
    existingId,
    otherId,
  }) {
    if (existingId && (!otherId || existingId !== otherId)) {
      return existingId;
    }
    const upload = await uploadSingleUseMedia({
      imageUrl: item.media_url,
      filenameHint: `${item.source_filename || 'scheduled'}-${destination}`,
      destination,
      itemId: item.id,
    });
    return upload.mediaId;
  }

  async function processSend(item) {
    const mode = normalizeMode(item.mode);
    let postMediaId = item.of_media_id_post || null;
    let messageMediaId = item.of_media_id_message || null;
    let postQueueId = item.of_queue_id_post || null;
    let postStatus = item.post_status || null;
    let messageStatus = item.message_status || null;
    let messageBatchId = item.of_message_batch_id || null;
    let messageJobId = item.of_message_job_id || null;
    const schedule = parseDate(item.scheduled_at_utc || item.schedule_time);
    const text = item.caption || item.message_body || '';

    try {
      await logStep(item.id, 'upload_media', 'info', 'Preparing media for send', {
        mode,
        upload_strategy: item.upload_strategy_note,
      });

      if (['post', 'both'].includes(mode)) {
        postMediaId = await ensureMediaId({
          item,
          destination: 'post',
          existingId: postMediaId,
          otherId: messageMediaId,
        });
      }
      if (['message', 'both'].includes(mode)) {
        messageMediaId = await ensureMediaId({
          item,
          destination: 'message',
          existingId: messageMediaId,
          otherId: postMediaId,
        });
      }

      if (['post', 'both'].includes(mode)) {
        const queueResult = await createPostQueueItem({
          itemId: item.id,
          postMediaId,
          text,
          schedule,
        });
        postQueueId = queueResult.queueId || postQueueId;
        postStatus = queueResult.status || postStatus || 'queued';
      }

      if (['message', 'both'].includes(mode)) {
        const recipients = await fetchActiveFollowings(OF_FETCH_LIMIT);
        await logStep(
          item.id,
          'list_active_followings',
          'end',
          `Found ${recipients.length} active followings`,
          { count: recipients.length, limit: OF_FETCH_LIMIT },
        );
        if (!recipients.length) {
          throw new Error('No active followings available for messaging');
        }
        const messageResult = await sendMassMessage({
          itemId: item.id,
          messageMediaId,
          text,
          recipients,
        });
        messageBatchId = messageResult.batchId || messageBatchId;
        messageJobId = messageResult.jobId || messageJobId;
        messageStatus = messageResult.status || messageStatus || 'sent';
      }

      const { rows } = await pool.query(
        `UPDATE scheduled_items
         SET status=$1,
             post_status=$2,
             message_status=$3,
             of_media_id_post=$4,
             of_media_id_message=$5,
             of_queue_id_post=$6,
             of_message_batch_id=$7,
             of_message_job_id=$8,
             last_error=NULL,
             updated_at=NOW()
         WHERE id=$9
         RETURNING *`,
        [
          'queued',
          postStatus,
          messageStatus,
          postMediaId,
          messageMediaId,
          postQueueId,
          messageBatchId,
          messageJobId,
          item.id,
        ],
      );
      await logStep(item.id, 'final_status', 'end', 'Send flow completed', {
        status: 'queued',
        post_queue_id: postQueueId,
        message_batch_id: messageBatchId,
      });
      return { status: 'queued', item: formatItem(rows[0]) };
    } catch (err) {
      const sanitized = sanitizeErrorFn(err);
      const { rows } = await pool.query(
        `UPDATE scheduled_items
         SET status='error',
             last_error=$1,
             of_media_id_post=$2,
             of_media_id_message=$3,
             of_queue_id_post=$4,
             of_message_batch_id=$5,
             of_message_job_id=$6,
             post_status=$7,
             message_status=$8,
             updated_at=NOW()
         WHERE id=$9
         RETURNING *`,
        [
          sanitized?.message || err.message || 'Send failed',
          postMediaId,
          messageMediaId,
          postQueueId,
          messageBatchId,
          messageJobId,
          postStatus,
          messageStatus,
          item.id,
        ],
      );
      await logStep(
        item.id,
        'final_status',
        'error',
        sanitized?.message || err.message || 'Send failed',
        sanitized,
      );
      return { status: 'error', error: sanitized?.message || err.message, item: formatItem(rows[0]) };
    }
  }

  router.post('/schedule-bulk', async (req, res) => {
    if (!ensureTablesAvailable(res)) return;
    const items = Array.isArray(req.body?.items)
      ? req.body.items
      : Array.isArray(req.body)
        ? req.body
        : [];
    if (!items.length) {
      return res.status(400).json({ error: 'items array is required' });
    }
    const strategy = typeof req.body?.uploadStrategy === 'string'
      ? req.body.uploadStrategy.toLowerCase()
      : '';
    const baseNote =
      strategy === 'optiona'
        ? 'Option A: pre-upload twice'
        : 'Option B: upload on send';
    try {
      const inserted = [];
      for (const rawItem of items) {
        const item = rawItem || {};
        const now = new Date();
        const scheduleTime =
          parseDate(
            item.scheduled_at_utc ||
              item.scheduledAtUtc ||
              item.schedule_time ||
              item.scheduleTime ||
              item.scheduledDate,
          ) ||
          null;
        const initialStatus =
          scheduleTime && scheduleTime.getTime() > now.getTime() ? 'scheduled' : 'ready';
        const { rows } = await pool.query(
          `INSERT INTO scheduled_items
             (source_filename, media_url, caption, message_body, schedule_time, scheduled_at_utc, timezone,
              mode, both_disabled, status, upload_strategy_note, of_media_id_post, of_media_id_message)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            item.source_filename || item.filename || item.name || null,
            item.media_url || item.image_url || item.imageUrl || null,
            item.caption || item.text || '',
            item.message_body || item.message || item.caption || '',
            scheduleTime,
            scheduleTime,
            item.timezone || null,
            normalizeMode(item.mode),
            Boolean(item.both_disabled),
            initialStatus,
            item.upload_strategy_note || baseNote,
            coalesceId(
              item.of_media_id_post,
              item.post_media_id,
              item.media_id_post,
            ),
            coalesceId(
              item.of_media_id_message,
              item.message_media_id,
              item.media_id_message,
            ),
          ],
        );
        const formatted = formatItem(rows[0]);
        await logStep(
          formatted.id,
          'upload_media',
          'info',
          'Scheduled item created',
          { upload_strategy_note: formatted.upload_strategy_note },
        );
        inserted.push(formatted);
      }
      res.json({ items: inserted });
    } catch (err) {
      console.error('Error scheduling bulk items:', sanitizeErrorFn(err));
      res.status(500).json({ error: 'Failed to schedule items' });
    }
  });

  router.get('/scheduled-items', async (req, res) => {
    if (!ensureTablesAvailable(res)) return;
    try {
      const { rows } = await pool.query(
        'SELECT * FROM scheduled_items ORDER BY created_at DESC',
      );
      res.json({ items: rows.map(formatItem) });
    } catch (err) {
      console.error('Error fetching scheduled items:', sanitizeErrorFn(err));
      res.status(500).json({ error: 'Failed to fetch scheduled items' });
    }
  });

  router.patch('/scheduled-items/:id/mode', async (req, res) => {
    if (!ensureTablesAvailable(res)) return;
    try {
      const currentRes = await pool.query(
        'SELECT * FROM scheduled_items WHERE id=$1',
        [req.params.id],
      );
      if (!currentRes.rows.length) {
        return res.status(404).json({ error: 'Item not found' });
      }
      const current = currentRes.rows[0];
      const scheduleProvided =
        Object.prototype.hasOwnProperty.call(req.body || {}, 'schedule_time') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'scheduled_at_utc');
      const scheduleTime = scheduleProvided
        ? parseDate(req.body?.scheduled_at_utc || req.body?.schedule_time) || null
        : current.scheduled_at_utc || current.schedule_time || null;
      const mode = req.body?.mode
        ? normalizeMode(req.body.mode)
        : normalizeMode(current.mode);
      const bothDisabled =
        req.body?.both_disabled != null
          ? req.body.both_disabled === true
          : Boolean(current.both_disabled);
      const timezoneProvided =
        Object.prototype.hasOwnProperty.call(req.body || {}, 'timezone');
      const timezone = timezoneProvided
        ? typeof req.body?.timezone === 'string' && req.body.timezone.trim()
          ? req.body.timezone.trim()
          : null
        : current.timezone || null;
      const { rows } = await pool.query(
        `UPDATE scheduled_items
         SET mode=$1,
             both_disabled=$2,
             schedule_time=$3,
             scheduled_at_utc=$3,
             timezone=$4,
             updated_at=NOW()
         WHERE id=$5
         RETURNING *`,
        [mode, bothDisabled, scheduleTime, timezone, req.params.id],
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'Item not found' });
      }
      await logStep(rows[0].id, 'upload_media', 'info', 'Mode updated', {
        mode,
        both_disabled: bothDisabled,
        schedule_time: scheduleTime,
        timezone,
      });
      res.json({ item: formatItem(rows[0]) });
    } catch (err) {
      console.error('Error updating scheduled item mode:', sanitizeErrorFn(err));
      res.status(500).json({ error: 'Failed to update mode' });
    }
  });

  router.post('/send-to-queue', async (req, res) => {
    if (!ensureTablesAvailable(res) || !ensureOnlyfansEnv(res)) return;
    const itemIds = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds
      : Array.isArray(req.body)
        ? req.body
        : [];
    const parsedIds = itemIds
      .map((id) => (typeof id === 'string' ? parseInt(id, 10) : Number(id)))
      .filter((v) => Number.isFinite(v));
    if (!parsedIds.length) {
      return res.status(400).json({ error: 'itemIds array is required' });
    }
    try {
      const { rows: items } = await pool.query(
        'SELECT * FROM scheduled_items WHERE id = ANY($1)',
        [parsedIds],
      );
      if (!items.length) {
        return res.status(404).json({ error: 'No matching scheduled items' });
      }
      const results = [];
      for (const item of items) {
        results.push({ id: item.id, ...(await processSend(item)) });
      }
      res.json({ results });
    } catch (err) {
      console.error('Error sending scheduled items to queue:', sanitizeErrorFn(err));
      res.status(500).json({ error: 'Failed to send items to queue' });
    }
  });

  router.get('/scheduled-items/logs', async (req, res) => {
    if (!ensureTablesAvailable(res)) return;
    try {
      const data = await fetchLogs({
        page: req.query.page,
        pageSize: req.query.pageSize,
      });
      res.json(data);
    } catch (err) {
      console.error('Error fetching scheduled item logs:', sanitizeErrorFn(err));
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  router.get('/scheduled-items/:id/logs', async (req, res) => {
    if (!ensureTablesAvailable(res)) return;
    try {
      const data = await fetchLogs({
        itemId: parseInt(req.params.id, 10),
        page: req.query.page,
        pageSize: req.query.pageSize,
      });
      res.json(data);
    } catch (err) {
      console.error('Error fetching scheduled item logs:', sanitizeErrorFn(err));
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  let workerTimer = null;
  let workerRunning = false;
  let lastEnvWarningKey = null;

  function hasOnlyfansEnvConfigured() {
    const missing = getMissingEnvVars([
      'ONLYFANS_API_KEY',
      'ONLYFANS_ACCOUNT_ID',
    ]);
    const key = missing.join(',');
    if (missing.length) {
      if (lastEnvWarningKey !== key) {
        console.warn(
          'Scheduled item worker skipping run; missing environment variables:',
          missing,
        );
      }
      lastEnvWarningKey = key;
      return false;
    }
    lastEnvWarningKey = null;
    return true;
  }

  async function fetchPendingScheduledItems(limit = 10) {
    const { rows } = await pool.query(
      `SELECT * FROM scheduled_items
       WHERE status IN ('ready', 'scheduled')
         AND (
           COALESCE(scheduled_at_utc, schedule_time) IS NULL
           OR COALESCE(scheduled_at_utc, schedule_time) <= NOW()
         )
       ORDER BY COALESCE(scheduled_at_utc, schedule_time) NULLS FIRST, id
       LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async function runScheduledItemWorker() {
    if (workerRunning) return;
    if (process.env.NODE_ENV === 'test') return;
    if (!hasScheduledItemsTables()) return;
    if (!hasOnlyfansEnvConfigured()) return;
    workerRunning = true;
    try {
      const pending = await fetchPendingScheduledItems();
      for (const item of pending) {
        await logStep(item.id, 'worker_dispatch', 'start', 'Dispatching scheduled item', {
          scheduled_at_utc: item.scheduled_at_utc || item.schedule_time,
          mode: item.mode,
        });
        const result = await processSend(item);
        await logStep(item.id, 'worker_dispatch', 'end', 'Scheduled item dispatched', {
          status: result?.status,
        });
      }
    } catch (err) {
      const sanitized = sanitizeErrorFn(err);
      console.error('Scheduled item worker failed:', sanitized);
      await appendLog({
        step: 'worker_dispatch',
        phase: 'error',
        level: 'error',
        message: sanitized?.message || err.message || 'Scheduled item worker failed',
        meta: sanitized || {},
      });
    } finally {
      workerRunning = false;
    }
  }

  function startScheduledItemWorker(intervalMs = 60000) {
    if (workerTimer || process.env.NODE_ENV === 'test') return workerTimer;
    runScheduledItemWorker();
    workerTimer = setInterval(runScheduledItemWorker, intervalMs);
    return workerTimer;
  }

  function stopScheduledItemWorker() {
    if (workerTimer) {
      clearInterval(workerTimer);
      workerTimer = null;
    }
  }

  router.startWorker = startScheduledItemWorker;
  router.stopWorker = stopScheduledItemWorker;

  return router;
};
