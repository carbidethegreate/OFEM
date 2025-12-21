const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const { Configuration, OpenAIApi } = require('openai');
const dayjs = require('dayjs');

const router = express.Router();
const upload = multer({ dest: 'uploads/' }); // temporary storage

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));

router.post('/bulk-upload', upload.array('images', 50), async (req, res) => {
  try {
    const captions = [];
    for (const file of req.files) {
      const imageBuffer = await fs.readFile(file.path);
      const dataUri = `data:${file.mimetype};base64,${imageBuffer.toString('base64')}`;

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
    }

    const now = dayjs();
    const schedule = captions.map((c, idx) => ({
      filename: c.filename,
      caption: c.caption,
      sendAt: now.add((idx + 1) * 5, 'day').toISOString(),
    }));

    res.json({ captions, schedule });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
