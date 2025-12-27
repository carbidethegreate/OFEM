/*
  OFEM Reply Assistant CLI
  -----------------------
  Subcommands:
    - fetch: read unread chats, generate reply suggestions with OpenAI, write suggestions.json
    - send: send suggested replies from suggestions.json (supports --dry and --file)

  This file is intentionally standalone and does not depend on the OFEM server.
*/

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

// Env (supports OF_* aliases for compatibility with other tooling)
const OF_API_KEY = (process.env.OF_API_KEY || process.env.ONLYFANS_API_KEY || '').trim();
const OF_ACCOUNT_ID = (process.env.OF_ACCOUNT_ID || process.env.ONLYFANS_ACCOUNT_ID || '').trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

const DEFAULT_ONLYFANS_API_BASE = 'https://app.onlyfansapi.com/api';
const ONLYFANS_API_BASE = ((process.env.ONLYFANS_API_BASE || DEFAULT_ONLYFANS_API_BASE) + '')
  .trim()
  .replace(/\/+$/, '');

const of = axios.create({
  baseURL: `${ONLYFANS_API_BASE}/${encodeURIComponent(OF_ACCOUNT_ID)}`,
  headers: { Authorization: `Bearer ${OF_API_KEY}` },
  timeout: 30000,
});

const openai = OPENAI_API_KEY
  ? axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      timeout: 60000,
    })
  : null;

// Shared tunables
const CHAT_ORDER = 'recent';
const SKIP_USERS = 'none';

// Fetch tunables
const CHATS_LIMIT = 50;
const HISTORY_MSG_LIMIT_FETCH = 20;
const OPENAI_MODEL = 'gpt-4o';
const OPENAI_TEMPERATURE = 0.6;
const OPENAI_MAX_TOKENS = 200;
const OUTPUT_FILE = path.resolve(process.cwd(), 'suggestions.json');

// Send tunables
const RECHECK_SKIP_PAID = true;
const HISTORY_MSG_LIMIT_SEND = 10;
const CONCURRENCY = 5;

function assertEnv(requireOpenAI = false) {
  if (!OF_API_KEY || !OF_ACCOUNT_ID) {
    console.error(
      'Missing ONLYFANS_API_KEY/ONLYFANS_ACCOUNT_ID (or OF_API_KEY/OF_ACCOUNT_ID) in .env',
    );
    process.exit(1);
  }
  if (requireOpenAI && !OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY in .env');
    process.exit(1);
  }
}

function isSentByMe(message) {
  if (!message || typeof message !== 'object') return false;
  return !!(
    message.isSentByMe ??
    message.is_sent_by_me ??
    message.isFromMe ??
    message.is_from_me ??
    message.fromMe ??
    message.from_me
  );
}

function getMessagePrice(message) {
  const raw = message?.price;
  if (typeof raw === 'number') return raw;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMessageText(message) {
  const raw = message?.text;
  if (typeof raw === 'string') return raw;
  return '';
}

function getMediaCount(message) {
  const raw = message?.mediaCount ?? message?.media_count;
  if (typeof raw === 'number') return raw;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMediaReady(message) {
  const raw = message?.isMediaReady ?? message?.is_media_ready;
  if (typeof raw === 'boolean') return raw;
  return true;
}

function getFromUserId(message) {
  return (
    message?.fromUser?.id ??
    message?.from_user?.id ??
    message?.from_user_id ??
    message?.fromUserId ??
    'unknown'
  );
}

async function listUnreadChats({ limit = CHATS_LIMIT, offset = 0 } = {}) {
  const resp = await of.get('/chats', {
    params: {
      limit,
      offset,
      skip_users: SKIP_USERS,
      order: CHAT_ORDER,
      filter: 'unread',
    },
  });
  return resp.data;
}

async function listRecentMessages({ chatId, limit }) {
  const resp = await of.get(`/chats/${encodeURIComponent(chatId)}/messages`, {
    params: { limit: String(limit), order: 'desc', skip_users: 'all' },
  });
  const messages = Array.isArray(resp.data?.data)
    ? resp.data.data
    : Array.isArray(resp.data)
      ? resp.data
      : [];
  messages.reverse();
  return messages;
}

function shouldSkipPaid(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (isSentByMe(m)) {
      const price = getMessagePrice(m);
      if (price > 0) return true;
      return false;
    }
  }
  return false;
}

function messagesToPlainTextTranscript(messages) {
  return messages
    .map((m) => {
      const who = isSentByMe(m) ? 'Me' : `Fan(${getFromUserId(m)})`;
      const text = getMessageText(m).replace(/\s+/g, ' ').trim();
      const mediaCount = getMediaCount(m);
      const mediaNote =
        mediaCount > 0
          ? ` [media:${mediaCount}${isMediaReady(m) ? '' : ',processing'}]`
          : '';
      const price = getMessagePrice(m);
      const paidNote = price > 0 ? ` [paid:$${price}]` : '';
      return `${who}: ${text}${mediaNote}${paidNote}`;
    })
    .join('\n');
}

async function suggestReply({ transcript }) {
  if (!openai) throw new Error('OPENAI_API_KEY missing');

  const systemPrompt =
    'You are a top-performing OnlyFans chat operator. Your tone must be spicy, friendly, masculine, and cocky-confident. Keep it enticing but natural. Keep replies concise (1-3 sentences), plain text, no emojis. Never mention prices or payments unless explicitly asked. If the fan asks a question, answer directly and escalate the vibe playfully.';

  const userPrompt = [
    'Conversation transcript (oldest to newest):',
    '----------------',
    transcript || '(no recent messages)',
    '----------------',
    'Write a single suggested reply that I can send right now.',
    'Constraints:',
    '- Keep it plain text, no emojis.',
    '- 1-3 sentences max.',
    '- Stay spicy, friendly, masculine, cocky-confident.',
  ].join('\n');

  const resp = await openai.post('/chat/completions', {
    model: OPENAI_MODEL,
    temperature: OPENAI_TEMPERATURE,
    max_tokens: OPENAI_MAX_TOKENS,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  return resp.data?.choices?.[0]?.message?.content?.trim() || '';
}

function summarizeMessage(m) {
  return {
    id: m?.id,
    createdAt: m?.createdAt ?? m?.created_at,
    isSentByMe: isSentByMe(m),
    text: getMessageText(m),
    mediaCount: getMediaCount(m),
    price: getMessagePrice(m),
  };
}

function getChatId(chat) {
  return (
    chat?.fan?.id ??
    chat?.id ??
    chat?.chatId ??
    chat?.chat_id ??
    chat?.lastMessage?.fromUser?.id ??
    chat?.lastMessage?.from_user?.id ??
    null
  );
}

async function cmdFetch() {
  assertEnv(true);

  let offset = 0;
  const aggregated = [];

  while (true) {
    const page = await listUnreadChats({ limit: CHATS_LIMIT, offset });
    const chats = Array.isArray(page?.data) ? page.data : [];
    if (chats.length === 0) break;

    for (const chat of chats) {
      const chatId = getChatId(chat);
      if (!chatId) continue;

      const messages = await listRecentMessages({
        chatId,
        limit: HISTORY_MSG_LIMIT_FETCH,
      });
      if (messages.length === 0) continue;

      if (shouldSkipPaid(messages)) continue;

      const transcript = messagesToPlainTextTranscript(messages);
      let suggestedReply = '';
      try {
        suggestedReply = await suggestReply({ transcript });
      } catch (e) {
        const err = e?.response?.data || e?.message || 'unknown error';
        suggestedReply = `(error generating suggestion: ${
          typeof err === 'string' ? err : 'see logs'
        })`;
      }

      aggregated.push({
        chatId,
        unreadMessagesCount: chat?.unreadMessagesCount ?? chat?.unread_messages_count ?? 0,
        fan: {
          id: chat?.fan?.id,
          name: chat?.fan?.name,
          username: chat?.fan?.username,
          avatar: chat?.fan?.avatar,
        },
        lastMessageAt: chat?.lastMessage?.createdAt ?? chat?.lastMessage?.created_at,
        context: messages.map(summarizeMessage),
        suggestedReply,
      });
    }

    const next = page?._pagination?.next_page;
    if (!next) break;
    offset += CHATS_LIMIT;
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify({ suggestions: aggregated }, null, 2),
    'utf8',
  );
  console.log(`Wrote ${aggregated.length} suggestions to ${OUTPUT_FILE}`);
}

async function sendMessage({ chatId, text }) {
  const resp = await of.post(`/chats/${encodeURIComponent(chatId)}/messages`, {
    text,
  });
  return resp.data;
}

function loadSuggestions(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const json = JSON.parse(raw);
  return Array.isArray(json) ? json : json.suggestions || [];
}

async function processOneSend(entry, { dryRun }) {
  const chatId = entry.chatId || entry.fan?.id;
  const text = (entry.suggestedReply || '').trim();

  if (!chatId) throw new Error('Missing chatId');
  if (!text) throw new Error('Empty suggestedReply');

  if (RECHECK_SKIP_PAID) {
    const msgs = await listRecentMessages({
      chatId,
      limit: HISTORY_MSG_LIMIT_SEND,
    });
    if (shouldSkipPaid(msgs)) {
      return { chatId, status: 'skipped_paid' };
    }
  }

  if (dryRun) {
    return { chatId, status: 'dry_run' };
  }

  await sendMessage({ chatId, text });
  return { chatId, status: 'sent' };
}

async function cmdSend(args) {
  assertEnv(false);

  const dryRun = args.includes('--dry');
  const fileFlagIndex = args.findIndex((a) => a === '--file');
  const inputPath = fileFlagIndex !== -1 ? args[fileFlagIndex + 1] : 'suggestions.json';

  const suggestions = loadSuggestions(inputPath);
  if (suggestions.length === 0) {
    console.error('No suggestions found to send.');
    process.exit(1);
  }

  const results = [];
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= suggestions.length) break;
      const current = suggestions[i];
      try {
        const res = await processOneSend(current, { dryRun });
        results.push(res);
        console.log(`[${res.status}] chatId=${res.chatId}`);
      } catch (e) {
        const err = e?.response?.data || e?.message || 'unknown error';
        results.push({
          chatId: current.chatId || current.fan?.id,
          status: 'error',
          error: err,
        });
        console.log(
          `[error] chatId=${current.chatId || current.fan?.id} err=${JSON.stringify(err)}`,
        );
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, suggestions.length) },
    () => worker(),
  );
  await Promise.all(workers);

  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  console.log('Summary:', summary);
  console.log(JSON.stringify({ results }, null, 2));
}

async function main() {
  const [, , cmd, ...args] = process.argv;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(
      'Usage:\n  node src/cli.js fetch\n  node src/cli.js send [--dry] [--file suggestions.json]',
    );
    process.exit(0);
  }

  if (cmd === 'fetch') return cmdFetch();
  if (cmd === 'send') return cmdSend(args);

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err?.response?.data || err?.message || err);
  process.exit(1);
});
