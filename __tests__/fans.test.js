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
    avatarThumbs: { foo: 1 }
  };

  mockAxios.post.mockResolvedValueOnce({
    data: { choices: [{ message: { content: 'Alice' } }] }
  });

  mockAxios.get
    .mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } });

  await request(app).post('/api/updateFans').expect(200);

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
    is_custom: false
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
    avatarThumbs: { foo: 1 }
  };
  const fanData2 = {
    ...fanData1,
    avatar: 'avatar2',
    website: 'https://new.example.com',
    isSubscribed: true,
    tipsSum: 200,
    avatarThumbs: { foo: 2 }
  };

  mockAxios.post.mockResolvedValue({
    data: { choices: [{ message: { content: 'Alice' } }] }
  });

  mockAxios.get
    // first call for insert
    .mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData1] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } })
    // second call for update
    .mockResolvedValueOnce({ data: { data: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { data: { list: [fanData2] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } })
    .mockResolvedValueOnce({ data: { data: { list: [] } } });

  await request(app).post('/api/updateFans').expect(200); // insert
  await request(app).post('/api/updateFans').expect(200); // update

  const res = await request(app).get('/api/fans').expect(200);
  expect(res.body.fans).toHaveLength(1);
  const fan = res.body.fans[0];
  expect(fan).toMatchObject({
    avatar: 'avatar2',
    website: 'https://new.example.com',
    isSubscribed: true,
    tipsSum: 200,
    avatarThumbs: { foo: 2 },
    parker_name: 'Alice'
  });
});
