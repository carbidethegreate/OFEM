const express = require('express');
const {
  tokenFingerprint,
  cloudflareError,
  getCloudflareConfig,
  formatEnvErrorResponse,
  verifyCloudflareToken,
  uploadToCloudflareImages,
  logCloudflareFailure,
  formatUploadError,
} = require('../utils/cloudflareImages');
const {
  getBatch,
  updateBatch,
  pruneExpired,
} = require('../utils/uploadRetryStore');
const { sanitizeError, sanitizeLogPayload } = require('../sanitizeError');

module.exports = function ({
  pool,
  sanitizeError: sanitizeErrorFromServer,
  getMissingEnvVars,
  getOFAccountId,
  ofApiRequest,
  ofApi,
  hasBulkScheduleTables = () => true,
}) {
  const router = express.Router();
  router.use(express.json({ limit: '10mb' }));

  const sanitizeErrorFn = sanitizeErrorFromServer || sanitizeError;

  function ensureBulkTablesAvailable(res) {
    if (hasBulkScheduleTables()) return true;
    res.status(503).json({
      error:
        'bulk_schedule_items/bulk_logs tables missing; run migrations to enable bulk scheduling',
    });
    return false;
  }

  function requireOnlyfansEnv(res) {
    const missing = getMissingEnvVars(['ONLYFANS_API_KEY']);
    if (missing.length) {
      res.status(400).json({
        error: `Missing environment variable(s): ${missing.join(', ')}`,
      });
      return false;
    }
    return true;
  }

  async function appendLog(itemId, level, event, message, meta) {
    try {
      await pool.query(
        'INSERT INTO bulk_logs (item_id, level, event, message, meta) VALUES ($1, $2, $3, $4, $5)',
        [
          itemId || null,
          level,
          event,
          message,
          sanitizeLogPayload(meta || {}),
        ],
      );
    } catch (err) {
      console.error('Failed to write bulk log:', sanitizeErrorFn(err));
    }
  }

  function normalizeDestination(destination) {
    const allowed = ['post', 'message', 'both'];
    if (typeof destination !== 'string') return 'post';
    const normalized = destination.toLowerCase();
    return allowed.includes(normalized) ? normalized : 'post';
  }

  function formatItem(row) {
    if (!row) return null;
    const scheduleIso = row.schedule_time
      ? new Date(row.schedule_time).toISOString()
      : null;
    return {
      id: row.id,
      batch_id: row.batch_id,
      source_filename: row.source_filename,
      image_url: row.image_url_cf,
      image_url_cf: row.image_url_cf,
      caption: row.caption,
      schedule_time: scheduleIso,
      timezone: row.timezone,
      destination: row.destination,
      status: row.local_status,
      local_status: row.local_status,
      post_status: row.post_status,
      message_status: row.message_status,
      last_error: row.last_error,
      created_at: row.created_at,
      updated_at: row.updated_at,
      statuses: {
        local: row.local_status,
        post: row.post_status,
        message: row.message_status,
      },
    };
  }

  function formatLogRow(row) {
    return {
      id: row.id,
      item_id: row.item_id,
      level: row.level,
      event: row.event,
      message: row.message,
      meta: row.meta || {},
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    };
  }

  router.post('/scheduled-posts', async (req, res) => {
    if (!ensureBulkTablesAvailable(res) || !requireOnlyfansEnv(res)) return;
    const incomingPosts = Array.isArray(req.body)
      ? req.body
      : Array.isArray(req.body?.posts)
        ? req.body.posts
        : [];
    const retryMissingUploads =
      !Array.isArray(req.body) && req.body?.retryMissingUploads === true;
    const batchId = !Array.isArray(req.body) ? req.body?.batchId : null;
    if (retryMissingUploads) pruneExpired();

    if (incomingPosts.length === 0) {
      return res.status(400).json({ error: 'No posts provided' });
    }

    let batch = null;
    if (retryMissingUploads && batchId) {
      batch = getBatch(batchId);
      if (!batch?.items?.length) {
        return res.status(404).json({ error: 'Batch not found or expired' });
      }
    }

    const posts = incomingPosts.map((post) => post || {});
    const postsNeedingUploads = [];
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const hasUrl =
        typeof post.image_url === 'string' && post.image_url.trim().length > 0;
      if (!hasUrl) postsNeedingUploads.push(i);
    }

    let cloudflareConfig;
    if (retryMissingUploads && postsNeedingUploads.length) {
      try {
        cloudflareConfig = getCloudflareConfig();
      } catch (configErr) {
        const envError = formatEnvErrorResponse(configErr);
        if (envError) {
          return res.status(envError.status).json(envError.payload);
        }
        throw configErr;
      }

      try {
        console.info('Verifying Cloudflare token fingerprint (schedule retry)', {
          tokenFingerprint: tokenFingerprint(cloudflareConfig.token),
        });
        await verifyCloudflareToken(cloudflareConfig);
      } catch (verifyErr) {
        const status =
          verifyErr?.statusCode ||
          verifyErr?.cloudflareStatus ||
          verifyErr?.response?.status ||
          401;
        const message = verifyErr?.isVerificationError
          ? 'Invalid Cloudflare configuration: CF_IMAGES_TOKEN'
          : 'Cloudflare token verification failed';
        logCloudflareFailure(verifyErr, 'token-verification');
        return res.status(status).json({ error: message });
      }
    }

    const reuploadResults = [];
    if (retryMissingUploads && postsNeedingUploads.length && batch?.items) {
      for (const idx of postsNeedingUploads) {
        const post = posts[idx];
        const batchItem = batch.items[idx];
        const retryData = batchItem?.retryData;
        if (!retryData?.buffer) {
          reuploadResults.push({
            index: idx,
            status: 'failed',
            reason: 'Missing retry data; please reupload.',
          });
          continue;
        }
        try {
          const uploadResult = await uploadToCloudflareImages(
            { buffer: retryData.buffer, mimetype: retryData.mimetype },
            retryData.filename,
            retryData.mimetype,
            cloudflareConfig,
          );
          posts[idx] = {
            ...post,
            image_url: uploadResult?.url || uploadResult?.imageUrl || null,
            image_url_cf: uploadResult?.url || uploadResult?.imageUrl || null,
          };
          const updatedItem = {
            ...batchItem,
            uploadStatus: 'success',
            url: uploadResult?.url || null,
            imageUrl: uploadResult?.url || null,
            imageId: uploadResult?.imageId || null,
            error: null,
          };
          batch.items[idx] = updatedItem;
          reuploadResults.push({
            index: idx,
            status: 'success',
            image_url: updatedItem.imageUrl,
            image_url_cf: updatedItem.imageUrl,
          });
        } catch (uploadErr) {
          const cfErr =
            uploadErr?.isCloudflareError ||
            uploadErr?.isAxiosError ||
            uploadErr?.response
              ? uploadErr
              : cloudflareError(uploadErr?.message, 502);
          logCloudflareFailure(cfErr, batchItem?.filename || `post-${idx + 1}`);
          const formatted = formatUploadError(cfErr);
          posts[idx] = {
            ...post,
            image_url: null,
            image_url_cf: null,
          };
          reuploadResults.push({
            index: idx,
            status: 'failed',
            reason: formatted?.message || cfErr?.message || 'Upload failed',
          });
        }
      }

      if (batchId && batch?.items?.length) {
        updateBatch(batchId, (existing) => ({
          ...existing,
          items: batch.items,
        }));
      }
    }

    const scheduleResults = posts.map((post, idx) => ({
      index: idx,
      status: post?.image_url ? 'pending' : 'skipped',
      reason: post?.image_url ? null : 'Missing image_url',
    }));

    const schedulable = posts
      .map((post, idx) => ({ post: post || {}, idx }))
      .map(({ post, idx }) => {
        const destination = normalizeDestination(post.destination);
        const imageUrl =
          typeof post.image_url === 'string' && post.image_url
            ? post.image_url
            : typeof post.image_url_cf === 'string' && post.image_url_cf
              ? post.image_url_cf
              : null;
        const caption = typeof post.caption === 'string' ? post.caption : '';
        const scheduleTimeInput = post.schedule_time || post.sendAt || null;
        let scheduleTime = null;
        if (scheduleTimeInput) {
          const parsed = new Date(scheduleTimeInput);
          if (!Number.isNaN(parsed.getTime())) {
            scheduleTime = parsed;
          } else {
            scheduleResults[idx] = {
              index: idx,
              status: 'skipped',
              reason: 'Invalid schedule_time',
            };
            return null;
          }
        }
        if (!imageUrl) {
          scheduleResults[idx] = {
            index: idx,
            status: 'skipped',
            reason: 'Missing image_url_cf',
          };
          return null;
        }
        const timeZone =
          typeof post.timezone === 'string' && post.timezone.trim()
            ? post.timezone.trim()
            : null;
        return {
          idx,
          batchId: batchId || post.batchId || null,
          source_filename: post.source_filename || post.filename || null,
          image_url_cf: imageUrl,
          caption,
          schedule_time: scheduleTime,
          timezone: timeZone,
          destination,
        };
      })
      .filter(Boolean);

    if (schedulable.length === 0) {
      return res.status(400).json({
        error: 'No schedulable posts: missing uploaded media',
        scheduleResults,
        reuploadResults,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const saved = [];

      for (const { idx, ...record } of schedulable) {
        const { rows } = await client.query(
          `INSERT INTO bulk_schedule_items (
            batch_id,
            source_filename,
            image_url_cf,
            caption,
            schedule_time,
            timezone,
            destination,
            local_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *`,
          [
            record.batchId,
            record.source_filename,
            record.image_url_cf,
            record.caption,
            record.schedule_time,
            record.timezone,
            record.destination,
            'scheduled',
          ],
        );
        saved.push({ ...rows[0], originalIndex: idx });
      }

      await client.query('COMMIT');
      saved.forEach((savedPost) => {
        const target = scheduleResults[savedPost.originalIndex];
        if (target) {
          target.status = 'scheduled';
          target.id = savedPost.id;
          target.image_url = savedPost.image_url_cf;
          target.local_status = savedPost.local_status;
          target.schedule_time = savedPost.schedule_time
            ? new Date(savedPost.schedule_time).toISOString()
            : null;
        }
      });
      res.status(201).json({
        success: true,
        posts: saved.map((p) => {
          const formatted = formatItem(p);
          return formatted;
        }),
        scheduleResults,
        reuploadResults,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      const sanitizedErr = sanitizeErrorFn(err);
      const status = err.status || sanitizedErr?.status || 500;
      console.error('Error saving scheduled posts:', sanitizedErr);
      res.status(status).json({
        error: sanitizedErr?.message || 'Failed to save scheduled posts',
        scheduleResults,
        reuploadResults,
      });
    } finally {
      client.release();
    }
  });

  router.get('/scheduled-posts', async (req, res) => {
    if (!ensureBulkTablesAvailable(res)) return;
    try {
      const { rows } = await pool.query(
        'SELECT * FROM bulk_schedule_items ORDER BY schedule_time NULLS LAST, id DESC',
      );
      res.json({
        posts: rows.map((row) => formatItem(row)),
      });
    } catch (err) {
      console.error('Error fetching scheduled posts:', sanitizeErrorFn(err));
      res.status(500).json({ error: 'Failed to fetch scheduled posts' });
    }
  });

  router.get('/bulk-schedule', async (req, res) => {
    if (!ensureBulkTablesAvailable(res)) return;
    try {
      const filters = [];
      const values = [];
      if (req.query.status) {
        const statuses = String(req.query.status)
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (statuses.length) {
          filters.push(`local_status = ANY($${values.length + 1})`);
          values.push(statuses);
        }
      }
      if (req.query.destination) {
        const destinations = String(req.query.destination)
          .split(',')
          .map(normalizeDestination)
          .filter(Boolean);
        if (destinations.length) {
          filters.push(`destination = ANY($${values.length + 1})`);
          values.push(destinations);
        }
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM bulk_schedule_items ${where}
         ORDER BY schedule_time NULLS LAST, id DESC`,
        values,
      );
      res.json({
        items: rows.map((row) => formatItem(row)),
      });
    } catch (err) {
      console.error('Error fetching bulk schedule:', sanitizeErrorFn(err));
      res.status(500).json({ error: 'Failed to fetch bulk schedule' });
    }
  });

  router.patch('/bulk-schedule/:id', async (req, res) => {
    if (!ensureBulkTablesAvailable(res)) return;
    const updates = [];
    const values = [];
    let idx = 1;
    if (req.body.caption !== undefined) {
      updates.push(`caption = $${idx++}`);
      values.push(typeof req.body.caption === 'string' ? req.body.caption : '');
    }
    if (req.body.schedule_time !== undefined) {
      if (req.body.schedule_time === null || req.body.schedule_time === '') {
        updates.push(`schedule_time = $${idx++}`);
        values.push(null);
      } else {
        const parsed = new Date(req.body.schedule_time);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ error: 'Invalid schedule_time' });
        }
        updates.push(`schedule_time = $${idx++}`);
        values.push(parsed);
      }
    }
    if (req.body.timezone !== undefined) {
      const tz =
        typeof req.body.timezone === 'string' && req.body.timezone.trim()
          ? req.body.timezone.trim()
          : null;
      updates.push(`timezone = $${idx++}`);
      values.push(tz);
    }
    if (req.body.destination !== undefined) {
      updates.push(`destination = $${idx++}`);
      values.push(normalizeDestination(req.body.destination));
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }
    updates.push(`updated_at = NOW()`);
    values.push(req.params.id);

    try {
      const { rows } = await pool.query(
        `UPDATE bulk_schedule_items
         SET ${updates.join(', ')}
         WHERE id = $${idx}
         RETURNING *`,
        values,
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'Item not found' });
      }
      res.json({ item: formatItem(rows[0]) });
    } catch (err) {
      console.error('Error updating bulk schedule:', sanitizeErrorFn(err));
      res.status(500).json({ error: 'Failed to update item' });
    }
  });

  router.delete('/bulk-schedule/:id', async (req, res) => {
    if (!ensureBulkTablesAvailable(res)) return;
    try {
      const result = await pool.query(
        'DELETE FROM bulk_schedule_items WHERE id=$1',
        [req.params.id],
      );
      res.json({ success: result.rowCount > 0 });
    } catch (err) {
      console.error('Error deleting bulk schedule item:', sanitizeErrorFn(err));
      res.status(500).json({ error: 'Failed to delete item' });
    }
  });

  router.get('/bulk-logs', async (req, res) => {
    if (!ensureBulkTablesAvailable(res)) return;
    try {
      const itemId = req.query.itemId ? parseInt(req.query.itemId, 10) : null;
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 100);
      const offset = (page - 1) * pageSize;

      const params = [];
      const where = itemId ? `WHERE item_id = $1` : '';
      if (itemId) params.push(itemId);

      const logsRes = await pool.query(
        `SELECT * FROM bulk_logs ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset],
      );
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS count FROM bulk_logs ${where}`,
        params,
      );
      const globalsRes = await pool.query(
        `SELECT * FROM bulk_logs
         WHERE item_id IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 20`,
      );

      res.json({
        logs: logsRes.rows.map(formatLogRow),
        globals: globalsRes.rows.map(formatLogRow),
        page,
        pageSize,
        total: countRes.rows[0]?.count || 0,
      });
    } catch (err) {
      console.error('Error fetching bulk logs:', sanitizeErrorFn(err));
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  router.post('/bulk-send', async (req, res) => {
    if (!ensureBulkTablesAvailable(res) || !requireOnlyfansEnv(res)) return;
    const itemIds = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds
          .map((id) =>
            typeof id === 'string' ? parseInt(id, 10) : Number(id),
          )
          .filter((v) => Number.isFinite(v))
      : [];
    const force = req.body?.force === true;

    if (!itemIds.length) {
      return res.status(400).json({ error: 'itemIds array is required' });
    }

    try {
      const { rows: items } = await pool.query(
        'SELECT * FROM bulk_schedule_items WHERE id = ANY($1)',
        [itemIds],
      );
      if (!items.length) {
        return res.status(404).json({ error: 'No matching schedule items' });
      }

      const accountId = await getOFAccountId();
      const results = [];

      for (const item of items) {
        const destination = normalizeDestination(item.destination);
        const outcome = { id: item.id, destination };
        if (!force && item.local_status === 'sent') {
          outcome.status = 'skipped';
          outcome.reason = 'Already marked as sent';
          results.push(outcome);
          continue;
        }

        try {
          await appendLog(
            item.id,
            'info',
            'send:start',
            'Starting bulk send',
            {
              destination: item.destination,
              schedule_time: item.schedule_time,
              timezone: item.timezone,
            },
          );

          if (!item.image_url_cf) {
            throw new Error('Missing image_url_cf for item');
          }

          const uploadResp = await ofApiRequest(() =>
            ofApi.post(`/${accountId}/media/scrape`, {
              url: item.image_url_cf,
            }),
          );
          const mediaId =
            uploadResp.data?.media?.id ||
            uploadResp.data?.id ||
            uploadResp.data?.mediaId ||
            uploadResp.data?.media_id ||
            null;

          const queuePayload = {
            text: item.caption || '',
            media_ids: mediaId ? [mediaId] : [],
          };
          if (item.schedule_time) queuePayload.schedule_time = item.schedule_time;
          if (item.timezone) queuePayload.timezone = item.timezone;

          let postQueueId = item.of_post_queue_id || null;
          let messageQueueId = item.of_message_queue_id || null;

          if (['post', 'both'].includes(destination)) {
            const queueResp = await ofApiRequest(() =>
              ofApi.post(`/${accountId}/queue`, {
                type: 'post',
                ...queuePayload,
              }),
            );
            postQueueId =
              queueResp.data?.id ||
              queueResp.data?.queue_id ||
              queueResp.data?.queueId ||
              queueResp.data?.data?.id ||
              postQueueId;
          }

          if (['message', 'both'].includes(destination)) {
            const queueResp = await ofApiRequest(() =>
              ofApi.post(`/${accountId}/queue`, {
                type: 'message',
                ...queuePayload,
              }),
            );
            messageQueueId =
              queueResp.data?.id ||
              queueResp.data?.queue_id ||
              queueResp.data?.queueId ||
              queueResp.data?.data?.id ||
              messageQueueId;
          }

          const { rows: updatedRows } = await pool.query(
            `UPDATE bulk_schedule_items
             SET post_media_id = $1,
                 message_media_id = $2,
                 of_post_queue_id = $3,
                 of_message_queue_id = $4,
                 local_status = $5,
                 post_status = $6,
                 message_status = $7,
                 last_error = $8,
                 updated_at = NOW()
             WHERE id = $9
             RETURNING *`,
            [
              ['post', 'both'].includes(destination) ? mediaId : item.post_media_id,
              ['message', 'both'].includes(destination)
                ? mediaId
                : item.message_media_id,
              postQueueId,
              messageQueueId,
              'queued',
              postQueueId ? 'queued' : item.post_status,
              messageQueueId ? 'queued' : item.message_status,
              null,
              item.id,
            ],
          );

          await appendLog(item.id, 'info', 'send:queued', 'Item queued', {
            mediaId,
            postQueueId,
            messageQueueId,
          });

          const updatedItem = updatedRows[0] || item;
          outcome.status = updatedItem.local_status || 'queued';
          outcome.item = formatItem(updatedItem);
        } catch (err) {
          const sanitized = sanitizeErrorFn(err);
          const safeMessage = sanitized?.message || err.message || 'Send failed';
          await appendLog(item.id, 'error', 'send:error', safeMessage, sanitized);
          const { rows: updatedRows } = await pool.query(
            `UPDATE bulk_schedule_items
             SET local_status = $1,
                 last_error = $2,
                 updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
            ['error', safeMessage, item.id],
          );
          outcome.status = 'error';
          outcome.error = safeMessage;
          outcome.item = formatItem(updatedRows[0] || item);
        }

        results.push(outcome);
      }

      res.json({ results });
    } catch (err) {
      const sanitized = sanitizeErrorFn(err);
      console.error('Error sending bulk items:', sanitized);
      res.status(err.status || sanitized?.status || 500).json({
        error: sanitized?.message || 'Failed to send bulk items',
      });
    }
  });

  return router;
};
