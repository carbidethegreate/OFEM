(function () {
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
      const res = await fetch('/api/fans/unfollowed');
      if (!res.ok) throw new Error('Failed to fetch unfollowed fans');
      const data = await res.json();
      unfollowed = data.fans || [];
      renderTable();
    } catch (err) {
      console.error('Error loading unfollowed fans:', err);
      alert('Failed to fetch unfollowed fans');
    }
  }

  function renderTable() {
    const tbody = document.getElementById('followTableBody');
    tbody.innerHTML = '';
    unfollowed.forEach((fan) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' +
        escapeHtml(fan.username || '') +
        '</td>' +
        '<td id="status-' +
        fan.id +
        '"></td>';
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

  function followAll() {
    const total = unfollowed.length;
    let success = 0;
    let processed = 0;

    document.getElementById('followBtn').disabled = true;
    document.getElementById('statusMsg').innerText = 'Followed 0 of ' + total;

    const source = new EventSource('/api/fans/followAll');

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.done) {
          source.close();
          document.getElementById('followBtn').disabled = false;
          return;
        }
        setStatusDot(data.id, data.success ? 'green' : 'red');
        processed++;
        if (data.success) success++;
        document.getElementById('statusMsg').innerText =
          'Followed ' + success + ' of ' + total;
        if (processed >= total) {
          source.close();
          document.getElementById('followBtn').disabled = false;
        }
      } catch (err) {
        console.error('Error parsing SSE data', err);
        alert('Error processing follow response');
      }
    };

    source.onerror = (err) => {
      console.error('SSE error', err);
      alert('Error following fans');
      source.close();
      document.getElementById('followBtn').disabled = false;
    };
  }

  document.getElementById('followBtn').addEventListener('click', followAll);
  loadUnfollowed();
})();
