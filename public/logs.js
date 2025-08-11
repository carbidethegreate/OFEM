(function (global) {
  async function fetchLogs() {
    const res = await global.fetch('/api/logs');
    if (!res.ok) throw new Error('Failed to fetch logs');
    const data = await res.json();
    return data.logs || [];
  }

  function renderLogs(logs) {
    const container = global.document.getElementById('logContainer');
    if (!container) return;
    const html = logs
      .map(
        (l) =>
          `<div class="log-entry log-${escapeHtml(l.level)}"><span class="log-time">${escapeHtml(l.time)}</span> [${escapeHtml(l.level)}] ${escapeHtml(l.msg)}</div>`,
      )
      .join('');
    container.innerHTML = html || '<p>No logs yet.</p>';
  }

  async function refresh() {
    try {
      const logs = await fetchLogs();
      renderLogs(logs);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error fetching logs', err);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  }

  function init() {
    const btn = global.document.getElementById('refreshLogsBtn');
    if (btn) btn.addEventListener('click', refresh);
    refresh();
  }

  const ActivityLogs = { fetchLogs, renderLogs, refresh, init };
  global.App = global.App || {};
  global.App.ActivityLogs = ActivityLogs;
  if (typeof module !== 'undefined') module.exports = ActivityLogs;
})(typeof window !== 'undefined' ? window : global);
