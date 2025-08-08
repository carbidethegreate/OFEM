window.Queue = {
  async fetch() {
    try {
      const res = await fetch('/api/scheduledMessages');
      if (!res.ok) throw new Error('Failed to fetch scheduled messages');
      const data = await res.json();
      this.render(data.messages || []);
    } catch (err) {
      console.error('Error fetching scheduled messages:', err);
      alert('Error fetching scheduled messages');
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
      const res = await fetch(`/api/scheduledMessages/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to cancel message');
      this.fetch();
    } catch (err) {
      console.error('Error canceling message:', err);
      alert('Error canceling message');
    }
  },
  async edit(m) {
    const newBody = prompt('New message body:', m.body || '');
    if (newBody === null) return;
    const defaultTime = m.scheduled_at ? m.scheduled_at.slice(0,16) : '';
    const newTime = prompt('New schedule time (YYYY-MM-DDTHH:MM):', defaultTime);
    if (newTime === null) return;
    const newGreeting = prompt('New greeting:', m.greeting || '');
    const newPrice = prompt('New price:', m.price != null ? m.price : '');
    const newLocked = prompt('Lock message? (yes/no):', m.locked_text ? 'yes' : 'no');
    const payload = {};
    if (newBody.trim() !== '') payload.body = newBody;
    if (newTime.trim() !== '') payload.scheduledTime = newTime;
    if (newGreeting !== null) payload.greeting = newGreeting;
    if (newPrice !== null) {
      const trimmed = newPrice.trim();
      if (trimmed === '') payload.price = null;
      else {
        const priceNum = Number(trimmed);
        if (!isNaN(priceNum)) payload.price = priceNum;
      }
    }
    if (newLocked !== null) {
      const lower = newLocked.trim().toLowerCase();
      if (lower === 'yes') payload.lockedText = true;
      else if (lower === 'no') payload.lockedText = false;
    }
    try {
      const res = await fetch(`/api/scheduledMessages/${m.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to edit message');
      this.fetch();
    } catch (err) {
      console.error('Error editing message:', err);
      alert('Error editing message');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => Queue.fetch());
