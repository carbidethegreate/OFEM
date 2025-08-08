const { JSDOM } = require('jsdom');
const { newDb } = require('pg-mem');
const mem = newDb();
const pg = mem.adapters.createPg();
const mockPool = new pg.Pool();

jest.mock('../db', () => mockPool);
jest.mock('axios');

const request = require('supertest');
const mockAxios = require('axios');
const pool = require('../db');

mockAxios.create.mockReturnValue(mockAxios);

let app;

beforeAll(async () => {
  process.env.ONLYFANS_API_KEY = 'test';
  process.env.OPENAI_API_KEY = 'test';
  await pool.query(`
    CREATE TABLE fans (
      id BIGINT PRIMARY KEY,
      username TEXT,
      isSubscribed BOOLEAN
    );
  `);
  app = require('../server');
});

beforeEach(async () => {
  await pool.query('DELETE FROM fans');
  mockAxios.get.mockReset();
  mockAxios.post.mockReset();
});

test('GET /api/fans/unfollowed returns only unsubscribed fans', async () => {
  await pool.query(
    "INSERT INTO fans (id, username, isSubscribed) VALUES (1, 'user1', false), (2, 'user2', true)",
  );

  const res = await request(app).get('/api/fans/unfollowed').expect(200);
  expect(res.body.fans).toEqual([{ id: 1, username: 'user1' }]);
});

test('POST /api/fans/:id/follow calls OnlyFans API and updates DB', async () => {
  await pool.query(
    "INSERT INTO fans (id, username, isSubscribed) VALUES (1, 'user1', false)",
  );

  mockAxios.get.mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValueOnce({ data: {} });

  await request(app).post('/api/fans/1/follow').expect(200);

  expect(mockAxios.post).toHaveBeenCalledWith('/acc1/users/1/follow');
  const dbRes = await pool.query('SELECT isSubscribed FROM fans WHERE id=1');
  expect(dbRes.rows[0].issubscribed).toBe(true);
});

test('renderTable displays a message when there are no fans to follow', async () => {
  jest.resetModules();
  const dom = new JSDOM(
    '<table><tbody id="followTableBody"></tbody></table><div id="statusMsg"></div><button id="followBtn"></button>',
  );
  global.window = dom.window;
  global.document = dom.window.document;
  const fetchMock = jest
    .fn()
    .mockResolvedValue({ ok: true, json: () => Promise.resolve({ fans: [] }) });
  global.fetch = dom.window.fetch = fetchMock;
  const alertMock = jest.fn();
  global.alert = dom.window.alert = alertMock;
  const { renderTable } = require('../public/follow');
  renderTable();
  await Promise.resolve();
  expect(
    dom.window.document.getElementById('statusMsg').textContent,
  ).toMatch(/no fans to follow/i);
});
