const { newDb } = require('pg-mem');
const mem = newDb();
const pg = mem.adapters.createPg();
const mockPool = new pg.Pool();

jest.mock('../db', () => mockPool);
jest.mock('axios');

const request = require('supertest');
const mockAxios = require('axios');
mockAxios.create.mockReturnValue(mockAxios);

let app;
let shouldSendNow;

beforeAll(async () => {
  process.env.ONLYFANS_API_KEY = 'test';
  process.env.OPENAI_API_KEY = 'test';
  process.env.DB_NAME = 'testdb';
  process.env.DB_USER = 'user';
  process.env.DB_PASSWORD = 'pass';
  await mockPool.query(`
    CREATE TABLE ppv_sets (
      id BIGSERIAL PRIMARY KEY,
      ppv_number INTEGER UNIQUE,
      description TEXT,
      message TEXT,
      price NUMERIC NOT NULL,
      vault_list_id BIGINT,
      schedule_day INTEGER,
      schedule_time TEXT,
      last_sent_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await mockPool.query(`
    CREATE TABLE ppv_media (
      ppv_id BIGINT REFERENCES ppv_sets(id) ON DELETE CASCADE,
      media_id BIGINT,
      is_preview BOOLEAN
    );
  `);
  app = require('../server');
  ({ shouldSendNow } = app);
});

beforeEach(async () => {
  await mockPool.query('DELETE FROM ppv_media');
  await mockPool.query('DELETE FROM ppv_sets');
  mockAxios.get.mockReset();
  mockAxios.post.mockReset();
});

test('accepts valid schedule inputs', async () => {
  mockAxios.get.mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post
    .mockResolvedValueOnce({ data: { id: 1 } })
    .mockResolvedValueOnce({});

  const res = await request(app)
    .post('/api/ppv')
    .send({
      ppvNumber: 1,
      message: 'msg',
      price: 5,
      mediaFiles: [1],
      previews: [],
      scheduleDay: 15,
      scheduleTime: '13:30',
    });

  expect(res.status).toBe(201);
  expect(res.body.ppv.scheduleDay).toBe(15);
  expect(res.body.ppv.scheduleTime).toBe('13:30');
  expect(res.body.ppv.message).toBe('msg');
});

test('rejects invalid scheduleDay', async () => {
  const res = await request(app)
    .post('/api/ppv')
    .send({
      ppvNumber: 1,
      message: 'msg',
      price: 5,
      mediaFiles: [1],
      previews: [],
      scheduleDay: 0,
      scheduleTime: '13:30',
    });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: expect.stringContaining('scheduleDay') });
});

test('rejects invalid scheduleTime', async () => {
  const res = await request(app)
    .post('/api/ppv')
    .send({
      ppvNumber: 1,
      message: 'msg',
      price: 5,
      mediaFiles: [1],
      previews: [],
      scheduleDay: 10,
      scheduleTime: '25:00',
    });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: expect.stringContaining('scheduleTime') });
});

test('saves and retrieves message field', async () => {
  mockAxios.get.mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post
    .mockResolvedValueOnce({ data: { id: 1 } })
    .mockResolvedValueOnce({});

  await request(app)
    .post('/api/ppv')
    .send({
      ppvNumber: 2,
      message: 'hello',
      price: 5,
      mediaFiles: [1],
      previews: [],
    });

  const listRes = await request(app).get('/api/ppv');
  expect(listRes.status).toBe(200);
  const ppv = listRes.body.ppvs.find((p) => p.ppv_number === 2);
  expect(ppv).toBeDefined();
  expect(ppv.message).toBe('hello');
});

test('resets last_sent_at when schedule changes', async () => {
  const insertRes = await mockPool.query(
    "INSERT INTO ppv_sets (ppv_number, description, message, price, schedule_day, schedule_time, last_sent_at) VALUES (1,'desc','msg',5,10,'10:00','2024-01-01T00:00:00Z') RETURNING id",
  );
  const id = insertRes.rows[0].id;

  const res = await request(app)
    .put(`/api/ppv/${id}`)
    .send({ scheduleDay: 11, scheduleTime: '12:00' });

  expect(res.status).toBe(200);
  const dbRes = await mockPool.query(
    'SELECT schedule_day, schedule_time, last_sent_at FROM ppv_sets WHERE id=$1',
    [id],
  );
  expect(dbRes.rows[0].schedule_day).toBe(11);
  expect(dbRes.rows[0].schedule_time).toBe('12:00');
  expect(dbRes.rows[0].last_sent_at).toBeNull();
});

test('does not reset last_sent_at when schedule unchanged', async () => {
  const insertRes = await mockPool.query(
    "INSERT INTO ppv_sets (ppv_number, description, message, price, schedule_day, schedule_time, last_sent_at) VALUES (1,'desc','msg',5,10,'10:00','2024-01-01T00:00:00Z') RETURNING id",
  );
  const id = insertRes.rows[0].id;

  const res = await request(app)
    .put(`/api/ppv/${id}`)
    .send({ message: 'new msg' });

  expect(res.status).toBe(200);
  const dbRes = await mockPool.query(
    'SELECT message, last_sent_at FROM ppv_sets WHERE id=$1',
    [id],
  );
  expect(dbRes.rows[0].message).toBe('new msg');
  expect(dbRes.rows[0].last_sent_at).not.toBeNull();
});

describe('shouldSendNow', () => {
  test('returns false for schedule day beyond February length', () => {
    const ppv = {
      schedule_day: 31,
      schedule_time: '10:00',
      last_sent_at: null,
    };
    const now = new Date('2023-02-28T12:00:00Z');
    expect(shouldSendNow(ppv, now)).toBe(false);
  });

  test('returns false for schedule day beyond April length', () => {
    const ppv = {
      schedule_day: 31,
      schedule_time: '10:00',
      last_sent_at: null,
    };
    const now = new Date('2023-04-30T12:00:00Z');
    expect(shouldSendNow(ppv, now)).toBe(false);
  });
});
