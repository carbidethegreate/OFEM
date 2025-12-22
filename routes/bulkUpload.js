const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { Configuration, OpenAIApi } = require('openai');
const dayjs = require('dayjs');
const crypto = require('crypto');
const { sanitizeError } = require('../sanitizeError');

const router = express.Router();
const upload = multer({ dest: 'uploads/' }); // temporary storage
const fsPromises = fs.promises;

// Cloudflare Images configuration (set in Render env vars/secrets)
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
    const err = new Error(`Missing environment variables: ${missing.join(', ')}`);
    err.statusCode = 400;
    err.isConfigError = true;
    throw err;
  }

  return { accountId, token, deliveryHash, variant };
}

function formatEnvErrorResponse(err) {
  if (!err?.isConfigError) return null;
  const status = err.statusCode || 400;
  return { status, payload: { error: err.message } };
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

async function uploadToCloudflareImages(filePath, filename, mimetype, config) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    filename,
    contentType: mimetype,
  });

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
  const sanitized = sanitizeError(err);
  const responseStatus =
    err?.cloudflareStatus ??
    err?.statusCode ??
    sanitized?.response?.status ??
    err?.response?.status ??
    null;
  const cloudflareErrors =
    sanitized?.response?.data?.errors ??
    err?.responseErrors ??
    err?.responseData?.errors ??
    err?.response?.data?.errors ??
    null;
  const requestId =
    err?.requestId ||
    extractRequestId(err, sanitized);

  console.error('Cloudflare upload failed:', {
    filename,
    status: responseStatus,
    cloudflareErrors,
    requestId,
  });
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

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));

router.post('/bulk-upload', upload.array('images', 50), async (req, res) => {
  try {
    let cloudflareConfig;
    try {
      cloudflareConfig = getCloudflareConfig();
    } catch (configErr) {
      const envError = formatEnvErrorResponse(configErr);
      if (envError) {
        return res.status(envError.status).json(envError.payload);
      }
      throw configErr;
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    try {
      console.info('Verifying Cloudflare token fingerprint', {
        tokenFingerprint: tokenFingerprint(cloudflareConfig.token),
      });
      await verifyCloudflareToken(cloudflareConfig);
    } catch (verifyErr) {
      const status =
        verifyErr?.statusCode ||
        verifyErr?.cloudflareStatus ||
        verifyErr?.response?.status ||
        401;
      const message = verifyErr?.isVerificationError
        ? 'Invalid Cloudflare configuration: CF_IMAGES_TOKEN'
        : 'Cloudflare token verification failed';
      logCloudflareFailure(verifyErr, 'token-verification');
      return res.status(status).json({ error: message });
    }

    const failOnCloudflareError = req.query?.failOnCloudflareError === 'true';
    const captions = [];
    const uploads = [];
    const uploadErrors = [];
    const items = [];
    const startTime = dayjs();

    for (const file of req.files) {
      const imageBuffer = await fsPromises.readFile(file.path);
      const dataUri = `data:${file.mimetype};base64,${imageBuffer.toString('base64')}`;
      let cloudflareUpload = null;
      let uploadError = null;
      try {
        cloudflareUpload = await uploadToCloudflareImages(
          file.path,
          file.originalname,
          file.mimetype,
          cloudflareConfig,
        );
      } catch (uploadErr) {
        const cfErr =
          uploadErr?.isCloudflareError ||
          uploadErr?.isAxiosError ||
          uploadErr?.response
            ? uploadErr
            : cloudflareError(uploadErr?.message, 502);
        logCloudflareFailure(cfErr, file.originalname);
        uploadError = formatUploadError(cfErr);
      } finally {
        try {
          await fsPromises.unlink(file.path);
        } catch (unlinkErr) {
          console.warn('Could not delete temp upload:', unlinkErr?.message || unlinkErr);
        }
      }

      const prompt = `I am a professional Classic Bodybuilder, big muscular jock, former USMC Marine, wrestler, and former semi pro football player with a large TikTok following. I am posting an image and need a short, masculine, spicy caption to accompany it. Review the image and write a confident, dominant message addressed directly to the viewer. The tone should be bold, controlled, and self assured. The caption must appeal to both straight women and gay men, so avoid gendered language and avoid words like baby. Keep it suggestive but clean, spicy without being explicit. Do not describe sexual acts. Do not use quotation marks or em dashes.`;

      const completion = await openai.createChatCompletion({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUri } },
            ],
          },
        ],
        max_tokens: 150,
      });

      const caption = completion.data.choices[0].message.content.trim();
      const uploadStatus = uploadError ? 'failed' : 'success';
      const sendAt = startTime.add((items.length + 1) * 5, 'day').toISOString();

      const item = {
        filename: file.originalname,
        caption,
        uploadStatus,
        error: uploadError,
        url: cloudflareUpload?.url || null,
        imageUrl: cloudflareUpload?.url || null,
        imageId: cloudflareUpload?.imageId || null,
        mimetype: file.mimetype,
        sendAt,
      };

      captions.push({ filename: file.originalname, caption });
      uploadErrors.push(uploadError);
      uploads.push({
        filename: file.originalname,
        imageId: cloudflareUpload?.imageId || null,
        url: cloudflareUpload?.url || null,
        mimetype: file.mimetype,
        uploadStatus,
      });
      items.push(item);

      if (uploadError && failOnCloudflareError) {
        break;
      }
    }

    const schedule = items.map((item) => ({
      filename: item.filename,
      caption: item.caption,
      sendAt: item.sendAt,
    }));

    const firstUploadError = uploadErrors.find(Boolean) || null;
    const hasFailures = items.some((item) => item.uploadStatus === 'failed');
    const responsePayload = {
      captions,
      schedule,
      uploads,
      items,
      uploadErrors,
      uploadStatus: hasFailures
        ? failOnCloudflareError
          ? 'failed'
          : 'partial-failure'
        : 'ok',
      hasFailures,
      cloudflareError: firstUploadError
        ? {
            message: firstUploadError.message,
            statusCode: firstUploadError.statusCode,
            cloudflareStatus: firstUploadError.cloudflareStatus,
            requestId: firstUploadError.requestId || null,
          }
        : null,
    };

    const httpStatus =
      firstUploadError && failOnCloudflareError
        ? firstUploadError.statusCode
        : 200;
    res.status(httpStatus).json(responsePayload);
  } catch (err) {
    const sanitized = sanitizeError(err);
    if (sanitized?.response?.headers) {
      sanitized.response.headers = safeRequestHeaders(sanitized.response.headers);
    }
    console.error('Bulk upload failed:', sanitized);
    if (err?.isCloudflareError) {
      const status = err.statusCode || 502;
      return res
        .status(status)
        .json({ error: err.message, cloudflareStatus: err.cloudflareStatus ?? null });
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
