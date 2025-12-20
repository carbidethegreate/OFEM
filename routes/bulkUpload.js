const express = require('express');
const multer = require('multer');
const { Configuration, OpenAIApi } = require('openai');
const dayjs = require('dayjs');

const router = express.Router();
const upload = multer({ dest: 'uploads/' }); // temporary storage

const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

router.post('/bulk-upload', upload.array('images', 50), async (req, res) => {
  try {
    const captions = [];
    for (const file of req.files) {
      const prompt = `Write an engaging OnlyFans post for an image called ${file.originalname}. Include relevant emojis.`;
      const completion = await openai.createChatCompletion({
        model: 'gpt-4-turbo',
        messages: [{ role: 'system', content: prompt }],
        max_tokens: 150
      });
      const caption = completion.data.choices[0].message.content.trim();
      captions.push({ filename: file.originalname, caption });
    }

    // Generate simple schedule suggestions: one per day starting tomorrow
    const now = dayjs();
    const schedule = captions.map((c, idx) => {
      return {
        filename: c.filename,
        caption: c.caption,
        sendAt: now.add(idx + 1, 'day').toISOString()
      };
    });

    res.json({ captions, schedule });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate captions' });
  }
});

module.exports = router;
