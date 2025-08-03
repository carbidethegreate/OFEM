const { newDb } = require('pg-mem');
const mem = newDb();
const pg = mem.adapters.createPg();
const mockPool = new pg.Pool();
const rawQuery = mockPool.query.bind(mockPool);
mockPool.query = (text, params) => {
  if (typeof text === 'string') text = text.replace('IF NOT EXISTS', '');
  return rawQuery(text, params);
};
mockPool.end = jest.fn().mockResolvedValue();

jest.mock('../db', () => mockPool);

beforeAll(async () => {
  await mockPool.query('CREATE TABLE fans(id BIGINT PRIMARY KEY);');
  require('../migrate_messages.js');
  await new Promise(resolve => setImmediate(resolve));
});

test('migration creates messages table with expected columns', async () => {
  const res = await mockPool.query("SELECT column_name FROM information_schema.columns WHERE table_name='messages' ORDER BY ordinal_position");
  expect(res.rows.map(r => r.column_name)).toEqual([
    'id',
    'fan_id',
    'direction',
    'body',
    'price',
    'created_at'
  ]);
});
