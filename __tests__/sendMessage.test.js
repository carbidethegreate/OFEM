const { newDb } = require('pg-mem');
const mem = newDb();
const pg = mem.adapters.createPg();
const mockPool = new pg.Pool();

jest.mock('../db', () => mockPool);
jest.mock('axios');
jest.mock('openai', () => ({
  Configuration: class {},
  OpenAIApi: jest.fn()
}));

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
  app = require('../server');
});

beforeEach(async () => {
  await mockPool.query('DELETE FROM fans');
  mockAxios.get.mockReset();
  mockAxios.post.mockReset();
});

test('replaces {parker_name} placeholder', async () => {
  await mockPool.query("INSERT INTO fans (id, parker_name, username, location) VALUES (1, 'Alice', 'user1', 'Wonderland')");
  mockAxios.get.mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValueOnce({});
  await request(app)
    .post('/api/sendMessage')
    .send({ userId: 1, greeting: '', body: 'Hello <b>{parker_name}</b>' })
    .expect(200);
  expect(mockAxios.post).toHaveBeenCalledWith('/acc1/chats/1/messages', { text: '<p>Hello Alice</p>' });
});

test('replaces {username} placeholder', async () => {
  await mockPool.query("INSERT INTO fans (id, parker_name, username, location) VALUES (1, 'Alice', 'user1', 'Wonderland')");
  mockAxios.get.mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValueOnce({});
  await request(app)
    .post('/api/sendMessage')
    .send({ userId: 1, greeting: 'Hi {parker_name}!', body: 'Hey <i>{username}</i>' })
    .expect(200);
  expect(mockAxios.post).toHaveBeenCalledWith('/acc1/chats/1/messages', { text: '<p>Hi Alice! Hey user1</p>' });
});

test('replaces {location} placeholder', async () => {
  await mockPool.query("INSERT INTO fans (id, parker_name, username, location) VALUES (1, 'Alice', 'user1', 'Wonderland')");
  mockAxios.get.mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValueOnce({});
  await request(app)
    .post('/api/sendMessage')
    .send({ userId: 1, greeting: '', body: 'From <span>{location}</span>' })
    .expect(200);
  expect(mockAxios.post).toHaveBeenCalledWith('/acc1/chats/1/messages', { text: '<p>From <span>Wonderland</span></p>' });
});

test('inserts <br> for newline characters', async () => {
  await mockPool.query("INSERT INTO fans (id, parker_name, username, location) VALUES (1, 'Alice', 'user1', 'Wonderland')");
  mockAxios.get.mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValueOnce({});
  await request(app)
    .post('/api/sendMessage')
    .send({ userId: 1, greeting: '', body: 'Line1\nLine2' })
    .expect(200);
  expect(mockAxios.post).toHaveBeenCalledWith('/acc1/chats/1/messages', { text: '<p>Line1<br>Line2</p>' });
});

test('keeps <strong> tag for bold formatting', async () => {
  await mockPool.query("INSERT INTO fans (id, parker_name, username, location) VALUES (1, 'Alice', 'user1', 'Wonderland')");
  mockAxios.get.mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValueOnce({});
  await request(app)
    .post('/api/sendMessage')
    .send({ userId: 1, greeting: '', body: 'Hello <strong>{parker_name}</strong>' })
    .expect(200);
  expect(mockAxios.post).toHaveBeenCalledWith('/acc1/chats/1/messages', { text: '<p>Hello <strong>Alice</strong></p>' });
});

test('retains font size class on span', async () => {
  await mockPool.query("INSERT INTO fans (id, parker_name, username, location) VALUES (1, 'Alice', 'user1', 'Wonderland')");
  mockAxios.get.mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValueOnce({});
  await request(app)
    .post('/api/sendMessage')
    .send({ userId: 1, greeting: '', body: 'Size <span class="m-editor-fs__l">{parker_name}</span>' })
    .expect(200);
  expect(mockAxios.post).toHaveBeenCalledWith('/acc1/chats/1/messages', { text: '<p>Size <span class="m-editor-fs__l">Alice</span></p>' });
});

test('retains font color class on span', async () => {
  await mockPool.query("INSERT INTO fans (id, parker_name, username, location) VALUES (1, 'Alice', 'user1', 'Wonderland')");
  mockAxios.get.mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValueOnce({});
  await request(app)
    .post('/api/sendMessage')
    .send({ userId: 1, greeting: '', body: 'Color <span class="m-editor-fc__blue-1">{parker_name}</span>' })
    .expect(200);
  expect(mockAxios.post).toHaveBeenCalledWith('/acc1/chats/1/messages', { text: '<p>Color <span class="m-editor-fc__blue-1">Alice</span></p>' });
});

