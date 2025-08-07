(function() {
  let unfollowed = [];

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);
  }

  async function loadUnfollowed() {
    try {
      const res = await fetch('/api/fans/unfollowed');
      if (!res.ok) throw new Error('Failed to fetch unfollowed fans');
      const data = await res.json();
      unfollowed = data.fans || [];
      renderTable();
    } catch (err) {
      console.error('Error loading unfollowed fans:', err);
    }
  }

  function renderTable() {
    const tbody = document.getElementById('followTableBody');
    tbody.innerHTML = '';
    unfollowed.forEach(fan => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + escapeHtml(fan.username || '') + '</td>' +
                     '<td id="status-' + fan.id + '"></td>';
      tbody.appendChild(tr);
    });
    document.getElementById('followBtn').disabled = unfollowed.length === 0;
  }

  function setStatusDot(id, color) {
    const el = document.getElementById('status-' + id);
    if (el) {
      el.innerHTML = '<span class="dot ' + escapeHtml(color) + '"></span>';
    }
  }

  async function followAll() {
    const total = unfollowed.length;
    let success = 0;
    for (const fan of unfollowed) {
      try {
        const res = await fetch('/api/fans/' + fan.id + '/follow', { method: 'POST' });
        if (res.ok) {
          setStatusDot(fan.id, 'green');
          success++;
        } else {
          setStatusDot(fan.id, 'red');
        }
      } catch (err) {
        console.error('Error following fan', fan.id, err);
        setStatusDot(fan.id, 'red');
      }
      document.getElementById('statusMsg').innerText = 'Followed ' + success + ' of ' + total;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  document.getElementById('followBtn').addEventListener('click', followAll);
  loadUnfollowed();
})();
