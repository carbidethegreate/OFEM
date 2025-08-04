window.Queue = {
  async fetch() {
    try {
      const res = await fetch('/api/scheduledMessages');
      const data = await res.json();
      this.render(data.messages || []);
    } catch (err) {
      console.error('Error fetching scheduled messages:', err);
    }
  },
  render(messages) {
    const tbody = document.querySelector('#queueTable tbody');
    tbody.innerHTML = '';
    for (const m of messages) {
      const tr = document.createElement('tr');
      const msgText = [m.greeting || '', m.body || ''].filter(Boolean).join(' ').trim();
      const time = m.scheduled_at ? new Date(m.scheduled_at).toLocaleString() : '';
      tr.innerHTML = `<td>${m.id}</td><td>${msgText}</td><td>${time}</td>`;
      const actionsTd = document.createElement('td');
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.className = 'btn btn-secondary';
      editBtn.addEventListener('click', () => this.edit(m));
      const cancelBtn = document.createElement('button');
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
      await fetch(`/api/scheduledMessages/${id}`, { method: 'DELETE' });
      this.fetch();
    } catch (err) {
      console.error('Error canceling message:', err);
    }
  },
  async edit(m) {
    const combined = [m.greeting || '', m.body || ''].filter(Boolean).join(' ').trim();
    const newBody = prompt('Edit message:', combined);
    if (newBody === null) return;
    const defaultTime = m.scheduled_at ? m.scheduled_at.slice(0,16) : '';
    const newTime = prompt('New schedule time (YYYY-MM-DDTHH:MM):', defaultTime);
    if (newTime === null) return;
    try {
      await fetch(`/api/scheduledMessages/${m.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newBody, scheduledTime: newTime })
      });
      this.fetch();
    } catch (err) {
      console.error('Error editing message:', err);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => Queue.fetch());
