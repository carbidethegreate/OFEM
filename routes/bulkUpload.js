const express = require('express');
const multer = require('multer');
const path = require('path');
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

function getCloudflareDeliveryUrl(imageId) {
  if (!CF_IMAGES_DELIVERY_HASH || !imageId) return null;
  return `https://imagedelivery.net/${CF_IMAGES_DELIVERY_HASH}/${imageId}/public`;
}

async function uploadToCloudflareImages(filePath, filename, mimetype) {
  if (!CF_IMAGES_ACCOUNT_ID || !CF_IMAGES_TOKEN) {
    throw new Error('Cloudflare Images environment variables missing');
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    filename,
    contentType: mimetype,
  });

  const res = await axios.post(
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

  if (!res.data?.success) {
    const msg = res.data?.errors?.[0]?.message || 'Cloudflare upload failed';
    throw new Error(msg);
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

    const captions = [];
    const uploads = [];
    for (const file of req.files) {
      const imageBuffer = await fsPromises.readFile(file.path);
      const dataUri = `data:${file.mimetype};base64,${imageBuffer.toString('base64')}`;
      let cloudflareUpload = null;
      try {
        cloudflareUpload = await uploadToCloudflareImages(
          file.path,
          file.originalname,
          file.mimetype,
        );
      } catch (uploadErr) {
        console.error('Cloudflare upload failed:', uploadErr?.message || uploadErr);
        throw uploadErr;
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

    res.json({ captions, schedule, uploads, items });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
