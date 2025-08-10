const { newDb } = require('pg-mem');
const express = require('express');
const request = require('supertest');

const mem = newDb();
const pg = mem.adapters.createPg();
const pool = new pg.Pool();

beforeAll(async () => {
  await pool.query(`
    CREATE TABLE fans (
      id BIGINT PRIMARY KEY,
      username TEXT,
      name TEXT,
      avatar TEXT,
      header TEXT,
      website TEXT,
      location TEXT,
      gender TEXT,
      birthday TEXT,
      about TEXT,
      notes TEXT,
      lastSeen TEXT,
      joined TEXT,
      canReceiveChatMessage BOOLEAN,
      canSendChatMessage BOOLEAN,
      isBlocked BOOLEAN,
      isMuted BOOLEAN,
      isRestricted BOOLEAN,
      isHidden BOOLEAN,
      isBookmarked BOOLEAN,
      isSubscribed BOOLEAN
    );
  `);
});

beforeEach(async () => {
  await pool.query('DELETE FROM fans');
});

function createApp(sendMessageToFan) {
  const app = express();
  app.use(express.json());
  const router = require('../routes/messages')({
    getOFAccountId: jest.fn(),
    ofApiRequest: jest.fn(),
    ofApi: {},
    pool,
    sanitizeError: (e) => e,
    sendMessageToFan,
    getMissingEnvVars: () => [],
  });
  app.use('/api', router);
  return app;
}

describe('POST /api/messages/send', () => {
  it('rejects when text missing', async () => {
    const app = createApp(jest.fn());
    const res = await request(app).post('/api/messages/send').send({});
    expect(res.status).toBe(400);
  });

  it('sends message when fan is subscribed and can receive messages', async () => {
    const sendSpy = jest.fn().mockResolvedValue();
    const app = createApp(sendSpy);
    await pool.query(
      `INSERT INTO fans (id, isSubscribed, canReceiveChatMessage) VALUES (123, TRUE, TRUE);`,
    );
    const res = await request(app)
      .post('/api/messages/send')
      .send({ text: 'Hello world' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledWith(123, '', 'Hello world', 0, '', [], []);
  });

  it('passes lockedText to sendMessageToFan', async () => {
    await pool.query(
      `INSERT INTO fans (id, isSubscribed, canReceiveChatMessage) VALUES (1, TRUE, TRUE);`
    );
    const sendSpy = jest.fn().mockResolvedValue();
    const app = createApp(sendSpy);
    await request(app)
      .post('/api/messages/send')
      .send({ text: 'hi', price: 5, lockedText: 'secret' })
      .expect(200);
    expect(sendSpy).toHaveBeenCalledWith(1, '', 'hi', 5, 'secret', [], []);
  });

  it('returns no recipients resolved when fan cannot receive messages', async () => {
    const app = createApp(jest.fn());
    await pool.query(
      `INSERT INTO fans (id, isSubscribed, canReceiveChatMessage) VALUES (5, TRUE, FALSE);`,
    );
    const res = await request(app)
      .post('/api/messages/send')
      .send({ text: 'hi' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'no recipients resolved',
      diagnostics: { fans_in_db: 1 },
    });
  });
});
