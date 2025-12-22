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

beforeAll(async () => {
  process.env.ONLYFANS_API_KEY = 'test';
  process.env.ONLYFANS_ACCOUNT_ID = 'acc1';
  process.env.OPENAI_API_KEY = 'test';
  await mockPool.query(`
    CREATE TABLE bulk_logs (
      id SERIAL PRIMARY KEY,
      item_id BIGINT,
      level TEXT,
      event TEXT,
      message TEXT,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  app = require('../server');
});

test('returns logged entries', async () => {
  await mockPool.query(
    `INSERT INTO bulk_logs (item_id, level, event, message, meta)
     VALUES (NULL, 'info', 'test:info', 'hello log', '{}'),
            (NULL, 'error', 'test:error', 'error log', '{}')`,
  );
  const res = await request(app).get('/api/logs').expect(200);
  const msgs = res.body.logs.map((l) => l.message);
  expect(msgs).toEqual(expect.arrayContaining(['hello log', 'error log']));
});
