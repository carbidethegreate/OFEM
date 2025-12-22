const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERNS = [/authorization/i, /cookie/i, /api[-_]?key/i, /token/i, /secret/i];
const AUTHORIZATION_BEARER_PATTERN = /authorization:\s*bearer\s+[^\s,;]+/gi;
const BEARER_VALUE_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const COOKIE_VALUE_PATTERN = /\bcookie\s*[:=]\s*[^;,\s]+/gi;
const API_KEY_VALUE_PATTERN = /\bapi[-_\s]?key\s*[:=]\s*[A-Za-z0-9._-]+/gi;

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function redactString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(AUTHORIZATION_BEARER_PATTERN, 'Authorization: [REDACTED]')
    .replace(BEARER_VALUE_PATTERN, 'Bearer [REDACTED]')
    .replace(COOKIE_VALUE_PATTERN, 'cookie=[REDACTED]')
    .replace(API_KEY_VALUE_PATTERN, 'api-key=[REDACTED]');
}

function sanitizeDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDeep(item));
  }

  if (isPlainObject(value)) {
    return Object.keys(value).reduce((acc, key) => {
      if (SENSITIVE_KEY_PATTERNS.some((regex) => regex.test(key))) {
        acc[key] = REDACTED;
        return acc;
      }
      acc[key] = sanitizeDeep(value[key]);
      return acc;
    }, {});
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  return value;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  return sanitizeDeep(headers);
}

function sanitizeError(err) {
  if (!err || typeof err !== 'object') return err;
  const sanitized = {
    message: err.message,
    name: err.name,
  };
  if (err.stack) sanitized.stack = err.stack;
  if (err.config) {
    const cfg = sanitizeDeep(err.config);
    if (cfg.headers) cfg.headers = sanitizeHeaders(cfg.headers);
    sanitized.config = cfg;
  }
  if (err.response) {
    sanitized.response = {
      status: err.response.status,
      data: sanitizeDeep(err.response.data),
      headers: sanitizeHeaders(err.response.headers),
    };
  }
  return sanitizeDeep(sanitized);
}

function sanitizeLogPayload(payload) {
  return sanitizeDeep(payload);
}

module.exports = { sanitizeError, sanitizeLogPayload, sanitizeHeaders };
