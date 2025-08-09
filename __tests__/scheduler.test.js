const { newDb } = require('pg-mem');
const mem = newDb();
const pg = mem.adapters.createPg();
const mockPool = new pg.Pool();

jest.mock('../db', () => mockPool);
jest.mock('axios');
const mockAxios = require('axios');
mockAxios.create.mockReturnValue(mockAxios);

let app;
let processRecurringPPVs;

beforeAll(async () => {
  process.env.ONLYFANS_API_KEY = 'test';
  process.env.OPENAI_API_KEY = 'test';
  process.env.DB_NAME = 'testdb';
  process.env.DB_USER = 'user';
  process.env.DB_PASSWORD = 'pass';

  await mockPool.query(`
    CREATE TABLE fans (
      id BIGSERIAL PRIMARY KEY,
      username TEXT,
      isSubscribed BOOLEAN,
      canReceiveChatMessage BOOLEAN
    );
  `);

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

  await mockPool.query(`
    CREATE TABLE messages (
      fan_id BIGINT,
      direction TEXT,
      body TEXT,
      price NUMERIC
    );
  `);

  app = require('../server');
  ({ processRecurringPPVs } = app);
});

beforeEach(async () => {
  await mockPool.query('DELETE FROM ppv_media');
  await mockPool.query('DELETE FROM ppv_sets');
  await mockPool.query('DELETE FROM fans');
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

test('recurring PPVs send once per fan per month across cycles', async () => {
  await mockPool.query(
    `INSERT INTO fans (id, isSubscribed, canReceiveChatMessage) VALUES (1, TRUE, TRUE), (2, TRUE, TRUE);`,
  );
  await mockPool.query(
    `INSERT INTO ppv_sets (id, description, message, price, schedule_day, schedule_time) VALUES (1, 'desc', 'msg', 5, 15, '10:05');`,
  );
  await mockPool.query(
    `INSERT INTO ppv_media (ppv_id, media_id, is_preview) VALUES (1, 100, FALSE);`,
  );

  jest.useFakeTimers();
  const sendSpy = jest.fn().mockResolvedValue();
  app._setSendMessageToFan(sendSpy);
  mockAxios.get.mockResolvedValue({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValue({ data: {} });

  async function runScheduler() {
    const promise = processRecurringPPVs();
    await jest.runAllTimersAsync();
    return promise;
  }

  jest.setSystemTime(new Date('2024-01-15T10:05:00Z'));
  await runScheduler();
  expect(sendSpy).toHaveBeenCalledTimes(2);

  await runScheduler();
  expect(sendSpy).toHaveBeenCalledTimes(2);

  jest.setSystemTime(new Date('2024-02-15T10:05:00Z'));
  await runScheduler();
  expect(sendSpy).toHaveBeenCalledTimes(4);

  await runScheduler();
  expect(sendSpy).toHaveBeenCalledTimes(4);

  jest.setSystemTime(new Date('2024-03-15T10:05:00Z'));
  await runScheduler();
  expect(sendSpy).toHaveBeenCalledTimes(6);
});

test('sends PPV media from associated vault list', async () => {
  await mockPool.query(
    `INSERT INTO fans (id, isSubscribed, canReceiveChatMessage) VALUES (1, TRUE, TRUE);`,
  );
  await mockPool.query(
    `INSERT INTO ppv_sets (id, message, price, vault_list_id, schedule_day, schedule_time) VALUES (1, 'hello', 10, 123, 15, '10:05');`,
  );
  await mockPool.query(
    `INSERT INTO ppv_media (ppv_id, media_id, is_preview) VALUES (1, 111, FALSE), (1, 222, FALSE);`,
  );

  jest.useFakeTimers();
  const sendSpy = jest.fn().mockResolvedValue();
  app._setSendMessageToFan(sendSpy);

  async function runScheduler() {
    const promise = processRecurringPPVs();
    await jest.runAllTimersAsync();
    return promise;
  }

  jest.setSystemTime(new Date('2024-01-15T10:05:00Z'));
  await runScheduler();

  expect(sendSpy).toHaveBeenCalledWith(
    1,
    '',
    'hello',
    10,
    false,
    [111, 222],
    [],
  );
  jest.useRealTimers();
  const res = await mockPool.query(
    'SELECT last_sent_at FROM ppv_sets WHERE id=1',
  );
  expect(res.rows[0].last_sent_at).not.toBeNull();
});

test('includes preview media when sending paywalled PPVs', async () => {
  await mockPool.query(
    `INSERT INTO fans (id, isSubscribed, canReceiveChatMessage) VALUES (1, TRUE, TRUE);`,
  );
  await mockPool.query(
    `INSERT INTO ppv_sets (id, message, price, schedule_day, schedule_time) VALUES (1, 'hi', 7, 15, '10:05');`,
  );
  await mockPool.query(
    `INSERT INTO ppv_media (ppv_id, media_id, is_preview) VALUES (1, 10, FALSE), (1, 20, TRUE);`,
  );

  jest.useFakeTimers();
  const sendSpy = jest.fn().mockResolvedValue();
  app._setSendMessageToFan(sendSpy);

  async function runScheduler() {
    const promise = processRecurringPPVs();
    await jest.runAllTimersAsync();
    return promise;
  }

  jest.setSystemTime(new Date('2024-01-15T10:05:00Z'));
  await runScheduler();

  expect(sendSpy).toHaveBeenCalledWith(
    1,
    '',
    'hi',
    7,
    false,
    [10, 20],
    [20],
  );
});
