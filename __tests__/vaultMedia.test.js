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
});

test('GET /api/vault-media retrieves all pages', async () => {
  mockAxios.get
    .mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { media: [{ id: 'm1' }, { id: 'm2' }] } })
    .mockResolvedValueOnce({ data: { media: [] } });

  const res = await request(app).get('/api/vault-media').expect(200);

  expect(mockAxios.get).toHaveBeenNthCalledWith(2, '/acc1/media/vault', {
    params: { limit: 100, offset: 0 },
  });
  expect(mockAxios.get).toHaveBeenNthCalledWith(3, '/acc1/media/vault', {
    params: { limit: 100, offset: 100 },
  });
  expect(res.body).toEqual([{ id: 'm1' }, { id: 'm2' }]);
});

test('GET /api/vault-media handles errors', async () => {
  mockAxios.get.mockRejectedValue(new Error('fail'));
  const res = await request(app).get('/api/vault-media').expect(500);
  expect(res.body).toEqual({ error: 'Failed to fetch vault media' });
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
