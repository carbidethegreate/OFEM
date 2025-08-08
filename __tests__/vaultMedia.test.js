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
  expect(res.body).toEqual({ media: [{ id: 'm1' }, { id: 'm2' }] });
});

test('GET /api/vault-media handles errors', async () => {
  mockAxios.get.mockRejectedValue(new Error('fail'));
  const res = await request(app).get('/api/vault-media').expect(500);
  expect(res.body).toEqual({ error: 'Failed to fetch vault media' });
});
