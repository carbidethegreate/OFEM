const express = require('express');

module.exports = function ({ pool, sanitizeError, sendMessageToFan, openaiAxios, openaiRequest }) {
  const router = express.Router();

  // In-memory list to store recent events for front-end (cap to last 100 events)
  const recentEvents = [];

  // Predefined templates for thank-you messages (50 variations)
  /* eslint-disable quotes */
  const THANK_YOU_TEMPLATES = [
    "Thank you so much [name]! Your support means a lot \uD83D\uDC95.",
    "Thanks for unlocking, [name]! Hope you enjoy it!",
    "I appreciate your purchase, [name] – you're awesome!",
    "Thank you [name], you just made my day \uD83D\uDE18!",
    "Thanks [name]! Hope you love what you unlocked!",
    "You’re the best, [name]! Thanks for buying my content \uD83D\uDC96",
    "Thank you [name]! I really appreciate your support.",
    "So sweet of you [name] – enjoy and thank you! \uD83D\uDC95",
    "Thanks a ton for the purchase, [name]! Enjoy \uD83D\uDE18",
    "Thank you [name]! Your support means the world to me.",
    "Thanks for unlocking this, [name]! Hope it makes you smile \uD83D\uDE0A",
    "Thank you [name], I’m so grateful for your purchase!",
    "Yay! Thanks for your purchase, [name]! Enjoy it \uD83D\uDC96",
    "[name], you’re amazing – thank you for unlocking my content!",
    "Thank you, [name]! I hope you absolutely love it!",
    "Big thanks [name]! Your support keeps me going \uD83D\uDE18",
    "Thanks [name]! I appreciate you treating yourself (and me)!",
    "Thank you [name]! I put a lot into it – enjoy \uD83D\uDE09",
    "You’re wonderful, [name]. Thanks for buying my content \uD83D\uDC95",
    "Thank you for the love, [name]! Enjoy your content!",
    "Thanks for the purchase, [name]! You rock \uD83D\uDE18",
    "Thank you [name]! Let me know how you like it! \uD83D\uDC96",
    "So appreciative, [name]! Hope you enjoy every second of it!",
    "Thank you [name], I’m flattered you bought it \uD83D\uDE0A",
    "Thanks [name]! Your support is truly appreciated \uD83D\uDC95",
    "Thank you [name]! You have great taste \uD83D\uDE09 Enjoy!",
    "Thanks [name]! Sending you lots of love for your support!",
    "You’re incredible [name]! Thank you for unlocking this \uD83D\uDC96",
    "Thank you so much [name]! It means a lot that you got it!",
    "Thanks [name]! This message comes with a big hug \uD83E\uDD17",
    "Thank you [name]! I’m thrilled you unlocked it \uD83D\uDE18",
    "Thanks [name]! You just put a big smile on my face \uD83D\uDE0A",
    "Thank you [name]! Hope it’s everything you wanted and more!",
    "Thank you [name]! Enjoy, and thanks for being here \uD83D\uDC95",
    "Thanks for your purchase, [name]! You’re the best!",
    "I appreciate you treating yourself to my content, [name]! Thank you!",
    "Thank you [name]! I poured my heart into it – enjoy \uD83D\uDE18",
    "Thanks [name]! I can’t wait to hear what you think \uD83D\uDC96",
    "Thank you [name]! Feeling grateful for your support!",
    "Thanks [name]! I hope this makes your day a little brighter \uD83D\uDE0A",
    "Thank you [name], you’re an absolute gem \uD83D\uDC95",
    "Thank you [name]! Your support helps me create more for you!",
    "Thanks a bunch, [name]! You’re why I love doing this \uD83D\uDE18",
    "Thank you [name]! Enjoy and stay amazing \uD83D\uDC96",
    "Thanks [name]! You deserve all the best – enjoy \uD83D\uDE09",
    "Thank you [name]! I hope it was worth it for you \uD83D\uDE0A",
    "Thanks [name]! Let me know if you liked it!",
    "Thank you [name]! You just made my day brighter \uD83D\uDC95",
    "Thanks [name]! Your support doesn’t go unnoticed \uD83D\uDE18",
  ];
  /* eslint-enable quotes */

  // Helper to safely escape HTML in text (to prevent injection in our UI)
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c] || c);
  }

  router.post('/webhooks/onlyfans', async (req, res) => {
    const event = req.body;
    if (!event || !event.type) {
      return res.status(400).send('Bad Request');
    }
    const eventType = event.type;
    let fanId = null;
    let fanUsername = null;
    let eventContent = '';
    let suggestedReply = '';
    let thankYouMessage = '';
    const now = new Date();

    try {
      if (eventType === 'messages.received') {
        // A new message from a fan
        const msgData = event.data || event.message || {}; // handle possible payload shapes
        // Identify fan/user who sent the message:
        fanId = msgData.fromUser?.id || msgData.user?.id || msgData.senderId;
        if (!fanId) {
          throw new Error('Fan ID not provided in message event');
        }
        fanId = fanId.toString();
        fanUsername =
          msgData.fromUser?.username ||
          msgData.user?.username ||
          msgData.author ||
          fanId;
        // Get message text and price if any
        const messageText = msgData.text || msgData.body || '';
        const price = msgData.price ?? null;
        eventContent = messageText;
        // Determine timestamp of the message if provided
        let createdAt = now;
        const ts =
          msgData.createdAt ||
          msgData.created_at ||
          msgData.time ||
          msgData.postedAt;
        if (ts) {
          const dateVal = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
          if (!isNaN(dateVal.getTime())) {
            createdAt = dateVal;
          }
        }
        // Insert incoming message into DB
        try {
          if (msgData.id != null) {
            const msgId = msgData.id.toString();
            await pool.query(
              `INSERT INTO messages (id, fan_id, direction, body, price, created_at)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (id) DO UPDATE
               SET fan_id=$2, direction=$3, body=$4, price=$5, created_at=$6`,
              [msgId, fanId, 'incoming', messageText, price, createdAt],
            );
          } else {
            console.warn('Skipping message insert: missing message ID');
          }
        } catch (err) {
          console.error('Error saving incoming message:', sanitizeError(err));
        }

        // Generate AI suggested response using OpenAI API
        try {
          const openaiResp = await openaiRequest(() =>
            openaiAxios.post(
              'https://api.openai.com/v1/chat/completions',
              {
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                messages: [
                  {
                    role: 'system',
                    content:
                      'You are an OnlyFans assistant helping a creator reply to fans in a friendly, engaging, and personalized tone.',
                  },
                  {
                    role: 'user',
                    content:
                      `Fan says: "${messageText}"\nDraft a brief, friendly reply in the creator's voice.`,
                  },
                ],
                max_tokens: 100,
                temperature: 0.7,
              },
              {
                headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
              },
            ),
          );
          suggestedReply = openaiResp.data.choices[0]?.message?.content?.trim() || '';
        } catch (err) {
          console.error('OpenAI suggestion error:', sanitizeError(err));
          suggestedReply = '(Failed to generate AI response)';
        }
        if (!suggestedReply) {
          suggestedReply = '(No response generated)';
        }
      } else if (eventType === 'messages.ppv.unlocked') {
        // A PPV message was purchased/unlocked by a fan
        const evtData = event.data || {};
        fanId =
          evtData.fanId ||
          evtData.userId ||
          evtData.fromUser?.id ||
          evtData.user?.id;
        if (!fanId) {
          // If fanId not directly provided, maybe the original message has info
          fanId = evtData.message?.fromUser?.id || evtData.message?.userId;
        }
        if (!fanId) {
          console.warn('PPV unlocked event without fanId');
          fanId = 'unknown';
        } else {
          fanId = fanId.toString();
        }
        // Try to get fan username from DB (for display), since fan likely exists in fans table
        try {
          const fanRes = await pool.query('SELECT username FROM fans WHERE id=$1', [fanId]);
          fanUsername = fanRes.rows[0]?.username || fanId;
        } catch {
          fanUsername = fanId;
        }
        // Log the PPV purchase info
        const price = evtData.price ?? evtData.message?.price ?? null;
        eventContent = price
          ? `Unlocked PPV ($${parseFloat(price).toFixed(2)})`
          : 'Unlocked a PPV message';
        console.log(`Fan ${fanId} unlocked a PPV message for $${price || '0'}`);

        // Immediately send a thank-you message from a random template
        const templateIndex = Math.floor(Math.random() * THANK_YOU_TEMPLATES.length);
        const thankYouTemplate = THANK_YOU_TEMPLATES[templateIndex];
        try {
          await sendMessageToFan(fanId, '', thankYouTemplate, 0, '', [], []); // no media, no price, just text
          // sendMessageToFan already inserts the outgoing message into DB
        } catch (err) {
          if (err.code === 'FAN_NOT_ELIGIBLE') {
            console.warn(`Fan ${fanId} not eligible for messages: ${err.message}`);
            // Fan cannot receive messages (e.g., unsubscribed); skip thank-you
          } else {
            console.error('Error sending thank-you message:', sanitizeError(err));
            // If error is transient, let webhook retry by returning 500
            return res
              .status(err.status || 500)
              .json({ error: 'Failed to send thank-you message' });
          }
        }
        thankYouMessage = thankYouTemplate; // store template text (with placeholder)
        // Replace placeholder [name] with actual Parker name for display
        try {
          const fanRes = await pool.query('SELECT parker_name FROM fans WHERE id=$1', [fanId]);
          const parkerName = fanRes.rows[0]?.parker_name || '';
          thankYouMessage = thankYouMessage.replace(/\{name\}|\[name\]|\{parker_name\}/g, parkerName);
        } catch {
          thankYouMessage = thankYouMessage.replace(/\{name\}|\[name\]|\{parker_name\}/g, '').trim();
        }
      } else {
        // Ignore other event types
        return res.status(200).json({ received: true });
      }

      // Prepare event object for front-end
      const eventObj = {
        type: eventType.includes('ppv') ? 'PPV Unlocked' : 'Message Received',
        fanId: fanId,
        fanUsername: fanUsername || fanId,
        time: now.toISOString(),
        content: eventContent || '',
        suggestion: suggestedReply || null,
        thankYou: thankYouMessage || null,
      };
      // Sanitize content and suggestion for safe output
      eventObj.content = escapeHtml(eventObj.content);
      if (eventObj.suggestion) eventObj.suggestion = escapeHtml(eventObj.suggestion);
      if (eventObj.thankYou) eventObj.thankYou = escapeHtml(eventObj.thankYou);

      // Add to recent events list (truncate list to last 100)
      recentEvents.push(eventObj);
      if (recentEvents.length > 100) {
        recentEvents.shift();
      }

      // Respond success
      res.json({ received: true });
    } catch (err) {
      console.error('Webhook processing error:', sanitizeError(err));
      res.status(500).json({ error: 'Failed to process webhook event' });
    }
  });

  // Endpoint for front-end to fetch recent events
  router.get('/events', (req, res) => {
    res.json({ events: recentEvents });
  });

  return router;
};
