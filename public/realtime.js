(function (global) {
  const REFRESH_INTERVAL_MS = 5000;
  let lastEventCount = 0;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => (
      {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c] || c
    ));
  }

  function renderEvents(events) {
    const tbody = global.document.getElementById('eventsTableBody');
    if (!tbody) return;
    if (!Array.isArray(events)) {
      tbody.innerHTML = '';
      return;
    }
    const rowsHtml = events
      .map((event, index) => {
        const fanCol = escapeHtml(event.fanUsername);
        const timeCol = escapeHtml(new Date(event.time).toLocaleString());
        const typeCol = escapeHtml(event.type);
        const contentCol = event.content ? escapeHtml(event.content) : '';
        const suggestionCol = event.suggestion ? escapeHtml(event.suggestion) : '';
        const thankYouCol = event.thankYou ? escapeHtml(event.thankYou) : '';
        let actionCol = '';
        if (event.suggestion && event.type.startsWith('Message')) {
          actionCol = `<button class="send-btn btn btn-primary" data-index="${index}">Send</button>`;
        }
        return `<tr>
                <td>${fanCol}</td>
                <td>${timeCol}</td>
                <td>${typeCol}</td>
                <td>${contentCol}</td>
                <td>${suggestionCol}</td>
                <td>${thankYouCol}</td>
                <td>${actionCol}</td>
              </tr>`;
      })
      .join('');
    tbody.innerHTML = rowsHtml;
    const buttons = tbody.querySelectorAll('.send-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', handleSendClick);
    });
  }

  async function fetchEvents() {
    try {
      const res = await global.fetch('/api/events');
      if (!res.ok) throw new Error('Failed to fetch events');
      const data = await res.json();
      const events = data.events || [];
      if (events.length !== lastEventCount) {
        renderEvents(events);
        lastEventCount = events.length;
      }
    } catch (err) {
      console.error('Error fetching events:', err);
    }
  }

  async function handleSendClick(e) {
    const btn = e.currentTarget;
    const rowIndex = btn.getAttribute('data-index');
    if (rowIndex == null) return;
    try {
      const res = await global.fetch('/api/events');
      const data = await res.json();
      const events = data.events || [];
      if (!events[rowIndex]) throw new Error('Event not found');
      const fanId = events[rowIndex].fanId;
      const body = events[rowIndex].suggestion;
      const sendRes = await global.fetch('/api/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: fanId, body }),
      });
      if (!sendRes.ok) {
        let errData;
        try {
          errData = await sendRes.json();
        } catch {}
        const errMsg = errData && errData.error ? errData.error : 'Failed to send reply';
        global.alert(errMsg);
        throw new Error(errMsg);
      }
      btn.disabled = true;
      btn.textContent = 'Sent';
      console.log(`AI reply sent to fan ${fanId}`);
    } catch (err) {
      console.error('Error sending AI reply:', err);
    }
  }

  async function init() {
    await fetchEvents();
    global.setInterval(fetchEvents, REFRESH_INTERVAL_MS);
  }

  global.App = global.App || {};
  global.App.RealTime = { init };
})(typeof window !== 'undefined' ? window : this);
