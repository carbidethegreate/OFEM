const { sanitizeLogPayload } = require('../sanitizeError');

const VALID_LEVELS = new Set(['info', 'warn', 'error']);

function normalizeLevel(level) {
  if (!level) return 'info';
  const normalized = String(level).toLowerCase();
  return VALID_LEVELS.has(normalized) ? normalized : 'info';
}

function buildMeta({ itemId, event, level, meta }) {
  const base = {
    context: {
      itemId: itemId ?? null,
      event: event || null,
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
    item_id: row.item_id,
    level: row.level,
    event: row.event,
    message: row.message,
    meta: row.meta || {},
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function createBulkLogger({ pool, sanitizeError }) {
  const logError = sanitizeError || ((err) => err);

  async function appendLog({ itemId = null, level = 'info', event = null, message = '', meta = {} }) {
    try {
      await pool.query(
        'INSERT INTO bulk_logs (item_id, level, event, message, meta) VALUES ($1, $2, $3, $4, $5)',
        [
          itemId || null,
          normalizeLevel(level),
          event,
          message,
          buildMeta({ itemId, event, level, meta }),
        ],
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to write bulk log:', logError(err));
    }
  }

  async function fetchLogs({ itemId = null, level, page = 1, pageSize = 20 }) {
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const safePageSize = Math.min(parseInt(pageSize, 10) || 20, 100);
    const offset = (safePage - 1) * safePageSize;

    const filters = [];
    const values = [];
    if (itemId != null) {
      filters.push(`item_id = $${values.length + 1}`);
      values.push(itemId);
    }
    if (level) {
      filters.push(`level = $${values.length + 1}`);
      values.push(normalizeLevel(level));
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const logsRes = await pool.query(
      `SELECT * FROM bulk_logs ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, safePageSize, offset],
    );
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM bulk_logs ${where}`,
      values,
    );

    const globalFilters = ['item_id IS NULL'];
    const globalValues = [];
    if (level) {
      globalFilters.push(`level = $${globalValues.length + 1}`);
      globalValues.push(normalizeLevel(level));
    }
    const globalsRes = await pool.query(
      `SELECT * FROM bulk_logs
       WHERE ${globalFilters.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
      globalValues,
    );

    return {
      logs: logsRes.rows.map(formatLogRow),
      globals: globalsRes.rows.map(formatLogRow),
      page: safePage,
      pageSize: safePageSize,
      total: countRes.rows[0]?.count || 0,
    };
  }

  return { appendLog, fetchLogs, formatLogRow };
}

module.exports = { createBulkLogger, formatLogRow };
