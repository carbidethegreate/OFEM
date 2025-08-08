function sanitizeError(err) {
  if (!err || typeof err !== 'object') return err;
  const sanitized = {
    message: err.message,
    name: err.name,
  };
  if (err.stack) sanitized.stack = err.stack;
  if (err.config) {
    const cfg = { ...err.config };
    if (err.config.headers) {
      const headers = { ...err.config.headers };
      for (const key of Object.keys(headers)) {
        if (
          /authorization/i.test(key) ||
          /cookie/i.test(key) ||
          /api-key/i.test(key)
        ) {
          headers[key] = '[REDACTED]';
        }
      }
      cfg.headers = headers;
    }
    sanitized.config = cfg;
  }
  if (err.response) {
    sanitized.response = {
      status: err.response.status,
      data: err.response.data,
      headers: err.response.headers,
    };
  }
  return sanitized;
}
module.exports = { sanitizeError };
