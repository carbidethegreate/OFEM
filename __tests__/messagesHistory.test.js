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
  process.env.OPENAI_API_KEY = 'test';
  await mockPool.query(`
    CREATE TABLE fans (
      id BIGINT PRIMARY KEY,
      parker_name TEXT,
      username TEXT,
      location TEXT
    );
  `);
  await mockPool.query(`
    CREATE TABLE messages (
      id BIGINT PRIMARY KEY,
      fan_id BIGINT REFERENCES fans(id),
      direction TEXT,
      body TEXT,
      price NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  app = require('../server');
});

beforeEach(async () => {
  await mockPool.query('DELETE FROM messages');
  await mockPool.query('DELETE FROM fans');
  mockAxios.get.mockReset();
});

test('fetches and upserts message history', async () => {
  await mockPool.query(
    "INSERT INTO fans (id, parker_name, username, location) VALUES (1, 'Alice', 'user1', 'Wonderland')",
  );
  mockAxios.get
    .mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({
      data: {
        messages: [
          {
            id: 10,
            fromUser: { id: 'acc1' },
            text: 'hi',
            price: 0,
            createdAt: 1000,
          },
        ],
      },
    })
    .mockResolvedValueOnce({
      data: {
        messages: [
          {
            id: 10,
            fromUser: { id: 'acc1' },
            text: 'updated',
            price: 1,
            createdAt: 1000,
          },
        ],
      },
    });

  await request(app).get('/api/messages/history?fanId=1&limit=5').expect(200);
  let rows = await mockPool.query(
    'SELECT id, fan_id, body, price FROM messages',
  );
  expect(rows.rows).toEqual([{ id: 10, fan_id: 1, body: 'hi', price: 0 }]);

  await request(app).get('/api/messages/history?fanId=1&limit=5').expect(200);
  rows = await mockPool.query('SELECT id, fan_id, body, price FROM messages');
  expect(rows.rows).toEqual([{ id: 10, fan_id: 1, body: 'updated', price: 1 }]);
});

test('caps limit at 100', async () => {
  await mockPool.query(
    "INSERT INTO fans (id, parker_name, username, location) VALUES (1, 'Alice', 'user1', 'Wonderland')",
  );
  mockAxios.get
    .mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { messages: [] } });

  await request(app)
    .get('/api/messages/history?fanId=1&limit=500')
    .expect(200);

  const lastCall = mockAxios.get.mock.calls[mockAxios.get.mock.calls.length - 1];
  expect(lastCall[0]).toBe('/acc1/chats/1/messages');
  expect(lastCall[1]).toEqual({ params: { limit: 100 } });
});
