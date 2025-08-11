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

beforeAll(() => {
  process.env.ONLYFANS_API_KEY = 'test';
  process.env.OPENAI_API_KEY = 'test';
  app = require('../server');
});

test('returns logged entries', async () => {
  console.log('hello log');
  console.error('error log');
  const res = await request(app).get('/api/logs').expect(200);
  const msgs = res.body.logs.map((l) => l.msg);
  expect(msgs.some((m) => m.includes('hello log'))).toBe(true);
  expect(msgs.some((m) => m.includes('error log'))).toBe(true);
});
