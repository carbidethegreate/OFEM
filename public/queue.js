(function (global) {
  const Queue = {
    async fetch() {
      try {
        const res = await global.fetch('/api/scheduledMessages');
        if (!res.ok) throw new Error('Failed to fetch scheduled messages');
        const data = await res.json();
        this.render(data.messages || []);
      } catch (err) {
        global.console.error('Error fetching scheduled messages:', err);
        global.alert('Error fetching scheduled messages');
      }
    },
    init() {
      this.editModal = global.document.getElementById('editModal');
      this.editForm = global.document.getElementById('editForm');
      this.editBody = global.document.getElementById('editBody');
      this.editTime = global.document.getElementById('editTime');
      this.editGreeting = global.document.getElementById('editGreeting');
      this.editPrice = global.document.getElementById('editPrice');
      this.editLocked = global.document.getElementById('editLocked');
      this.currentMessage = null;
      if (this.editForm) {
        this.editForm.addEventListener('submit', (e) => this.submitEdit(e));
      }
      const cancelBtn = global.document.getElementById('editCancel');
      if (cancelBtn) cancelBtn.addEventListener('click', () => this.hideEdit());
    },
    render(messages) {
      const tbody = global.document.querySelector('#queueTable tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      for (const m of messages) {
        const tr = global.document.createElement('tr');
        const msgText = [m.greeting || '', m.body || '']
          .filter(Boolean)
          .join(' ')
          .trim();
        const time = m.scheduled_at
          ? new Date(m.scheduled_at).toLocaleString()
          : '';
        tr.innerHTML = `<td>${m.id}</td><td>${msgText}</td><td>${time}</td>`;
        const actionsTd = global.document.createElement('td');
        const editBtn = global.document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.className = 'btn btn-secondary';
        editBtn.addEventListener('click', () => this.edit(m));
        const cancelBtn = global.document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.addEventListener('click', () => this.cancel(m.id));
        actionsTd.appendChild(editBtn);
        actionsTd.appendChild(cancelBtn);
        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
      }
    },
    async cancel(id) {
      try {
        const res = await global.fetch(`/api/scheduledMessages/${id}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to cancel message');
        this.fetch();
      } catch (err) {
        global.console.error('Error canceling message:', err);
        global.alert('Error canceling message');
      }
    },
    edit(m) {
      this.currentMessage = m;
      if (this.editBody) this.editBody.value = m.body || '';
      if (this.editTime)
        this.editTime.value = m.scheduled_at ? m.scheduled_at.slice(0, 16) : '';
      if (this.editGreeting) this.editGreeting.value = m.greeting || '';
      if (this.editPrice) this.editPrice.value = m.price != null ? m.price : '';
      if (this.editLocked) this.editLocked.checked = !!m.locked_text;
      if (this.editModal) this.editModal.classList.add('show');
    },
    hideEdit() {
      if (this.editModal) this.editModal.classList.remove('show');
      this.currentMessage = null;
    },
    async submitEdit(e) {
      e.preventDefault();
      if (!this.currentMessage) return;
      const payload = {};
      const body = this.editBody.value.trim();
      const time = this.editTime.value.trim();
      const greeting = this.editGreeting.value;
      const price = this.editPrice.value.trim();
      const locked = this.editLocked.checked;
      if (body !== '') payload.body = body;
      if (time !== '') {
        const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
        if (!re.test(time)) {
          global.alert('Time must be in YYYY-MM-DDTHH:MM format');
          return;
        }
        const scheduledDate = new Date(time);
        if (isNaN(scheduledDate.getTime()) || scheduledDate < new Date()) {
          global.alert('Scheduled time cannot be in the past');
          return;
        }
        payload.scheduledTime = time;
      }
      payload.greeting = greeting;
      if (price !== '') {
        const priceNum = Number(price);
        if (isNaN(priceNum)) {
          global.alert('Price must be a number');
          return;
        }
        payload.price = priceNum;
      } else {
        payload.price = null;
      }
      payload.lockedText = locked;
      try {
        const res = await global.fetch(
          `/api/scheduledMessages/${this.currentMessage.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        if (!res.ok) throw new Error('Failed to edit message');
        this.hideEdit();
        this.fetch();
      } catch (err) {
        global.console.error('Error editing message:', err);
        global.alert('Error editing message');
      }
    },
  };

  global.App = global.App || {};
  global.App.Queue = Queue;

  if (typeof module !== 'undefined') {
    module.exports = Queue;
  }

  global.document.addEventListener('DOMContentLoaded', () => {
    Queue.init();
    Queue.fetch();
    const refreshBtn = global.document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => Queue.fetch());
    global.setInterval(() => Queue.fetch(), 60000);
  });
})(typeof window !== 'undefined' ? window : global);
