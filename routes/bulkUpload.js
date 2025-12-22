const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { Configuration, OpenAIApi } = require('openai');
const dayjs = require('dayjs');
const crypto = require('crypto');
const {
  CF_IMAGES_VARIANT,
  tokenFingerprint,
  getCloudflareConfig,
  formatEnvErrorResponse,
  cloudflareError,
  verifyCloudflareToken,
  uploadToCloudflareImages,
  logCloudflareFailure,
  formatUploadError,
  buildCloudflareLogPayload,
} = require('../utils/cloudflareImages');
const {
  saveBatch,
  getBatch,
  updateBatch,
  pruneExpired,
} = require('../utils/uploadRetryStore');

const router = express.Router();
router.use(express.json({ limit: '10mb' }));
const upload = multer({ dest: 'uploads/' }); // temporary storage
const fsPromises = fs.promises;

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));

function buildUploadResponse(items) {
  const uploadErrors = [];
  const uploads = items.map((item) => {
    const uploadError = item.error || null;
    uploadErrors.push(uploadError);
    return {
      filename: item.filename,
      imageId: item.imageId || null,
      url: item.url || item.imageUrl || null,
      mimetype: item.mimetype,
      uploadStatus: item.uploadStatus,
    };
  });

  const hasFailures = items.some((item) => item.uploadStatus === 'failed');
  const firstUploadError = uploadErrors.find(Boolean) || null;

  return {
    uploads,
    uploadErrors,
    hasFailures,
    uploadStatus: hasFailures ? 'partial-failure' : 'ok',
    cloudflareError: firstUploadError
      ? {
          message: firstUploadError.message,
          statusCode: firstUploadError.statusCode,
          cloudflareStatus: firstUploadError.cloudflareStatus,
          requestId: firstUploadError.requestId || null,
        }
      : null,
  };
}

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

    pruneExpired();
    const failOnCloudflareError = req.query?.failOnCloudflareError === 'true';
    const captions = [];
    const responseItems = [];
    const storedItems = [];
    const startTime = dayjs();

    const batchId = crypto.randomUUID
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');

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
      const sendAt = startTime.add((responseItems.length + 1) * 5, 'day').toISOString();

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
      responseItems.push(item);
      storedItems.push({
        ...item,
        retryData: {
          buffer: imageBuffer,
          mimetype: file.mimetype,
          filename: file.originalname,
        },
      });

      if (uploadError && failOnCloudflareError) {
        break;
      }
    }

    const schedule = responseItems.map((item) => ({
      filename: item.filename,
      caption: item.caption,
      sendAt: item.sendAt,
    }));

    const { hasFailures, uploadStatus, cloudflareError, uploadErrors: normalizedUploadErrors, uploads: normalizedUploads } = buildUploadResponse(responseItems);

    saveBatch(batchId, {
      items: storedItems,
      variant: CF_IMAGES_VARIANT,
      createdAt: Date.now(),
      lastResponse: {
        captions,
        schedule,
        uploads: normalizedUploads,
        items: responseItems,
        uploadErrors: normalizedUploadErrors,
        uploadStatus,
        hasFailures,
        cloudflareError,
      },
    });

    const responsePayload = {
      batchId,
      captions,
      schedule,
      uploads: normalizedUploads,
      items: responseItems,
      uploadErrors: normalizedUploadErrors,
      uploadStatus,
      hasFailures,
      cloudflareError,
    };

    const firstUploadError = normalizedUploadErrors.find(Boolean) || null;
    const httpStatus =
      firstUploadError && failOnCloudflareError
        ? firstUploadError.statusCode
        : 200;
    res.status(httpStatus).json(responsePayload);
  } catch (err) {
    const logPayload = buildCloudflareLogPayload(
      err,
      req?.files?.[0]?.originalname || 'bulk-upload',
    );
    console.error('Bulk upload failed:', logPayload);
    if (err?.isCloudflareError) {
      const status = err.statusCode || 502;
      return res
        .status(status)
        .json({ error: err.message, cloudflareStatus: err.cloudflareStatus ?? null });
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/bulk-upload/retry', async (req, res) => {
  try {
    pruneExpired();
    const batchId = req.body?.batchId;
    if (!batchId) {
      return res.status(400).json({ error: 'batchId is required' });
    }
    const batch = getBatch(batchId);
    if (!batch?.items?.length) {
      return res.status(404).json({ error: 'Batch not found or expired' });
    }

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

    try {
      console.info('Verifying Cloudflare token fingerprint (retry)', {
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

    const updatedItems = [];
    const now = Date.now();

    for (let i = 0; i < batch.items.length; i++) {
      const item = batch.items[i];
      const needsRetry =
        !item?.url ||
        !item?.imageUrl ||
        item?.uploadStatus === 'failed' ||
        item?.error;
      if (!needsRetry) {
        updatedItems.push(item);
        continue;
      }

      const retrySource = item?.retryData;
      if (!retrySource?.buffer) {
        const fallbackItem = {
          ...item,
          uploadStatus: 'failed',
          error: {
            message: 'Missing retry data; please reupload the file.',
            statusCode: 400,
          },
        };
        updatedItems.push(fallbackItem);
        continue;
      }

      try {
        const uploadResult = await uploadToCloudflareImages(
          { buffer: retrySource.buffer, mimetype: retrySource.mimetype },
          retrySource.filename,
          retrySource.mimetype,
          cloudflareConfig,
        );
        updatedItems.push({
          ...item,
          uploadStatus: 'success',
          error: null,
          url: uploadResult?.url || null,
          imageUrl: uploadResult?.url || null,
          imageId: uploadResult?.imageId || null,
        });
      } catch (uploadErr) {
        const cfErr =
          uploadErr?.isCloudflareError ||
          uploadErr?.isAxiosError ||
          uploadErr?.response
            ? uploadErr
            : cloudflareError(uploadErr?.message, 502);
        logCloudflareFailure(cfErr, item?.filename || `item-${i + 1}`);
        updatedItems.push({
          ...item,
          uploadStatus: 'failed',
          error: formatUploadError(cfErr),
        });
      }
    }

    const responseSummary = buildUploadResponse(updatedItems);
    const schedule = updatedItems.map((item) => ({
      filename: item.filename,
      caption: item.caption,
      sendAt: item.sendAt,
    }));

    saveBatch(batchId, {
      ...batch,
      items: updatedItems,
      lastResponse: {
        captions: batch?.lastResponse?.captions || [],
        schedule,
        uploads: responseSummary.uploads,
        items: updatedItems,
        uploadErrors: responseSummary.uploadErrors,
        uploadStatus: responseSummary.uploadStatus,
        hasFailures: responseSummary.hasFailures,
        cloudflareError: responseSummary.cloudflareError,
      },
      createdAt: batch.createdAt || now,
    });

    res.status(200).json({
      batchId,
      captions: batch?.lastResponse?.captions || [],
      schedule,
      uploads: responseSummary.uploads,
      items: updatedItems,
      uploadErrors: responseSummary.uploadErrors,
      uploadStatus: responseSummary.uploadStatus,
      hasFailures: responseSummary.hasFailures,
      cloudflareError: responseSummary.cloudflareError,
    });
  } catch (err) {
    const logPayload = buildCloudflareLogPayload(
      err,
      'bulk-upload-retry',
    );
    console.error('Bulk upload retry failed:', logPayload);
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
