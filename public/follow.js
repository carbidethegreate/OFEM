(function (global) {
  let unfollowed = [];

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

  async function loadUnfollowed() {
    try {
      const res = await global.fetch('/api/fans/unfollowed');
      if (!res.ok) throw new Error('Failed to fetch unfollowed fans');
      const data = await res.json();
      unfollowed = data.fans || [];
      renderTable();
    } catch (err) {
      global.console.error('Error loading unfollowed fans:', err);
      global.alert('Failed to fetch unfollowed fans');
    }
  }

  function renderTable() {
    const tbody = global.document.getElementById('followTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    unfollowed.forEach((fan) => {
      const tr = global.document.createElement('tr');
      tr.innerHTML =
        '<td>' +
        escapeHtml(fan.username || '') +
        '</td>' +
        '<td id="status-' +
        fan.id +
        '"></td>';
      tbody.appendChild(tr);
    });
    const btn = global.document.getElementById('followBtn');
    if (btn) btn.disabled = unfollowed.length === 0;
    const statusMsg = global.document.getElementById('statusMsg');
    if (statusMsg) {
      statusMsg.textContent =
        unfollowed.length === 0
          ? 'No fans to follow. Please run /api/refreshFans to sync.'
          : '';
    }
  }

  function setStatusDot(id, color) {
    const el = global.document.getElementById('status-' + id);
    if (el) {
      el.innerHTML = '<span class="dot ' + escapeHtml(color) + '"></span>';
    }
  }

  function followAll() {
    const total = unfollowed.length;
    let success = 0;
    let processed = 0;

    const followBtn = global.document.getElementById('followBtn');
    if (followBtn) followBtn.disabled = true;
    const statusMsg = global.document.getElementById('statusMsg');
    if (statusMsg) statusMsg.innerText = 'Followed 0 of ' + total;

    const source = new global.EventSource('/api/fans/followAll');

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.done) {
          source.close();
          if (followBtn) followBtn.disabled = false;
          return;
        }
        setStatusDot(data.id, data.success ? 'green' : 'red');
        processed++;
        if (data.success) success++;
        if (statusMsg)
          statusMsg.innerText = 'Followed ' + success + ' of ' + total;
        if (processed >= total) {
          source.close();
          if (followBtn) followBtn.disabled = false;
        }
      } catch (err) {
        global.console.error('Error parsing SSE data', err);
        global.alert('Error processing follow response');
      }
    };

    source.onerror = (err) => {
      global.console.error('SSE error', err);
      global.alert('Error following fans');
      source.close();
      if (followBtn) followBtn.disabled = false;
    };
  }

  function init() {
    const btn = global.document.getElementById('followBtn');
    if (btn) btn.addEventListener('click', followAll);
    loadUnfollowed();
  }

  const Follow = {
    loadUnfollowed,
    renderTable,
    setStatusDot,
    followAll,
    init,
  };

  global.App = global.App || {};
  global.App.Follow = Follow;

  if (typeof module !== 'undefined') {
    module.exports = Follow;
  }

  global.document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : global);
