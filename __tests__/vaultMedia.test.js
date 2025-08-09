const mockPool = { query: jest.fn() };
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

beforeEach(() => {
  mockAxios.get.mockReset();
  mockAxios.post.mockReset();
  mockPool.query.mockReset();
});

test('GET /api/vault-media syncs and returns stored media', async () => {
  mockAxios.get
    .mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({
      data: { media: [{ id: 'm1', likes: 1 }, { id: 'm2', likes: 2 }] },
    })
    .mockResolvedValueOnce({ data: { media: [] } });

  mockPool.query
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      rows: [
        {
          id: 'm1',
          likes: 1,
          tips: null,
          thumb_url: null,
          preview_url: null,
          created_at: null,
        },
        {
          id: 'm2',
          likes: 2,
          tips: null,
          thumb_url: null,
          preview_url: null,
          created_at: null,
        },
      ],
    });

  const res = await request(app).get('/api/vault-media').expect(200);

  expect(mockAxios.get).toHaveBeenNthCalledWith(2, '/acc1/media/vault', {
    params: { limit: 100, offset: 0 },
  });
  expect(mockAxios.get).toHaveBeenNthCalledWith(3, '/acc1/media/vault', {
    params: { limit: 100, offset: 100 },
  });
  expect(mockPool.query).toHaveBeenCalledTimes(3);
  expect(mockPool.query).toHaveBeenNthCalledWith(
    3,
    'SELECT id, likes, tips, thumb_url, preview_url, created_at FROM vault_media ORDER BY id',
  );
  expect(res.body).toEqual([
    {
      id: 'm1',
      likes: 1,
      tips: null,
      thumb_url: null,
      preview_url: null,
      created_at: null,
    },
    {
      id: 'm2',
      likes: 2,
      tips: null,
      thumb_url: null,
      preview_url: null,
      created_at: null,
    },
  ]);
});

test('GET /api/vault-media handles errors', async () => {
  mockAxios.get.mockRejectedValue(new Error('fail'));
  const res = await request(app).get('/api/vault-media').expect(500);
  expect(res.body).toEqual({ error: 'Failed to fetch vault media' });
  expect(mockPool.query).not.toHaveBeenCalled();
});

test('POST /api/vault-media uploads files', async () => {
  mockAxios.get.mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValueOnce({ data: { id: 'm1' } });

  const res = await request(app)
    .post('/api/vault-media')
    .attach('media', Buffer.from('file'), 'file.jpg')
    .expect(200);

  expect(mockAxios.post).toHaveBeenCalledWith(
    '/acc1/media/upload',
    expect.anything(),
    expect.objectContaining({ headers: expect.any(Object) }),
  );
  expect(res.body).toEqual({ mediaIds: ['m1'] });
});

test('POST /api/vault-media/scrape uploads by URL', async () => {
  mockAxios.get.mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } });
  mockAxios.post.mockResolvedValueOnce({ data: { id: 'm2' } });

  const res = await request(app)
    .post('/api/vault-media/scrape')
    .send({ url: 'https://cdn1.onlyfans.com/file' })
    .expect(200);

  expect(mockAxios.post).toHaveBeenCalledWith('/acc1/media/scrape', {
    url: 'https://cdn1.onlyfans.com/file',
  });
  expect(res.body).toEqual({ mediaId: 'm2' });
});
