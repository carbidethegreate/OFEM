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
      price NUMERIC NOT NULL,
      vault_list_id BIGINT,
      schedule_day INTEGER,
      schedule_time TEXT,
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
      description: 'desc',
      price: 5,
      mediaFiles: [1],
      previews: [],
      scheduleDay: 15,
      scheduleTime: '13:30'
    });

  expect(res.status).toBe(201);
  expect(res.body.ppv.scheduleDay).toBe(15);
  expect(res.body.ppv.scheduleTime).toBe('13:30');
});

test('rejects invalid scheduleDay', async () => {
  const res = await request(app)
    .post('/api/ppv')
    .send({
      ppvNumber: 1,
      description: 'desc',
      price: 5,
      mediaFiles: [1],
      previews: [],
      scheduleDay: 0,
      scheduleTime: '13:30'
    });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: expect.stringContaining('scheduleDay') });
});

test('rejects invalid scheduleTime', async () => {
  const res = await request(app)
    .post('/api/ppv')
    .send({
      ppvNumber: 1,
      description: 'desc',
      price: 5,
      mediaFiles: [1],
      previews: [],
      scheduleDay: 10,
      scheduleTime: '25:00'
    });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: expect.stringContaining('scheduleTime') });
});

describe('shouldSendNow', () => {
  test('returns false for schedule day beyond February length', () => {
    const ppv = { schedule_day: 31, schedule_time: '10:00', last_sent_at: null };
    const now = new Date('2023-02-28T12:00:00Z');
    expect(shouldSendNow(ppv, now)).toBe(false);
  });

  test('returns false for schedule day beyond April length', () => {
    const ppv = { schedule_day: 31, schedule_time: '10:00', last_sent_at: null };
    const now = new Date('2023-04-30T12:00:00Z');
    expect(shouldSendNow(ppv, now)).toBe(false);
  });
});
