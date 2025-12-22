const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
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
const { sanitizeError } = require('../sanitizeError');
const { createBulkLogger } = require('../utils/bulkLogs');

module.exports = function ({
  pool,
  sanitizeError: sanitizeErrorFromServer,
  getMissingEnvVars,
  getOFAccountId,
  ofApiRequest,
  ofApi,
  hasBulkScheduleTables = () => true,
  OF_FETCH_LIMIT = 1000,
  useV1MediaUpload = process.env.OF_USE_V1_MEDIA_UPLOAD === 'true',
}) {
  const router = express.Router();
  router.use(express.json({ limit: '10mb' }));

  const sanitizeErrorFn = sanitizeErrorFromServer || sanitizeError;
  const { appendLog, fetchLogs } = createBulkLogger({
    pool,
    sanitizeError: sanitizeErrorFn,
  });
  function parseRetryAfterMs(headers) {
    if (!headers || typeof headers !== 'object') return null;
    const raw =
      headers['retry-after'] ||
      headers['Retry-After'] ||
      headers['Retry-after'] ||
      headers['RETRY-AFTER'];
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateMs = Date.parse(raw);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
    return null;
  }
  function buildLastErrorPayload(sanitized, fallback) {
    const baseMessage = sanitized?.message || fallback || 'Send failed';
    if (sanitized?.response?.data !== undefined) {
      try {
        return JSON.stringify({
          message: baseMessage,
          response: sanitized.response.data,
        });
      } catch {
        return baseMessage;
      }
    }
    return baseMessage;
  }
  function delay(ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
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
  function createRateLimiter() {
    let nextAllowedTime = 0;
    return {
      async wait() {
        const waitMs = Math.max(0, nextAllowedTime - Date.now());
        if (waitMs > 0) await delay(waitMs);
      },
      note(headers) {
        const retryAfter = parseRetryAfterMs(headers);
        if (retryAfter != null) {
          nextAllowedTime = Math.max(nextAllowedTime, Date.now() + retryAfter);
        }
      },
      async call(requestFn) {
        await this.wait();
        try {
          const resp = await ofApiRequest(requestFn);
          this.note(resp?.headers);
          return resp;
        } catch (err) {
          this.note(err?.response?.headers);
          throw err;
        }
      },
    };
  }
  async function logStep(itemId, step, phase, message, meta) {
    const level = phase === 'error' ? 'error' : 'info';
    const event = `${step}:${phase}`;
    await appendLog({
      itemId,
      level,
      event,
      message,
      meta,
    });
  }

  function ensureBulkTablesAvailable(res) {
    if (hasBulkScheduleTables()) return true;
    res.status(503).json({
      error:
        'bulk_schedule_items/bulk_logs tables missing; run migrations to enable bulk scheduling',
    });
    return false;
  }

  function requireOnlyfansEnv(res) {
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

  function normalizeDestination(destination) {
    const allowed = ['post', 'message', 'both'];
    if (typeof destination !== 'string') return 'both';
    const normalized = destination.toLowerCase();
    return allowed.includes(normalized) ? normalized : 'both';
  }

  function formatItem(row) {
    if (!row) return null;
    const scheduleIso = row.schedule_time
      ? new Date(row.schedule_time).toISOString()
      : null;
    const destination = normalizeDestination(row.destination);
    return {
      id: row.id,
      batch_id: row.batch_id,
      source_filename: row.source_filename,
      image_url: row.image_url_cf,
      image_url_cf: row.image_url_cf,
      caption: row.caption,
      schedule_time: scheduleIso,
      timezone: row.timezone,
      destination,
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

  function resolveScheduleTimeUtc(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  function normalizeQueueStatus(status) {
    if (!status) return null;
    const normalized = String(status).toLowerCase();
    if (['sent', 'complete', 'completed', 'done'].includes(normalized)) {
      return 'sent';
    }
    if (
      ['queued', 'pending', 'scheduled', 'processing', 'in_queue', 'waiting'].includes(
        normalized,
      )
    ) {
      return 'queued';
    }
    if (['failed', 'error', 'cancelled', 'canceled'].includes(normalized)) {
      return 'error';
    }
    return normalized;
  }

  function coalesceId(...candidates) {
    for (const candidate of candidates) {
      if (candidate === 0 || candidate) return candidate;
    }
    return null;
  }

  function toNumericId(value) {
    const num = typeof value === 'string' ? parseInt(value, 10) : value;
    return Number.isFinite(num) ? num : null;
  }

  function pickFilename(base, fallback = 'upload') {
    if (base && typeof base === 'string') return base;
    return fallback;
  }

  async function downloadMediaFile(url, filenameHint) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const filename = pickFilename(filenameHint, 'bulk-upload');
    return {
      buffer: Buffer.from(response.data),
      contentType,
      filename,
    };
  }

  async function uploadSingleUseMedia({
    imageUrl,
    filenameHint,
    destination,
    itemId,
    rateLimiter,
  }) {
    await logStep(
      itemId,
      `upload:${destination}`,
      'start',
      'Starting media upload',
      { filename: filenameHint },
    );
    if (!imageUrl) {
      const err = new Error('Missing image URL for upload');
      await logStep(itemId, `upload:${destination}`, 'error', err.message, {});
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
        `upload:${destination}`,
        'info',
        'Resolved upload endpoint',
        {
          filename: filenameHint,
          accountId: uploadTarget.accountId,
          uploadUrl: uploadTarget.uploadUrl,
          useV1Upload: uploadTarget.useV1,
        },
      );
      console.info('Bulk upload target', {
        itemId,
        destination,
        accountId: uploadTarget.accountId,
        uploadUrl: uploadTarget.uploadUrl,
        useV1Upload: uploadTarget.useV1,
      });
      const requester = rateLimiter?.call
        ? (fn) => rateLimiter.call(fn)
        : (fn) => ofApiRequest(fn);
      const resp = await requester(() =>
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
      await logStep(
        itemId,
        `upload:${destination}`,
        'end',
        'Media uploaded',
        {
          mediaId,
          destination,
        },
      );
      return { mediaId, raw: resp.data };
    } catch (err) {
      const sanitized = sanitizeErrorFn(err);
      await logStep(
        itemId,
        `upload:${destination}`,
        'error',
        sanitized?.message || err.message || 'Upload failed',
        sanitized,
      );
      throw err;
    }
  }

  async function fetchActiveFollowings(limit = OF_FETCH_LIMIT, rateLimiter) {
    const ids = new Set();
    const pageSize = Math.max(1, Math.min(50, limit));
    const accountId = await getOFAccountId();
    let offset = 0;
    while (ids.size < limit) {
      const requester = rateLimiter?.call
        ? (fn) => rateLimiter.call(fn)
        : (fn) => ofApiRequest(fn);
      const resp = await requester(() =>
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
    const result = Array.from(ids).slice(0, limit);
    if (result.length === 0) {
      console.info('Active followings fetch returned no recipients', {
        accountId,
        limit,
      });
    }
    return result;
  }

  function formatQueueDate(value, timezone) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .format(parsed)
        .replace(/\//g, '-');
    } catch {
      return null;
    }
  }

  function countQueueTotals(listByDate) {
    if (!listByDate || typeof listByDate !== 'object') return null;
    let total = 0;
    let found = false;
    for (const dayCounts of Object.values(listByDate)) {
      if (!dayCounts || typeof dayCounts !== 'object') continue;
      for (const count of Object.values(dayCounts)) {
        const numeric = Number(count);
        if (Number.isFinite(numeric)) {
          total += numeric;
          found = true;
        }
      }
    }
    return found ? total : null;
  }

  async function confirmQueueStatuses(queueEntries = [], rateLimiter) {
    const entries = (queueEntries || []).map((entry) => {
      if (entry && typeof entry === 'object') {
        return {
          queueId: coalesceId(
            entry.queueId,
            entry.queue_id,
            entry.queueItemId,
            entry.queue_item_id,
            entry.id,
          ),
          publishDate: entry.publishDate || entry.publishDateTime || entry.schedule_time,
          timezone: entry.timezone,
        };
      }
      return { queueId: entry, publishDate: null, timezone: null };
    });
    const ids = entries.map((entry) => entry.queueId).filter(Boolean);
    if (!ids.length) return {};

    const timezone = entries.find((entry) => entry.timezone)?.timezone || 'UTC';
    const publishDates = entries
      .map((entry) => formatQueueDate(entry.publishDate, timezone))
      .filter(Boolean);
    const fallbackDate = formatQueueDate(new Date(), timezone);
    const publishDateStart = publishDates.length
      ? publishDates.reduce((min, current) => (current < min ? current : min), publishDates[0])
      : fallbackDate;
    const publishDateEnd = publishDates.length
      ? publishDates.reduce((max, current) => (current > max ? current : max), publishDates[0])
      : fallbackDate;

    const requester = rateLimiter?.call
      ? (fn) => rateLimiter.call(fn)
      : (fn) => ofApiRequest(fn);
    const accountId = normalizeAccountId(await getOFAccountId());
    const queryWindow = {
      publishDateStart,
      publishDateEnd,
      timezone,
    };

    const limitCap = Math.max(Number(OF_FETCH_LIMIT) || 0, 50);
    let limit = Math.max(ids.length, 20);
    try {
      const countsResp = await requester(() =>
        ofApi.get(`/${accountId}/queue/counts`, { params: queryWindow }),
      );
      const totalCount = countQueueTotals(countsResp?.data?.data?.list || countsResp?.data?.list);
      if (Number.isFinite(totalCount) && totalCount > 0) {
        limit = Math.max(limit, totalCount);
      }
    } catch (err) {
      const sanitized = sanitizeErrorFn(err);
      console.warn('Queue count lookup skipped during status confirmation', {
        message: sanitized?.message || err?.message,
      });
    }
    limit = Math.min(limit, limitCap);

    try {
      const resp = await requester(() =>
        ofApi.get(`/${accountId}/queue`, {
          params: {
            ...queryWindow,
            limit,
          },
        }),
      );
      const list =
        resp?.data?.data?.list ||
        resp?.data?.list ||
        resp?.data?.data?.data?.list ||
        resp?.data?.data?.queueItems ||
        resp?.data?.queueItems ||
        [];
      const rows = Array.isArray(list) ? list : [];
      const statuses = {};
      for (const row of rows) {
        const queueId = coalesceId(
          row?.id,
          row?.queueId,
          row?.queue_id,
          row?.entity?.queueId,
          row?.entity?.queue_id,
        );
        if (!queueId) continue;
        statuses[queueId] = 'queued';
      }
      for (const id of ids) {
        if (!statuses[id]) statuses[id] = 'sent';
      }
      return statuses;
    } catch (err) {
      const sanitized = sanitizeErrorFn(err);
      console.warn('Queue status lookup failed via list endpoint', {
        message: sanitized?.message || err?.message,
      });
      return {};
    }
  }

  function parseQueueResult(payload) {
    const layers = [payload, payload?.data, payload?.data?.data];
    let queueId = null;
    let postId = null;
    let status = null;
    for (const layer of layers) {
      if (!layer) continue;
      const queueItem =
        layer.queue ||
        layer.queueItem ||
        layer.queue_item ||
        layer.queueItemData ||
        layer.queue_item_data ||
        layer.data?.queue ||
        layer.data?.queueItem ||
        layer.data?.queue_item;
      queueId =
        queueId ??
        coalesceId(
          layer.queue_id,
          layer.queueId,
          layer.queue_item_id,
          layer.queueItemId,
          queueItem?.queue_id,
          queueItem?.queueId,
          queueItem?.queue_item_id,
          queueItem?.queueItemId,
          queueItem?.id,
        );
      postId =
        postId ??
        coalesceId(
          layer.post_id,
          layer.postId,
          layer.id,
          layer.post?.id,
          queueItem?.post_id,
          queueItem?.postId,
          queueItem?.post?.id,
        );
      status =
        status ??
        normalizeQueueStatus(
          layer.status ||
            layer.queue_status ||
            layer.queueStatus ||
            queueItem?.status ||
            queueItem?.queue_status ||
            queueItem?.queueStatus,
        );
    }
    return { queueId, postId, status };
  }

  async function createPostQueueItem({ itemId, postPayload, existingQueueId, rateLimiter }) {
    if (existingQueueId) return { queueId: existingQueueId, postId: null, status: null };
    const accountId = normalizeAccountId(await getOFAccountId());
    const requester = rateLimiter?.call
      ? (fn) => rateLimiter.call(fn)
      : (fn) => ofApiRequest(fn);
    const payload = { ...postPayload };
    if (payload.mediaIds && !payload.mediaFiles) {
      payload.mediaFiles = payload.mediaIds;
      delete payload.mediaIds;
    }
    if (payload.scheduleTime && !payload.scheduledDate) {
      payload.scheduledDate = payload.scheduleTime;
      delete payload.scheduleTime;
    }
    payload.saveForLater = true;
    const resp = await requester(() =>
      ofApi.post(`/${accountId}/posts`, payload),
    );
    const parsed = parseQueueResult(resp?.data);
    const queueId = parsed.queueId;
    const postId = parsed.postId;
    const status = parsed.status;
    if (!queueId) {
      throw new Error('Queue creation succeeded but queue ID is missing');
    }
    await logStep(itemId, 'queue:create', 'end', 'Queue item created', {
      queueId,
      postId,
      status,
    });
    return { queueId, postId, status };
  }

  async function publishQueueItem({ itemId, queueId, rateLimiter }) {
    const accountId = normalizeAccountId(await getOFAccountId());
    const requester = rateLimiter?.call
      ? (fn) => rateLimiter.call(fn)
      : (fn) => ofApiRequest(fn);
    const url = `/${accountId}/queue/${queueId}/publish`;
    const resp = await requester(() => ofApi.put(url));
    const parsed = parseQueueResult(resp?.data);
    const resolvedQueueId = parsed.queueId || queueId;
    const postId = parsed.postId;
    const status = parsed.status || (resolvedQueueId ? 'queued' : null);
    await logStep(itemId, 'publish:post', 'end', 'Queue item published', {
      queueId: resolvedQueueId,
      postId,
      status,
    });
    return { queueId: resolvedQueueId, postId, status };
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
      for (const savedPost of saved) {
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
        await appendLog({
          itemId: savedPost.id,
          level: 'info',
          event: 'schedule:save',
          message: 'Bulk schedule item saved',
          meta: {
            destination: savedPost.destination,
            schedule_time: savedPost.schedule_time,
            timezone: savedPost.timezone,
            batch_id: savedPost.batch_id,
          },
        });
      }
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
      const appliedFilters = {};
      if (req.query.status) {
        const statuses = String(req.query.status)
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (statuses.length) {
          filters.push(`local_status = ANY($${values.length + 1})`);
          values.push(statuses);
          appliedFilters.status = statuses;
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
          appliedFilters.destination = destinations;
        }
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM bulk_schedule_items ${where}
         ORDER BY schedule_time NULLS LAST, id DESC`,
        values,
      );
      await appendLog({
        level: 'info',
        event: 'load:items',
        message: 'Loaded bulk schedule items',
        meta: { count: rows.length, filters: appliedFilters },
      });
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
      await appendLog({
        itemId: rows[0].id,
        level: 'info',
        event: 'schedule:update',
        message: 'Bulk schedule item updated',
        meta: {
          updates: {
            caption: req.body.caption,
            schedule_time: req.body.schedule_time,
            timezone: req.body.timezone,
            destination: req.body.destination,
          },
        },
      });
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
      const parsedItemId =
        req.query.itemId !== undefined ? parseInt(req.query.itemId, 10) : null;
      const itemId = Number.isNaN(parsedItemId) ? null : parsedItemId;
      const level = req.query.level;
      const page = req.query.page;
      const pageSize = req.query.pageSize;

      const data = await fetchLogs({ itemId, level, page, pageSize });
      res.json(data);
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
    const publish = req.body?.publish === true;

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

      const rateLimiter = createRateLimiter();
      const results = [];

      for (const item of items) {
        const destination = normalizeDestination(item.destination);
        const outcome = { id: item.id, destination };
        if (!force && item.local_status === 'sent') {
          outcome.status = 'skipped';
          outcome.reason = 'Already marked as sent';
          outcome.item = formatItem(item);
          results.push(outcome);
          continue;
        }

        const scheduleTimeUtc = resolveScheduleTimeUtc(item.schedule_time);
        const caption = item.caption || '';
        const filenameHint = item.source_filename || `bulk-item-${item.id}`;
        let postMediaId = item.post_media_id || null;
        let messageMediaId = item.message_media_id || null;
        let postId = item.of_post_id || null;
        let messageId = item.of_message_id || null;
        let postQueueId = item.of_post_queue_id || null;
        let messageQueueId = item.of_message_queue_id || null;
        let postStatus = item.post_status || null;
        let messageStatus = item.message_status || null;

        try {
          await appendLog({
            itemId: item.id,
            level: 'info',
            event: 'send:start',
            message: 'Starting bulk send',
            meta: {
              destination: item.destination,
              schedule_time: scheduleTimeUtc || item.schedule_time,
              timezone: item.timezone,
            },
          });

          if (!item.image_url_cf) {
            throw new Error('Missing image_url_cf for item');
          }

          if (['message', 'both'].includes(destination)) {
            const messageUpload = await uploadSingleUseMedia({
              imageUrl: item.image_url_cf,
              filenameHint: `${filenameHint}-message`,
              destination: 'message',
              itemId: item.id,
              rateLimiter,
            });
            messageMediaId = messageUpload.mediaId;

            const recipientIds = await fetchActiveFollowings(OF_FETCH_LIMIT, rateLimiter);
            if (!recipientIds.length) {
              await logStep(
                item.id,
                'recipients',
                'info',
                'Active followings fetch returned no recipients',
                { limit: OF_FETCH_LIMIT },
              );
              throw new Error('No active followings available for messaging');
            }

            const messagePayload = {
              recipientIds,
              mediaIds: [messageMediaId],
              text: caption,
            };

            try {
              await logStep(item.id, 'send:message', 'start', 'Submitting messages', {
                recipients: recipientIds.length,
                media_id: messageMediaId,
              });
              const accountId = normalizeAccountId(await getOFAccountId());
              const messageEndpoint = `/${accountId}/messages`;
              const messageResp = await rateLimiter.call(() =>
                ofApi.post(messageEndpoint, messagePayload),
              );
              const messageBatchId = coalesceId(
                messageResp.data?.message_batch_id,
                messageResp.data?.messageBatchId,
                messageResp.data?.batch_id,
                messageResp.data?.batchId,
              );
              const rawMessageId = coalesceId(
                messageResp.data?.id,
                messageResp.data?.messageId,
                messageResp.data?.message_id,
                messageResp.data?.data?.id,
                messageResp.data?.data?.messageId,
                messageBatchId,
              );
              messageId = toNumericId(rawMessageId);
              messageQueueId = null;
              messageStatus =
                normalizeQueueStatus(
                  messageResp.data?.status ||
                    messageResp.data?.queueStatus ||
                    messageResp.data?.queue_status ||
                    messageResp.data?.messageStatus ||
                    messageResp.data?.message_status,
                ) || 'sent';
              await logStep(item.id, 'send:message', 'end', 'Messages submitted', {
                messageId,
                messageQueueId,
                recipients: recipientIds.length,
                message_batch_id: messageBatchId,
              });
            } catch (messageErr) {
              const sanitizedMessageErr = sanitizeErrorFn(messageErr);
              await logStep(
                item.id,
                'send:message',
                'error',
                sanitizedMessageErr?.message ||
                  messageErr.message ||
                  'Failed to send message',
                sanitizedMessageErr,
              );
              throw messageErr;
            }
          }

          if (['post', 'both'].includes(destination)) {
            const postUpload = await uploadSingleUseMedia({
              imageUrl: item.image_url_cf,
              filenameHint: `${filenameHint}-post`,
              destination: 'post',
              itemId: item.id,
              rateLimiter,
            });
            postMediaId = postUpload.mediaId;

            const postPayload = {
              text: caption,
              mediaIds: [postMediaId],
            };
            if (scheduleTimeUtc) postPayload.scheduleTime = scheduleTimeUtc;

            try {
              await logStep(item.id, 'send:post', 'start', 'Submitting post', {
                schedule_time: scheduleTimeUtc,
              });
              const queueCreation = await createPostQueueItem({
                itemId: item.id,
                postPayload,
                existingQueueId: postQueueId,
                rateLimiter,
              });
              postQueueId = queueCreation.queueId || postQueueId;
              postId = coalesceId(postId, queueCreation.postId);
              postStatus = queueCreation.status || postStatus;

              if (publish) {
                const publishResult = await publishQueueItem({
                  itemId: item.id,
                  queueId: postQueueId,
                  rateLimiter,
                });
                postQueueId = publishResult.queueId || postQueueId;
                postId = coalesceId(postId, publishResult.postId);
                postStatus =
                  publishResult.status || postStatus || (postQueueId ? 'queued' : 'sent');
              }
              await logStep(
                item.id,
                'send:post',
                'end',
                publish ? 'Post submission completed' : 'Post queued for later publishing',
                {
                  postId,
                  postQueueId,
                  schedule_time: scheduleTimeUtc,
                  publish_requested: publish,
                },
              );
            } catch (postErr) {
              const sanitizedPostErr = sanitizeErrorFn(postErr);
              await logStep(
                item.id,
                'send:post',
                'error',
                sanitizedPostErr?.message || postErr.message || 'Failed to submit post',
                sanitizedPostErr,
              );
              throw postErr;
            }
          }

          const queueStatuses = await confirmQueueStatuses(
            [
              {
                queueId: postQueueId,
                publishDate: item.schedule_time,
                timezone: item.timezone,
              },
              {
                queueId: messageQueueId,
                publishDate: item.schedule_time,
                timezone: item.timezone,
              },
            ],
            rateLimiter,
          );
          if (queueStatuses[postQueueId]) postStatus = queueStatuses[postQueueId];
          if (queueStatuses[messageQueueId]) messageStatus = queueStatuses[messageQueueId];

          const relevantStatuses = [];
          if (['post', 'both'].includes(destination)) relevantStatuses.push(postStatus);
          if (['message', 'both'].includes(destination)) relevantStatuses.push(messageStatus);
          let localStatus = 'queued';
          if (relevantStatuses.some((s) => s === 'error')) {
            localStatus = 'error';
          } else if (relevantStatuses.length && relevantStatuses.every((s) => s === 'sent')) {
            localStatus = 'sent';
          }

          const { rows: updatedRows } = await pool.query(
            `UPDATE bulk_schedule_items
             SET post_media_id = $1,
                 message_media_id = $2,
                 of_post_id = $3,
                 of_message_id = $4,
                 of_post_queue_id = $5,
                 of_message_queue_id = $6,
                 local_status = $7,
                 post_status = $8,
                 message_status = $9,
                 last_error = $10,
                 updated_at = NOW()
            WHERE id = $11
             RETURNING *`,
            [
              ['post', 'both'].includes(destination) ? postMediaId : item.post_media_id,
              ['message', 'both'].includes(destination)
                ? messageMediaId
                : item.message_media_id,
              ['post', 'both'].includes(destination) ? postId : item.of_post_id,
              ['message', 'both'].includes(destination) ? messageId : item.of_message_id,
              ['post', 'both'].includes(destination) ? postQueueId : item.of_post_queue_id,
              ['message', 'both'].includes(destination)
                ? messageQueueId
                : item.of_message_queue_id,
              localStatus,
              ['post', 'both'].includes(destination) ? postStatus || 'queued' : item.post_status,
              ['message', 'both'].includes(destination)
                ? messageStatus || 'queued'
                : item.message_status,
              null,
              item.id,
            ],
          );

          await appendLog({
            itemId: item.id,
            level: 'info',
            event: 'send:queued',
            message: 'Item queued',
            meta: {
              postMediaId,
              messageMediaId,
              postQueueId,
              messageQueueId,
            },
          });

          const updatedItem = updatedRows[0] || item;
          outcome.status = updatedItem.local_status || 'queued';
          outcome.item = formatItem(updatedItem);
        } catch (err) {
          const sanitized = sanitizeErrorFn(err);
          const safeMessage = sanitized?.message || err.message || 'Send failed';
          const lastError = buildLastErrorPayload(sanitized, safeMessage);
          await appendLog({
            itemId: item.id,
            level: 'error',
            event: 'send:error',
            message: safeMessage,
            meta: sanitized,
          });
          const { rows: updatedRows } = await pool.query(
            `UPDATE bulk_schedule_items
             SET local_status = $1,
                 post_status = $2,
                 message_status = $3,
                 last_error = $4,
                 updated_at = NOW()
             WHERE id = $5
             RETURNING *`,
            [
              'error',
              ['post', 'both'].includes(destination) ? 'error' : item.post_status,
              ['message', 'both'].includes(destination) ? 'error' : item.message_status,
              lastError,
              item.id,
            ],
          );
          outcome.status = 'error';
          outcome.error = safeMessage;
          outcome.last_error = lastError;
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
