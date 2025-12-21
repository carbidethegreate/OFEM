const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const { Configuration, OpenAIApi } = require('openai');
const dayjs = require('dayjs');

const router = express.Router();
const upload = multer({ dest: 'uploads/' }); // temporary storage

const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

router.post('/bulk-upload', upload.array('images', 50), async (req, res) => {
  try {
    const captions = [];
    for (const file of req.files) {
      const imageBuffer = await fs.readFile(file.path);
      const dataUri = `data:${file.mimetype};base64,${imageBuffer.toString('base64')}`;

      const prompt = `I am going to post this image (for your reference I am a Pro Classic Bodybuilder, Big Muscle Jock, former USMC Marine, wrestler, and former semi‑pro football player who is also famous on TikTok). Look at the image and write a short masculine, spicy caption; it should appeal to both straight women and gay men, so avoid the word “baby” or anything that suggests gender. Be direct, dominant, and confident and write a message to send along with the image.`;

      const completion = await openai.createChatCompletion({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUri } }
            ]
          }
        ],
        max_tokens: 150
      });

      const caption = completion.data.choices[0].message.content.trim();
      captions.push({ filename: file.originalname, caption });
    }

    const now = dayjs();
    const schedule = captions.map((c, idx) => ({
      filename: c.filename,
      caption: c.caption,
      sendAt: now.add((idx + 1) * 5, 'day').toISOString()
    }));

    res.json({ captions, schedule });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate captions' });
  }
});

module.exports = router;
