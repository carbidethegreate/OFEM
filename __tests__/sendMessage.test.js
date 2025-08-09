const request = require('supertest');
const app = require('../server');

describe('POST /api/messages/send', () => {
  it('rejects when text missing', async () => {
    const res = await request(app).post('/api/messages/send').send({});
    expect(res.status).toBe(400);
  });
});

