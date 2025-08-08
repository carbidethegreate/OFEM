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

const createTableQuery = `
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
    isSubscribed BOOLEAN,
    subscribedBy TEXT,
    subscribedOn TEXT,
    subscribedUntil TEXT,
    renewedAd BOOLEAN,
    isFriend BOOLEAN,
    tipsSum INTEGER,
    postsCount INTEGER,
    photosCount INTEGER,
    videosCount INTEGER,
    audiosCount INTEGER,
    mediaCount INTEGER,
    subscribersCount INTEGER,
    favoritesCount INTEGER,
    avatarThumbs JSONB,
    headerSize JSONB,
    headerThumbs JSONB,
    listsStates JSONB,
    subscribedByData JSONB,
    subscribedOnData JSONB,
    promoOffers JSONB,
    parker_name TEXT,
    is_custom BOOLEAN DEFAULT FALSE,
    updatedAt TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

let app;

async function runParkerUpdate() {
  const res = await request(app).post('/api/updateParkerNames').expect(200);
  expect(res.body.started).toBe(true);
  await new Promise((r) => setTimeout(r, 0));
}

beforeAll(async () => {
  process.env.ONLYFANS_API_KEY = 'test';
  process.env.OPENAI_API_KEY = 'test';
  await pool.query(createTableQuery);
  app = require('../server');
});

beforeEach(async () => {
  await pool.query('DELETE FROM fans');
  mockAxios.get.mockReset();
  mockAxios.post.mockReset();
});

test('returns 401 when OnlyFans API returns 401', async () => {
  mockAxios.get
    .mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } })
    .mockRejectedValueOnce({ response: { status: 401 } });

  const res = await request(app).post('/api/refreshFans').expect(401);
  expect(res.body).toEqual({
    error: 'Invalid or expired OnlyFans API key.',
  });
});

test('returns OnlyFans error message when available on auth failures', async () => {
  mockAxios.get
    .mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } })
    .mockRejectedValueOnce({
      response: { status: 403, data: { error: 'Account suspended' } },
    });

  const res = await request(app).post('/api/refreshFans').expect(401);
  expect(res.body).toEqual({ error: 'Account suspended' });
});

test('inserts and retrieves fan with new columns', async () => {
  const ts = 1691000000;
  const iso = new Date(ts * 1000).toISOString();
  const fanData = {
    id: 1,
    username: 'user1',
    name: 'Profile One',
    avatar: 'avatar1',
    website: 'https://example.com',
    lastSeen: ts,
    isSubscribed: false,
    tipsSum: 100,
    avatarThumbs: { foo: 1 },
  };

  mockAxios.get
    .mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } });

  const refreshRes = await request(app).post('/api/refreshFans').expect(200);
  expect(refreshRes.body.fans).toHaveLength(1);
  expect(refreshRes.body.fans[0].parker_name).toBeNull();

  mockAxios.post.mockResolvedValueOnce({
    data: { choices: [{ message: { content: 'Alice' } }] },
  });

  await runParkerUpdate();

  const res = await request(app).get('/api/fans').expect(200);
  expect(res.body.fans).toHaveLength(1);
  const fan = res.body.fans[0];
  expect(fan).toMatchObject({
    id: 1,
    username: 'user1',
    avatar: 'avatar1',
    website: 'https://example.com',
    isSubscribed: false,
    tipsSum: 100,
    avatarThumbs: { foo: 1 },
    parker_name: 'Alice',
    is_custom: false,
  });
  expect(fan.lastSeen).toBe(iso);
});

test('updates existing fan fields', async () => {
  const ts = 1691000000;
  const fanData1 = {
    id: 1,
    username: 'user1',
    name: 'Profile One',
    avatar: 'avatar1',
    website: 'https://example.com',
    lastSeen: ts,
    isSubscribed: false,
    tipsSum: 100,
    avatarThumbs: { foo: 1 },
  };
  const fanData2 = {
    ...fanData1,
    avatar: 'avatar2',
    website: 'https://new.example.com',
    isSubscribed: true,
    tipsSum: 200,
    avatarThumbs: { foo: 2 },
  };

  mockAxios.post.mockResolvedValueOnce({
    data: { choices: [{ message: { content: 'Alice' } }] },
  });

  mockAxios.get
    // first call for insert
    .mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData1] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData1] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } })
    // second call for update
    .mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData2] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData2] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } });

  const insertRes = await request(app).post('/api/refreshFans').expect(200); // insert
  expect(insertRes.body.fans).toHaveLength(1);

  await runParkerUpdate();

  const updateRes = await request(app).post('/api/refreshFans').expect(200); // update
  expect(updateRes.body.fans[0]).toMatchObject({
    avatar: 'avatar2',
    website: 'https://new.example.com',
    parker_name: 'Alice',
  });

  const res = await request(app).get('/api/fans').expect(200);
  expect(res.body.fans).toHaveLength(1);
  const fan = res.body.fans[0];
  expect(fan).toMatchObject({
    avatar: 'avatar2',
    website: 'https://new.example.com',
    isSubscribed: true,
    tipsSum: 200,
    avatarThumbs: { foo: 2 },
    parker_name: 'Alice',
  });
});

test('upserts followings with Parker names', async () => {
  const fanData = { id: 1, username: 'user1', name: 'Profile One' };
  const followingData = { id: 2, username: 'user2', name: 'Profile Two' };

  mockAxios.get
    .mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } })
    .mockResolvedValueOnce({ data: { data: { list: [followingData] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } });

  const refreshRes = await request(app).post('/api/refreshFans').expect(200);
  expect(refreshRes.body.fans).toHaveLength(2);
  expect(refreshRes.body.fans.every((f) => f.parker_name === null)).toBe(true);

  mockAxios.post
    .mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Alice' } }] },
    })
    .mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Bob' } }] },
    });

  await runParkerUpdate();

  const res = await request(app).get('/api/fans').expect(200);
  expect(res.body.fans).toHaveLength(2);
  const fanDb = res.body.fans.find((f) => f.id === 1);
  const followingDb = res.body.fans.find((f) => f.id === 2);
  expect(fanDb.parker_name).toBe('Alice');
  expect(followingDb.parker_name).toBe('Bob');
});

test('merges fans and followings without duplication', async () => {
  const fanData = {
    id: 1,
    username: 'user1',
    name: 'Profile One',
    avatar: 'a1',
    isSubscribed: false,
  };
  const followingDuplicate = { ...fanData, avatar: 'a2', isSubscribed: true };
  const followingData = {
    id: 2,
    username: 'user2',
    name: 'Profile Two',
    avatar: 'b1',
  };

  mockAxios.get
    .mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } })
    .mockResolvedValueOnce({
      data: { data: { list: [followingDuplicate, followingData] } },
    })
    .mockResolvedValueOnce({ data: { data: { list: [] } } });

  const refreshRes = await request(app).post('/api/refreshFans').expect(200);
  expect(refreshRes.body.fans).toHaveLength(2);
  expect(refreshRes.body.fans.every((f) => f.parker_name === null)).toBe(true);

  mockAxios.post
    .mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Alice' } }] },
    })
    .mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Bob' } }] },
    });

  await runParkerUpdate();

  const res = await request(app).get('/api/fans').expect(200);
  expect(res.body.fans).toHaveLength(2);
  const fanDb = res.body.fans.find((f) => f.id === 1);
  const followingDb = res.body.fans.find((f) => f.id === 2);
  expect(fanDb).toMatchObject({
    avatar: 'a2',
    isSubscribed: true,
    parker_name: 'Alice',
  });
  expect(followingDb).toMatchObject({ username: 'user2', parker_name: 'Bob' });
  expect(res.body.fans.filter((f) => f.id === 1)).toHaveLength(1);
});

test('fetches active fans and followings when filter is active', async () => {
  const fanData = { id: 1, username: 'user1', name: 'Profile One' };
  const followingData = { id: 2, username: 'user2', name: 'Profile Two' };

  mockAxios.get
    .mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } })
    .mockResolvedValueOnce({ data: { data: { list: [followingData] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } });

  const refreshRes = await request(app)
    .post('/api/refreshFans?filter=active')
    .expect(200);
  expect(refreshRes.body.fans).toHaveLength(2);
  expect(refreshRes.body.fans.every((f) => f.parker_name === null)).toBe(true);

  mockAxios.post
    .mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Alice' } }] },
    })
    .mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Bob' } }] },
    });

  await runParkerUpdate();

  expect(mockAxios.get.mock.calls[1][0]).toBe('/acc1/fans/active');
  expect(mockAxios.get.mock.calls[3][0]).toBe('/acc1/following/active');

  const res = await request(app).get('/api/fans').expect(200);
  expect(res.body.fans).toHaveLength(2);
  expect(res.body.fans.map((f) => f.parker_name).sort()).toEqual([
    'Alice',
    'Bob',
  ]);
});

test('retries OpenAI 500 errors and continues processing other fans', async () => {
  await pool.query(
    `INSERT INTO fans (id, username, name) VALUES (1, 'user1', 'Profile One'), (2, 'user2', 'Profile Two')`,
  );

  const counts = { user1: 0 };
  mockAxios.post.mockImplementation((url, body) => {
    const prompt = body.messages[1].content;
    if (prompt.includes('user1')) {
      counts.user1++;
      return Promise.reject({
        response: { status: 500, headers: { 'retry-after': '0' } },
      });
    }
    return Promise.resolve({
      data: { choices: [{ message: { content: 'Bob' } }] },
    });
  });

  await runParkerUpdate();
  await new Promise((r) => setTimeout(r, 0));

  const res = await request(app).get('/api/fans').expect(200);
  const fan1 = res.body.fans.find((f) => f.id === 1);
  const fan2 = res.body.fans.find((f) => f.id === 2);
  expect(fan1.parker_name).toBeNull();
  expect(fan2.parker_name).toBe('Bob');
  expect(counts.user1).toBeGreaterThan(1);
});

test('POST /api/fans/followAll streams progress and updates DB', async () => {
  await pool.query(
    `INSERT INTO fans (id, username, isSubscribed) VALUES (1, 'user1', false), (2, 'user2', false)`,
  );

  mockAxios.get.mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValue({ data: {} });

  const res = await request(app).post('/api/fans/followAll').expect(200);
  expect(mockAxios.post).toHaveBeenCalledTimes(2);
  expect(res.text).toContain('"id":1');
  expect(res.text).toContain('"id":2');
  expect(res.text).toContain('"done":true');

  const dbRes = await pool.query(
    'SELECT id, isSubscribed FROM fans ORDER BY id',
  );
  expect(dbRes.rows).toEqual([
    { id: 1, issubscribed: true },
    { id: 2, issubscribed: true },
  ]);
});

test('updateParkerNames status endpoint reflects progress', async () => {
  await pool.query("INSERT INTO fans (id, username) VALUES (1, 'user1')");

  mockAxios.post.mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({ data: { choices: [{ message: { content: 'Alice' } }] } }),
          50,
        ),
      ),
  );

  const startRes = await request(app)
    .post('/api/updateParkerNames')
    .expect(200);
  expect(startRes.body.started).toBe(true);

  const statusDuring = await request(app)
    .get('/api/updateParkerNames/status')
    .expect(200);
  expect(statusDuring.body.inProgress).toBe(true);

  await new Promise((r) => setTimeout(r, 60));

  const statusAfter = await request(app)
    .get('/api/updateParkerNames/status')
    .expect(200);
  expect(statusAfter.body.inProgress).toBe(false);
});
