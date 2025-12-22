const { sanitizeError, sanitizeLogPayload } = require('../sanitizeError');

describe('sanitizeError', () => {
  test('redacts sensitive headers and nested values', () => {
    const err = {
      message: 'Request failed',
      config: {
        headers: {
          Authorization: 'Bearer super-secret',
          cookie: 'session=abc',
        },
        meta: { apiKey: 'abc123' },
      },
      response: {
        status: 401,
        data: {
          errors: [{ message: 'unauthorized', details: { token: 'hidden' } }],
          nested: { authorization: 'Bearer should-not-leak' },
        },
        headers: {
          Authorization: 'Bearer leaked',
          'cf-ray': 'ray-id',
        },
      },
    };

    const sanitized = sanitizeError(err);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toMatch(/Authorization: Bearer/);
    expect(serialized).not.toMatch(/super-secret/);
    expect(serialized).not.toMatch(/session=abc/);
    expect(sanitized.config.headers.Authorization).toBe('[REDACTED]');
    expect(sanitized.response.headers.Authorization).toBe('[REDACTED]');
    expect(sanitized.response.headers['cf-ray']).toBe('ray-id');
    expect(sanitized.response.data.errors[0].details.token).toBe('[REDACTED]');
  });

  test('sanitizes arbitrary log payloads to block bearer strings', () => {
    const payload = sanitizeLogPayload({
      note: 'Authorization: Bearer abc.def.ghi',
      nested: { apiKey: 'hidden-key' },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/Authorization: Bearer/);
    expect(serialized).not.toMatch(/hidden-key/);
    expect(payload.nested.apiKey).toBe('[REDACTED]');
  });
});
