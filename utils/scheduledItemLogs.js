const { sanitizeLogPayload } = require('../sanitizeError');

const VALID_LEVELS = new Set(['info', 'warn', 'error']);

function normalizeLevel(level) {
  if (!level) return 'info';
  const normalized = String(level).toLowerCase();
  return VALID_LEVELS.has(normalized) ? normalized : 'info';
}

function buildMeta({ itemId, step, level, meta }) {
  const base = {
    context: {
      itemId: itemId ?? null,
      step: step || null,
      level: normalizeLevel(level),
    },
  };
  if (meta && typeof meta === 'object') {
    return sanitizeLogPayload({ ...base, ...meta });
  }
  return sanitizeLogPayload({ ...base, data: meta });
}

function formatLogRow(row) {
  return {
    id: row.id,
    scheduled_item_id: row.scheduled_item_id,
    step: row.step,
    phase: row.phase,
    level: row.level,
    message: row.message,
    meta: row.meta || {},
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function createScheduledItemLogger({ pool, sanitizeError }) {
  const logError = sanitizeError || ((err) => err);

  async function appendLog({
    itemId = null,
    step = null,
    phase = null,
    level = 'info',
    message = '',
    meta = {},
  }) {
    try {
      await pool.query(
        `INSERT INTO scheduled_item_logs
         (scheduled_item_id, step, phase, level, message, meta)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          itemId || null,
          step,
          phase,
          normalizeLevel(level),
          message,
          buildMeta({ itemId, step, level, meta }),
        ],
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to write scheduled item log:', logError(err));
    }
  }

  async function fetchLogs({ itemId, page = 1, pageSize = 50 }) {
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const safePageSize = Math.min(parseInt(pageSize, 10) || 50, 100);
    const offset = (safePage - 1) * safePageSize;
    const filters = [];
    const values = [];
    if (itemId != null) {
      filters.push(`scheduled_item_id = $${values.length + 1}`);
      values.push(itemId);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const logsRes = await pool.query(
      `SELECT * FROM scheduled_item_logs ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, safePageSize, offset],
    );
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM scheduled_item_logs ${where}`,
      values,
    );
    return {
      logs: logsRes.rows.map(formatLogRow),
      page: safePage,
      pageSize: safePageSize,
      total: countRes.rows[0]?.count || 0,
    };
  }

  return { appendLog, fetchLogs, formatLogRow };
}

module.exports = { createScheduledItemLogger, formatLogRow };
