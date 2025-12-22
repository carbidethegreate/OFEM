const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
const { sanitizeError, sanitizeLogPayload } = require('../sanitizeError');

const CF_IMAGES_VARIANT = process.env.CF_IMAGES_VARIANT || 'public';

function tokenFingerprint(token) {
  if (!token) return null;
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 8);
}

function getCloudflareConfig() {
  const accountId = process.env.CF_IMAGES_ACCOUNT_ID;
  const token = process.env.CF_IMAGES_TOKEN;
  const deliveryHash =
    process.env.CF_IMAGES_DELIVERY_HASH || process.env.CF_IMAGES_ACCOUNT_HASH;
  const variant = CF_IMAGES_VARIANT || 'public';

  const missing = [];
  if (!accountId) missing.push('CF_IMAGES_ACCOUNT_ID');
  if (!token) missing.push('CF_IMAGES_TOKEN');
  if (!deliveryHash) missing.push('CF_IMAGES_DELIVERY_HASH/CF_IMAGES_ACCOUNT_HASH');

  if (missing.length) {
    const err = new Error('Cloudflare Images environment variables missing');
    err.statusCode = 400;
    err.isConfigError = true;
    err.missing = missing;
    throw err;
  }

  return { accountId, token, deliveryHash, variant };
}

function formatEnvErrorResponse(err) {
  if (!err?.isConfigError) return null;
  const status = err.statusCode || 400;
  return { status, payload: { error: err.message, cloudflareStatus: null } };
}

function cloudflareError(message, statusCode, cloudflareStatus) {
  const err = new Error(message || 'Cloudflare upload failed');
  err.isCloudflareError = true;
  err.statusCode = statusCode || 502;
  err.cloudflareStatus = cloudflareStatus ?? null;
  return err;
}

function getCloudflareDeliveryUrl(deliveryHash, variant, imageId) {
  if (!deliveryHash || !imageId) return null;
  return `https://imagedelivery.net/${deliveryHash}/${imageId}/${variant || 'public'}`;
}

function safeRequestHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const allowed = ['cf-ray', 'cf-request-id'];
  return allowed.reduce((acc, key) => {
    if (headers[key]) acc[key] = headers[key];
    return acc;
  }, {});
}

function extractRequestId(err, sanitized) {
  const safeHeaders =
    safeRequestHeaders(sanitized?.response?.headers) ||
    safeRequestHeaders(err?.response?.headers);
  return safeHeaders['cf-ray'] || safeHeaders['cf-request-id'] || null;
}

function buildCloudflareLogPayload(err, filename) {
  const sanitized = sanitizeError(err);
  const responseStatus =
    err?.cloudflareStatus ??
    err?.statusCode ??
    sanitized?.response?.status ??
    err?.response?.status ??
    null;
  const cloudflareErrorsRaw =
    sanitized?.response?.data?.errors ??
    err?.responseErrors ??
    err?.responseData?.errors ??
    err?.response?.data?.errors ??
    null;
  const cloudflareErrors =
    Array.isArray(cloudflareErrorsRaw) && cloudflareErrorsRaw.length
      ? cloudflareErrorsRaw
      : undefined;
  const cloudflareStatus =
    err?.cloudflareStatus ??
    sanitized?.response?.status ??
    err?.statusCode ??
    err?.response?.status ??
    null;

  return sanitizeLogPayload({
    filename: filename || undefined,
    status: responseStatus,
    cloudflareStatus,
    cloudflareErrors,
    requestId: err?.requestId || extractRequestId(err, sanitized),
  });
}

async function verifyCloudflareToken({ token }) {
  try {
    await axios.get('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    const status = err?.response?.status;
    const statusCode = status ? (status >= 500 ? 502 : 401) : 502;
    const cfErr = cloudflareError('Cloudflare token verification failed', statusCode, status);
    cfErr.responseErrors = err?.response?.data?.errors || null;
    cfErr.requestId =
      err?.response?.headers?.['cf-ray'] ||
      err?.response?.headers?.['cf-request-id'] ||
      null;
    cfErr.isVerificationError = true;
    throw cfErr;
  }
}

async function uploadToCloudflareImages(fileInput, filename, mimetype, config) {
  const form = new FormData();
  const fileOptions = {
    filename,
    contentType: mimetype,
  };

  if (fileInput?.buffer) {
    form.append('file', fileInput.buffer, fileOptions);
  } else if (fileInput?.filePath) {
    form.append('file', fs.createReadStream(fileInput.filePath), fileOptions);
  } else if (typeof fileInput === 'string') {
    form.append('file', fs.createReadStream(fileInput), fileOptions);
  } else {
    throw cloudflareError('Invalid file input for Cloudflare upload', 400);
  }

  let res;
  try {
    res = await axios.post(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/images/v1`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${config.token}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 60000,
      },
    );
  } catch (err) {
    if (err?.isCloudflareError) throw err;
    const status = err?.response?.status;
    const errMsg =
      err?.response?.data?.errors?.[0]?.message ||
      err?.response?.data?.error ||
      err?.message;
    const statusCode = status ? (status >= 500 ? 502 : 400) : 502;
    const sanitized = sanitizeError(err);
    const cfErr = cloudflareError(errMsg, statusCode, status);
    cfErr.responseData = sanitized?.response?.data ?? err?.response?.data ?? null;
    cfErr.requestId =
      sanitized?.response?.headers?.['cf-ray'] ||
      sanitized?.response?.headers?.['cf-request-id'] ||
      err?.response?.headers?.['cf-ray'] ||
      err?.response?.headers?.['cf-request-id'] ||
      null;
    throw cfErr;
  }

  if (!res.data?.success) {
    const msg = res.data?.errors?.[0]?.message || 'Cloudflare upload failed';
    const cfErr = cloudflareError(msg, 502, res.status);
    cfErr.responseData = res.data;
    throw cfErr;
  }

  const imageId = res.data?.result?.id;
  const variantUrl =
    getCloudflareDeliveryUrl(config.deliveryHash, config.variant, imageId) ||
    (Array.isArray(res.data?.result?.variants) && res.data.result.variants[0]) ||
    null;

  return { imageId, url: variantUrl };
}

function logCloudflareFailure(err, filename) {
  console.error('Cloudflare upload failed:', buildCloudflareLogPayload(err, filename));
}

function formatUploadError(err) {
  const sanitized = sanitizeError(err);
  const fallbackStatus = err?.response?.status ?? sanitized?.response?.status;
  const derivedStatusCode =
    fallbackStatus != null
      ? fallbackStatus >= 500
        ? 502
        : 400
      : 502;
  return {
    message: err?.message || 'Cloudflare upload failed',
    statusCode: err?.statusCode || derivedStatusCode,
    cloudflareStatus: err?.cloudflareStatus ?? fallbackStatus ?? null,
    requestId: err?.requestId || extractRequestId(err, sanitized),
  };
}

module.exports = {
  CF_IMAGES_VARIANT,
  tokenFingerprint,
  getCloudflareConfig,
  formatEnvErrorResponse,
  cloudflareError,
  getCloudflareDeliveryUrl,
  safeRequestHeaders,
  extractRequestId,
  verifyCloudflareToken,
  uploadToCloudflareImages,
  logCloudflareFailure,
  buildCloudflareLogPayload,
  formatUploadError,
};
