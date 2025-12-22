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
        (l) => {
          const level = l.level || 'info';
          const time = l.created_at || l.time || l.timestamp || '';
          const message = l.message || l.msg || '';
          const event = l.event ? `[${l.event}] ` : '';
          const meta =
            l.meta && Object.keys(l.meta).length
              ? ` ${escapeHtml(JSON.stringify(l.meta))}`
              : '';
          return `<div class="log-entry log-${escapeHtml(level)}"><span class="log-time">${escapeHtml(time)}</span> [${escapeHtml(level)}] ${escapeHtml(event)}${escapeHtml(message)}${meta}</div>`;
        },
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
