const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { Configuration, OpenAIApi } = require('openai');
const dayjs = require('dayjs');

const router = express.Router();
const upload = multer({ dest: 'uploads/' }); // temporary storage
const fsPromises = fs.promises;

// Cloudflare Images configuration (set in Render env vars/secrets)
const CF_IMAGES_ACCOUNT_ID = process.env.CF_IMAGES_ACCOUNT_ID;
const CF_IMAGES_TOKEN = process.env.CF_IMAGES_TOKEN;
const CF_IMAGES_DELIVERY_HASH =
  process.env.CF_IMAGES_DELIVERY_HASH || process.env.CF_IMAGES_ACCOUNT_HASH;

function cloudflareError(message, statusCode, cloudflareStatus) {
  const err = new Error(message || 'Cloudflare upload failed');
  err.isCloudflareError = true;
  err.statusCode = statusCode || 502;
  err.cloudflareStatus = cloudflareStatus ?? null;
  return err;
}

function getCloudflareDeliveryUrl(imageId) {
  if (!CF_IMAGES_DELIVERY_HASH || !imageId) return null;
  return `https://imagedelivery.net/${CF_IMAGES_DELIVERY_HASH}/${imageId}/public`;
}

async function uploadToCloudflareImages(filePath, filename, mimetype) {
  if (!CF_IMAGES_ACCOUNT_ID || !CF_IMAGES_TOKEN) {
    throw cloudflareError('Cloudflare Images environment variables missing', 400);
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    filename,
    contentType: mimetype,
  });

  let res;
  try {
    res = await axios.post(
      `https://api.cloudflare.com/client/v4/accounts/${CF_IMAGES_ACCOUNT_ID}/images/v1`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${CF_IMAGES_TOKEN}`,
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
    throw cloudflareError(errMsg, statusCode, status);
  }

  if (!res.data?.success) {
    const msg = res.data?.errors?.[0]?.message || 'Cloudflare upload failed';
    throw cloudflareError(msg, 502, res.status);
  }

  const imageId = res.data?.result?.id;
  const variantUrl =
    getCloudflareDeliveryUrl(imageId) ||
    (Array.isArray(res.data?.result?.variants) && res.data.result.variants[0]) ||
    null;

  return { imageId, url: variantUrl };
}

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));

router.post('/bulk-upload', upload.array('images', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const failOnCloudflareError = req.query?.failOnCloudflareError === 'true';
    const captions = [];
    const uploads = [];
    const uploadErrors = [];

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
        );
      } catch (uploadErr) {
        const cfErr =
          uploadErr?.isCloudflareError
            || uploadErr?.isAxiosError
            || uploadErr?.response
            ? uploadErr
            : cloudflareError(uploadErr?.message, 502);
        console.error('Cloudflare upload failed:', cfErr?.message || cfErr);
        const fallbackStatus = cfErr?.response?.status;
        const derivedStatusCode =
          fallbackStatus != null
            ? fallbackStatus >= 500
              ? 502
              : 400
            : 502;
        uploadError = {
          message: cfErr?.message || 'Cloudflare upload failed',
          statusCode: cfErr?.statusCode || derivedStatusCode,
          cloudflareStatus:
            cfErr?.cloudflareStatus ??
            cfErr?.response?.status ??
            null,
        };
        if (failOnCloudflareError) {
          throw cloudflareError(
            uploadError.message,
            uploadError.statusCode,
            uploadError.cloudflareStatus,
          );
        }
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
      captions.push({ filename: file.originalname, caption });
      uploadErrors.push(uploadError);
      uploads.push({
        filename: file.originalname,
        imageId: cloudflareUpload?.imageId || null,
        url: cloudflareUpload?.url || null,
        mimetype: file.mimetype,
      });
    }

    const now = dayjs();
    const schedule = captions.map((c, idx) => ({
      filename: c.filename,
      caption: c.caption,
      sendAt: now.add((idx + 1) * 5, 'day').toISOString(),
    }));

    const items = captions.map((c, idx) => ({
      filename: c.filename,
      caption: c.caption,
      sendAt: schedule[idx]?.sendAt,
      imageUrl: uploads[idx]?.url || null,
      imageId: uploads[idx]?.imageId || null,
    }));

    const firstUploadError = uploadErrors.find(Boolean) || null;
    const responsePayload = {
      captions,
      schedule,
      uploads,
      items,
      uploadErrors,
      uploadStatus: firstUploadError ? 'partial-failure' : 'ok',
      cloudflareError: firstUploadError
        ? {
            message: firstUploadError.message,
            statusCode: firstUploadError.statusCode,
            cloudflareStatus: firstUploadError.cloudflareStatus,
          }
        : null,
    };

    res.status(firstUploadError && failOnCloudflareError ? firstUploadError.statusCode : 200).json(responsePayload);
  } catch (err) {
    console.error(err);
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
