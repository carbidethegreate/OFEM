const express = require('express');

module.exports = function ({ activityLogs }) {
  const router = express.Router();

  router.get('/logs', (req, res) => {
    res.json({ logs: activityLogs });
  });

  return router;
};
