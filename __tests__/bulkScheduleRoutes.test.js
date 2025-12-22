const request = require('supertest');
const express = require('express');
const { newDb } = require('pg-mem');
const axios = require('axios');
const {
  verifyCloudflareToken,
  uploadToCloudflareImages,
  getCloudflareConfig,
  logCloudflareFailure,
  formatUploadError,
  tokenFingerprint,
} = require('../utils/cloudflareImages');
const { saveBatch } = require('../utils/uploadRetryStore');

jest.mock('axios');
jest.mock('../utils/cloudflareImages', () => {
  const actual = jest.requireActual('../utils/cloudflareImages');
  return {
    tokenFingerprint: jest.fn(),
    cloudflareError: actual.cloudflareError,
    getCloudflareConfig: jest.fn(),
    formatEnvErrorResponse: actual.formatEnvErrorResponse,
    verifyCloudflareToken: jest.fn(),
    uploadToCloudflareImages: jest.fn(),
    logCloudflareFailure: jest.fn(),
    formatUploadError: jest.fn((err) => err),
  };
});

const TABLE_SQL = `
CREATE TABLE bulk_schedule_items (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT,
  source_filename TEXT,
  image_url_cf TEXT,
  caption TEXT,
  schedule_time TIMESTAMPTZ,
  timezone TEXT,
  destination TEXT,
  post_media_id BIGINT,
  message_media_id BIGINT,
  of_post_id BIGINT,
  of_message_id BIGINT,
  of_post_queue_id BIGINT,
  of_message_queue_id BIGINT,
  local_status TEXT DEFAULT 'draft',
  post_status TEXT,
  message_status TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT bulk_schedule_items_destination_check CHECK (destination IN ('post', 'message', 'both')),
  CONSTRAINT bulk_schedule_items_local_status_check CHECK (local_status IN ('draft', 'pending', 'scheduled', 'queued', 'sent', 'error'))
);

CREATE TABLE bulk_logs (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT REFERENCES bulk_schedule_items(id),
  level TEXT,
  event TEXT,
  message TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT bulk_logs_level_check CHECK (level IN ('info', 'warn', 'error'))
);
`;

async function createApp(options = {}) {
  const { useV1MediaUpload = false } = options;
  const mem = newDb();
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  await pool.query(TABLE_SQL);
  const baseQuery = pool.query.bind(pool);
  pool.query = (text, params) => {
    if (
      typeof text === 'string' &&
      text.includes('SELECT * FROM bulk_schedule_items WHERE id = ANY($1')
    ) {
      const ids = Array.isArray(params?.[0])
        ? params[0].map((v) => Number(v)).filter((v) => Number.isFinite(v))
        : [];
      if (!ids.length) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return baseQuery('SELECT * FROM bulk_schedule_items').then((res) => {
        const rows = res.rows.filter((row) => ids.includes(Number(row.id)));
        return { ...res, rows, rowCount: rows.length };
      });
    }
    if (typeof text === 'string' && text.includes('WHERE id = ANY($1)')) {
      return baseQuery(text.replace('ANY($1)', 'ANY($1::int[])'), params);
    }
    return baseQuery(text, params);
  };

  const ofApi = { post: jest.fn(), get: jest.fn(), put: jest.fn() };
  const ofApiRequest = jest.fn((fn) => fn());
  const getMissingEnvVars = jest.fn(() => []);
  const getOFAccountId = jest.fn().mockResolvedValue('acc1');

  const routerFactory = require('../routes/bulkSchedule');
  const app = express();
  app.use('/api', routerFactory({
    pool,
    sanitizeError: (err) => err,
    getMissingEnvVars,
    getOFAccountId,
    ofApiRequest,
    ofApi,
    hasBulkScheduleTables: () => true,
    OF_FETCH_LIMIT: 5,
    useV1MediaUpload,
  }));
  return { app, pool, ofApi, ofApiRequest, getMissingEnvVars, getOFAccountId };
}

describe('bulk schedule routes', () => {
  let cloudflareCallOrder;

  beforeEach(() => {
    axios.get.mockReset();
    axios.post.mockReset();
    verifyCloudflareToken.mockReset();
    uploadToCloudflareImages.mockReset();
    getCloudflareConfig.mockReset();
    logCloudflareFailure.mockReset();
    formatUploadError.mockReset();
    tokenFingerprint.mockReset();
    cloudflareCallOrder = [];

    getCloudflareConfig.mockReturnValue({
      accountId: 'cf-acc',
      token: 'cf-token',
      deliveryHash: 'delivery-hash',
      variant: 'public',
    });
    tokenFingerprint.mockReturnValue('fingerprint');
    verifyCloudflareToken.mockImplementation(async () => {
      cloudflareCallOrder.push('verify');
    });
    uploadToCloudflareImages.mockImplementation(async () => {
      cloudflareCallOrder.push('upload');
      return { imageId: 'img-reupload', url: 'https://cdn.example/reupload' };
    });
    formatUploadError.mockImplementation((err) => ({
      message: err?.message || 'Upload failed',
    }));
  });

  test('POST /api/scheduled-posts rejects invalid schedule_time and skips inserts', async () => {
    const { app, pool } = await createApp();

    const res = await request(app)
      .post('/api/scheduled-posts')
      .send([
        { image_url: 'https://cdn.example/file.jpg', schedule_time: 'not-a-date', timezone: 'UTC' },
      ])
      .expect(400);

    expect(res.body.scheduleResults[0]).toMatchObject({
      status: 'skipped',
      reason: 'Invalid schedule_time',
    });
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM bulk_schedule_items');
    expect(count.rows[0].count).toBe(0);
  });

  test('POST /api/scheduled-posts stores timezone and destination data', async () => {
    const { app, pool } = await createApp();
    const schedule = '2024-07-01T10:00:00-05:00';

    const res = await request(app)
      .post('/api/scheduled-posts')
      .send([
        {
          image_url: 'https://cdn.example/photo.jpg',
          caption: 'hello world',
          schedule_time: schedule,
          timezone: 'America/Chicago',
          destination: 'both',
          source_filename: 'photo.jpg',
        },
      ])
      .expect(201);

    const saved = res.body.posts[0];
    expect(saved.destination).toBe('both');
    expect(saved.timezone).toBe('America/Chicago');
    expect(saved.schedule_time).toBe(new Date(schedule).toISOString());

    const dbRow = await pool.query(
      'SELECT destination, timezone, schedule_time FROM bulk_schedule_items WHERE id=$1',
      [saved.id],
    );
    expect(dbRow.rows[0].destination).toBe('both');
    expect(dbRow.rows[0].timezone).toBe('America/Chicago');
    expect(new Date(dbRow.rows[0].schedule_time).toISOString()).toBe(
      new Date(schedule).toISOString(),
    );
  });

  test('POST /api/scheduled-posts retries missing uploads through Cloudflare before persisting', async () => {
    const { app } = await createApp();
    const batchId = 'retry-123';
    saveBatch(batchId, {
      items: [
        {
          retryData: {
            buffer: Buffer.from('filedata'),
            mimetype: 'image/jpeg',
            filename: 'retry.jpg',
          },
        },
      ],
    });

    const res = await request(app)
      .post('/api/scheduled-posts')
      .send({
        retryMissingUploads: true,
        batchId,
        posts: [
          {
            image_url: null,
            caption: 'needs upload',
            schedule_time: '2024-07-02T10:00:00Z',
            destination: 'post',
          },
        ],
      })
      .expect(201);

    expect(cloudflareCallOrder).toEqual(['verify', 'upload']);
    expect(uploadToCloudflareImages).toHaveBeenCalledTimes(1);
    expect(res.body.reuploadResults[0]).toMatchObject({
      status: 'success',
      image_url: 'https://cdn.example/reupload',
    });
    expect(res.body.posts[0].image_url_cf).toBe('https://cdn.example/reupload');
  });

  test('GET /api/bulk-schedule applies status and destination filters', async () => {
    const { app, pool } = await createApp();
    await pool.query(
      `INSERT INTO bulk_schedule_items (image_url_cf, destination, local_status, post_status, message_status, caption)
       VALUES
       ('https://cdn/1.jpg', 'post', 'queued', 'queued', NULL, 'first'),
       ('https://cdn/2.jpg', 'message', 'queued', NULL, 'queued', 'second'),
       ('https://cdn/3.jpg', 'both', 'sent', 'sent', 'sent', 'third')`,
    );

    const res = await request(app)
      .get('/api/bulk-schedule?status=queued&destination=message')
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].caption).toBe('second');
    expect(res.body.items[0].destination).toBe('message');

    const logs = await pool.query(
      'SELECT event FROM bulk_logs WHERE event=$1 ORDER BY id DESC LIMIT 1',
      ['load:items'],
    );
    expect(logs.rowCount).toBe(1);
  });

  test('POST /api/bulk-send uploads single-use media per destination and leaves items queued by default', async () => {
    const { app, pool, ofApi } = await createApp();
    const insertRes = await pool.query(
      `INSERT INTO bulk_schedule_items (image_url_cf, destination, local_status, caption, source_filename, schedule_time, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        'https://cdn.example/file.jpg',
        'both',
        'scheduled',
        'caption',
        'upload',
        '2025-01-02T12:00:00Z',
        'UTC',
      ],
    );
    const itemId = insertRes.rows[0].id;

    axios.get.mockResolvedValue({
      data: Buffer.from('filedata'),
      headers: { 'content-type': 'image/jpeg' },
    });

    const callOrder = [];
    ofApi.post.mockImplementation((url, body) => {
      callOrder.push(url);
      if (url.includes('/media/upload')) {
        const suffix = body._streams.find((s) => typeof s === 'string' && s.includes('filename='));
        const mediaId = suffix.includes('-message') ? 111 : 222;
        return Promise.resolve({ data: { media: { id: mediaId } } });
      }
      if (url.includes('/mass-messaging')) {
        return Promise.resolve({ data: { messageId: 300, queue_id: 301, status: 'queued' } });
      }
      if (url === '/acc1/posts') {
        return Promise.resolve({
          data: { queue_id: 401, post_id: 400, status: 'draft' },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });
    ofApi.get.mockImplementation((url, config = {}) => {
      if (url.includes('/following/active')) {
        callOrder.push([url, config.params]);
        expect(config.params).toEqual({ limit: 5, offset: 0 });
        return Promise.resolve({ data: { data: { list: [{ id: 1 }, { id: 2 }], hasMore: false } } });
      }
      if (url === '/acc1/queue/counts') {
        callOrder.push([url, config.params]);
        expect(config.params).toEqual({
          publishDateStart: '2025-01-02',
          publishDateEnd: '2025-01-02',
          timezone: 'UTC',
        });
        return Promise.resolve({
          data: {
            data: {
              list: { '2025-01-02': { post: 1, chat: 1 } },
              syncInProcess: false,
            },
          },
        });
      }
      if (url === '/acc1/queue') {
        callOrder.push([url, config.params]);
        expect(config.params).toEqual({
          publishDateStart: '2025-01-02',
          publishDateEnd: '2025-01-02',
          timezone: 'UTC',
          limit: 20,
        });
        return Promise.resolve({
          data: {
            data: {
              list: [
                { id: 401, type: 'post', entity: { queueId: 401 } },
                { id: 301, type: 'chat', entity: { queueId: 301 } },
              ],
              syncInProcess: false,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    ofApi.put.mockImplementation(() => Promise.reject(new Error('PUT should not be called')));

    const res = await request(app)
      .post('/api/bulk-send')
      .send({ itemIds: [itemId] })
      .expect(200);

    const result = res.body.results[0];
    expect(result.status).toBe('queued');
    expect(result.item.post_status).toBe('queued');
    expect(result.item.message_status).toBe('queued');

    const uploads = ofApi.post.mock.calls.filter(([url]) => url.includes('/media/upload'));
    expect(uploads).toHaveLength(2);
    const filenames = uploads.map(([, form]) =>
      form._streams.find((s) => typeof s === 'string' && s.includes('filename=')),
    );
    expect(filenames[0]).toContain('-message');
    expect(filenames[1]).toContain('-post');

    expect(callOrder).toEqual([
      '/acc1/media/upload',
      ['/acc1/following/active', { limit: 5, offset: 0 }],
      '/acc1/mass-messaging',
      '/acc1/media/upload',
      '/acc1/posts',
      [
        '/acc1/queue/counts',
        { publishDateStart: '2025-01-02', publishDateEnd: '2025-01-02', timezone: 'UTC' },
      ],
      [
        '/acc1/queue',
        {
          publishDateStart: '2025-01-02',
          publishDateEnd: '2025-01-02',
          timezone: 'UTC',
          limit: 20,
        },
      ],
    ]);
  });

  test('POST /api/bulk-send optionally publishes queue items when requested', async () => {
    const { app, pool, ofApi } = await createApp();
    const insertRes = await pool.query(
      `INSERT INTO bulk_schedule_items (image_url_cf, destination, local_status, caption, source_filename, schedule_time, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        'https://cdn.example/file.jpg',
        'post',
        'scheduled',
        'caption',
        'upload',
        '2025-01-02T12:00:00Z',
        'UTC',
      ],
    );
    const itemId = insertRes.rows[0].id;

    axios.get.mockResolvedValue({
      data: Buffer.from('filedata'),
      headers: { 'content-type': 'image/jpeg' },
    });

    const callOrder = [];
    ofApi.post.mockImplementation((url, body) => {
      callOrder.push(url);
      if (url.includes('/media/upload')) {
        return Promise.resolve({ data: { media: { id: 222 } } });
      }
      if (url === '/acc1/posts') {
        return Promise.resolve({
          data: { queue_id: 401, post_id: 400, status: 'draft' },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });
    ofApi.put.mockImplementation((url) => {
      callOrder.push(url);
      if (url === '/acc1/queue/401/publish') {
        return Promise.resolve({
          data: { data: { queue: { id: 401, postId: 400, status: 'queued' } } },
        });
      }
      return Promise.reject(new Error(`Unexpected PUT ${url}`));
    });
    ofApi.get.mockImplementation((url, config = {}) => {
      if (url === '/acc1/queue/counts') {
        callOrder.push([url, config.params]);
        expect(config.params).toEqual({
          publishDateStart: '2025-01-02',
          publishDateEnd: '2025-01-02',
          timezone: 'UTC',
        });
        return Promise.resolve({
          data: {
            data: { list: { '2025-01-02': { post: 1 } }, syncInProcess: false },
          },
        });
      }
      if (url === '/acc1/queue') {
        callOrder.push([url, config.params]);
        expect(config.params).toEqual({
          publishDateStart: '2025-01-02',
          publishDateEnd: '2025-01-02',
          timezone: 'UTC',
          limit: 20,
        });
        return Promise.resolve({
          data: {
            data: {
              list: [],
              syncInProcess: false,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    const res = await request(app)
      .post('/api/bulk-send')
      .send({ itemIds: [itemId], publish: true })
      .expect(200);

    const result = res.body.results[0];
    expect(result.status).toBe('sent');
    expect(result.item.post_status).toBe('sent');
    expect(callOrder).toEqual([
      '/acc1/media/upload',
      '/acc1/posts',
      '/acc1/queue/401/publish',
      [
        '/acc1/queue/counts',
        { publishDateStart: '2025-01-02', publishDateEnd: '2025-01-02', timezone: 'UTC' },
      ],
      [
        '/acc1/queue',
        {
          publishDateStart: '2025-01-02',
          publishDateEnd: '2025-01-02',
          timezone: 'UTC',
          limit: 20,
        },
      ],
    ]);
  });

  test('POST /api/bulk-send uses v1 upload endpoint when configured', async () => {
    const { app, pool, ofApi } = await createApp({ useV1MediaUpload: true });
    const insertRes = await pool.query(
      `INSERT INTO bulk_schedule_items (image_url_cf, destination, local_status, caption, source_filename, schedule_time, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        'https://cdn.example/file.jpg',
        'post',
        'scheduled',
        'caption',
        'upload',
        '2025-01-02T12:00:00Z',
        'UTC',
      ],
    );
    const itemId = insertRes.rows[0].id;

    axios.get.mockResolvedValue({
      data: Buffer.from('filedata'),
      headers: { 'content-type': 'image/jpeg' },
    });

    ofApi.post.mockImplementation((url) => {
      if (url.includes('upload-media-to-the-only-fans-cdn')) {
        return Promise.resolve({ data: { media: { id: 555 } } });
      }
      if (url === '/acc1/posts') {
        return Promise.resolve({
          data: { data: { queue_id: 778, post_id: 777, status: 'queued' } },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });
    ofApi.put.mockImplementation(() => Promise.reject(new Error('Unexpected PUT')));
    ofApi.get.mockImplementation((url, config = {}) => {
      if (url === '/acc1/queue/counts') {
        expect(config.params).toEqual({
          publishDateStart: '2025-01-02',
          publishDateEnd: '2025-01-02',
          timezone: 'UTC',
        });
        return Promise.resolve({
          data: { data: { list: { '2025-01-02': { post: 1 } }, syncInProcess: false } },
        });
      }
      if (url === '/acc1/queue') {
        expect(config.params).toEqual({
          publishDateStart: '2025-01-02',
          publishDateEnd: '2025-01-02',
          timezone: 'UTC',
          limit: 20,
        });
        return Promise.resolve({
          data: { data: { list: [{ id: 778, type: 'post', entity: { queueId: 778 } }] } },
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    const res = await request(app)
      .post('/api/bulk-send')
      .send({ itemIds: [itemId] })
      .expect(200);

    expect(res.body.results[0].status).toBe('queued');
    const uploadCalls = ofApi.post.mock.calls.filter(([url]) =>
      url.includes('upload-media-to-the-only-fans-cdn'),
    );
    expect(uploadCalls).toHaveLength(1);
    expect(ofApi.post.mock.calls.find(([url]) => url.includes('/acc1/media/upload'))).toBeUndefined();
  });

  test('POST /api/bulk-send reports per-destination failures without reusing uploads', async () => {
    const { app, pool, ofApi } = await createApp();
    const insertRes = await pool.query(
      `INSERT INTO bulk_schedule_items (image_url_cf, destination, local_status, caption, source_filename)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['https://cdn.example/file.jpg', 'both', 'scheduled', 'caption', 'upload'],
    );
    const itemId = insertRes.rows[0].id;

    axios.get.mockResolvedValue({
      data: Buffer.from('filedata'),
      headers: { 'content-type': 'image/jpeg' },
    });

    ofApi.post.mockImplementation((url) => {
      if (url.includes('/media/upload')) {
        return Promise.resolve({ data: { media: { id: 123 } } });
      }
      if (url.includes('/mass-messaging')) {
        const err = new Error('message failed');
        err.response = { status: 500, data: { error: 'boom' } };
        return Promise.reject(err);
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });
    ofApi.get.mockResolvedValue({ data: { list: [{ id: 1 }] } });

    const res = await request(app)
      .post('/api/bulk-send')
      .send({ itemIds: [itemId] })
      .expect(200);

    const result = res.body.results[0];
    expect(result.status).toBe('error');
    expect(ofApi.post.mock.calls.filter(([url]) => url.includes('/media/upload')).length).toBe(1);

    const row = await pool.query(
      'SELECT local_status, post_status, message_status FROM bulk_schedule_items WHERE id=$1',
      [itemId],
    );
    expect(row.rows[0].local_status).toBe('error');
    expect(row.rows[0].message_status).toBe('error');
    expect(row.rows[0].post_status).toBe('error');
  });

  test('GET /api/bulk-logs returns filtered item logs and global logs', async () => {
    const { app, pool } = await createApp();
    await pool.query(
      `INSERT INTO bulk_schedule_items (id, image_url_cf, destination, local_status)
       VALUES (10, 'https://cdn.example/log.jpg', 'post', 'queued')`,
    );
    await pool.query(
      `INSERT INTO bulk_logs (item_id, level, event, message, meta)
       VALUES (10, 'info', 'send:start', 'starting', '{}'::jsonb),
              (NULL, 'error', 'global', 'oops', '{}'::jsonb)`,
    );

    const res = await request(app)
      .get('/api/bulk-logs?itemId=10&page=1&pageSize=5')
      .expect(200);

    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].item_id).toBe(10);
    expect(res.body.logs[0].event).toBe('send:start');
    expect(res.body.globals.find((g) => g.event === 'global')).toBeDefined();
  });
});
