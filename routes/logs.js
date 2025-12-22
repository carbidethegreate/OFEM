const express = require('express');
const { createBulkLogger } = require('../utils/bulkLogs');

module.exports = function ({
  pool,
  hasScheduledItemsTables = () => true,
  logsTable = 'scheduled_item_logs',
}) {
  const router = express.Router();
  const { fetchLogs } = createBulkLogger({ pool, tableName: logsTable });

  router.get('/logs', async (req, res) => {
    if (!hasScheduledItemsTables()) {
      return res.status(503).json({
        error:
          'scheduled_items/scheduled_item_logs tables missing; run migrations to enable scheduling',
      });
    }

    try {
      const parsedItemId =
        req.query.itemId !== undefined ? parseInt(req.query.itemId, 10) : null;
      const itemId = Number.isNaN(parsedItemId) ? null : parsedItemId;
      const level = req.query.level;
      const page = req.query.page;
      const pageSize = req.query.pageSize;
      const data = await fetchLogs({ itemId, level, page, pageSize });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  return router;
};
