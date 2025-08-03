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

test('GET /api/vault-media proxies to OnlyFans API', async () => {
  mockAxios.get
    .mockResolvedValueOnce({ data: { accounts: [{ id: 'acc1' }] } })
    .mockResolvedValueOnce({ data: { media: [{ id: 'm1' }] } });

  const res = await request(app).get('/api/vault-media').expect(200);
  expect(mockAxios.get).toHaveBeenCalledWith('/acc1/media/vault', { params: {} });
  expect(res.body).toEqual({ media: [{ id: 'm1' }] });
});
