(function (global) {
  async function fetchPpvs() {
    try {
      const res = await global.fetch('/api/ppv');
      if (!res.ok) return;
      const data = await res.json();
      renderPpvTable(data.ppvs || []);
    } catch (err) {
      global.console.error('Error fetching PPVs:', err);
    }
  }

  function formatTime(time24) {
    const [hStr, mStr = '00'] = time24.split(':');
    let hour = parseInt(hStr, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${String(hour).padStart(2, '0')}:${mStr.padStart(2, '0')} ${ampm}`;
  }

  function renderPpvTable(ppvs) {
    const tbody = global.document.getElementById('ppvTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    for (const p of ppvs) {
      const day = p.scheduleDay != null ? p.scheduleDay : 'None';
      const time = p.scheduleTime ? formatTime(p.scheduleTime) : 'None';
      const tr = global.document.createElement('tr');
      tr.innerHTML = `<td>${p.ppv_number}</td><td>${p.message || ''}</td><td>${p.price}</td><td>${day}</td><td>${time}</td><td><button class="btn btn-primary" onclick="App.PPV.sendPpvPrompt(${p.id})">Send</button> <button class="btn btn-secondary" onclick="App.PPV.deletePpv(${p.id})">Delete</button></td>`;
      tbody.appendChild(tr);
    }
  }

  function linkPreviewInclude(includeCb, previewCb) {
    // Previewing a media item without including it would break the PPV message,
    // so keep the "Include" and "Preview" checkboxes in sync.
    includeCb.addEventListener('change', () => {
      if (!includeCb.checked) previewCb.checked = false;
    });
    previewCb.addEventListener('change', () => {
      if (previewCb.checked) includeCb.checked = true;
    });
  }

  async function loadVaultMedia() {
    try {
      const res = await global.fetch('/api/vault-media');
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data) ? data : [];
      const container = global.document.getElementById('vaultMediaList');
      if (!container) return;
      container.innerHTML = '';
      for (const m of items) {
        const div = global.document.createElement('div');
        div.className = 'media-item';

        const thumb =
          (m.preview && (m.preview.url || m.preview.src)) ||
          (m.thumb && (m.thumb.url || m.thumb.src));
        if (thumb) {
          const img = global.document.createElement('img');
          img.src = thumb;
          div.appendChild(img);
        }

        const idSpan = global.document.createElement('span');
        idSpan.className = 'media-id';
        idSpan.textContent = 'ID: ' + m.id;
        div.appendChild(idSpan);

        const includeLabel = global.document.createElement('label');
        const mediaCb = global.document.createElement('input');
        mediaCb.type = 'checkbox';
        mediaCb.className = 'mediaCheckbox';
        mediaCb.value = m.id;
        includeLabel.appendChild(mediaCb);
        includeLabel.append(' Include');
        div.appendChild(includeLabel);

        const previewLabel = global.document.createElement('label');
        const previewCb = global.document.createElement('input');
        previewCb.type = 'checkbox';
        previewCb.className = 'previewCheckbox';
        previewCb.value = m.id;
        previewLabel.appendChild(previewCb);
        previewLabel.append(' Preview');
        div.appendChild(previewLabel);

        linkPreviewInclude(mediaCb, previewCb);

        container.appendChild(div);
      }
    } catch (err) {
      global.console.error('Error loading vault media:', err);
    }
  }

  async function uploadMedia() {
    const input = global.document.getElementById('mediaUploadInput');
    if (!input || !input.files.length) return;
    const formData = new global.FormData();
    for (const file of input.files) {
      formData.append('media', file);
    }
    try {
      const res = await global.fetch('/api/vault-media', {
        method: 'POST',
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) {
        global.alert(result.error || 'Failed to upload media');
        return;
      }
      input.value = '';
      await loadVaultMedia();
    } catch (err) {
      global.console.error('Error uploading media:', err);
    }
  }

  async function savePpv() {
    const ppvNumber = parseInt(global.document.getElementById('ppvNumber').value, 10);
    const message = global.document.getElementById('message').value.trim();
    const price = parseFloat(global.document.getElementById('price').value);
    const mediaFiles = Array.from(
      global.document.querySelectorAll('.mediaCheckbox:checked'),
    ).map((cb) => Number(cb.value));
    const previews = Array.from(
      global.document.querySelectorAll('.previewCheckbox:checked'),
    ).map((cb) => Number(cb.value));
    const scheduleDayVal = global.document.getElementById('scheduleDay').value;
    const scheduleTime = global.document.getElementById('scheduleTime').value;
    const scheduleDay = scheduleDayVal ? parseInt(scheduleDayVal, 10) : null;

    if ((scheduleDay == null) !== !scheduleTime) {
      global.alert('Both schedule day and time must be provided');
      return;
    }
    if (scheduleDay != null) {
      if (
        !Number.isInteger(scheduleDay) ||
        scheduleDay < 1 ||
        scheduleDay > 31
      ) {
        global.alert('scheduleDay must be an integer between 1 and 31');
        return;
      }
      if (typeof scheduleTime !== 'string' || !/^\d{2}:\d{2}$/.test(scheduleTime)) {
        global.alert('scheduleTime must be in HH:MM format');
        return;
      }
      const [h, m] = scheduleTime.split(':').map(Number);
      if (h < 0 || h > 23 || m < 0 || m > 59) {
        global.alert('scheduleTime must be in 24-hour HH:MM format');
        return;
      }
    }

    try {
      const res = await global.fetch('/api/ppv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ppvNumber,
          message,
          price,
          mediaFiles,
          previews,
          scheduleDay,
          scheduleTime,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        global.document.getElementById('ppvNumber').value = '';
        global.document.getElementById('message').value = '';
        global.document.getElementById('price').value = '';
        global.document.getElementById('scheduleDay').value = '';
        global.document.getElementById('scheduleTime').value = '';
        global.document.getElementById('vaultMediaList').innerHTML = '';
        fetchPpvs();
      } else {
        global.alert(result.error || 'Failed to save PPV');
      }
    } catch (err) {
      global.console.error('Error saving PPV:', err);
    }
  }

  async function deletePpv(id) {
    if (!global.confirm('Delete this PPV?')) return;
    try {
      const res = await global.fetch(`/api/ppv/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchPpvs();
      } else {
        global.alert('Failed to delete PPV');
      }
    } catch (err) {
      global.console.error('Error deleting PPV:', err);
    }
  }

  async function sendPpv(id, fanId) {
    try {
      const res = await global.fetch(`/api/ppv/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fanId }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        global.alert('PPV sent successfully');
      } else {
        global.alert(result.error || 'Failed to send PPV');
      }
    } catch (err) {
      global.console.error('Error sending PPV:', err);
    }
  }

  function sendPpvPrompt(id) {
    const fanStr = global.prompt('Enter fan ID');
    if (!fanStr) return;
    const fanId = parseInt(fanStr, 10);
    if (!Number.isInteger(fanId)) {
      global.alert('Invalid fan ID');
      return;
    }
    sendPpv(id, fanId);
  }

  function init() {
    const loadBtn = global.document.getElementById('loadVaultBtn');
    if (loadBtn) loadBtn.addEventListener('click', loadVaultMedia);
    const uploadBtn = global.document.getElementById('uploadMediaBtn');
    if (uploadBtn) uploadBtn.addEventListener('click', uploadMedia);
    const saveBtn = global.document.getElementById('saveBtn');
    if (saveBtn) saveBtn.addEventListener('click', savePpv);
    fetchPpvs();
  }

  const PPV = {
    fetchPpvs,
    formatTime,
    renderPpvTable,
    linkPreviewInclude,
    loadVaultMedia,
    uploadMedia,
    savePpv,
    deletePpv,
    sendPpv,
    sendPpvPrompt,
    init,
  };

  global.App = global.App || {};
  global.App.PPV = PPV;

  if (typeof module !== 'undefined') {
    module.exports = PPV;
  }

  global.document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : global);
