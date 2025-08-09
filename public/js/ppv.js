(function (global) {
  let selectedVaultListId = null;
  let editingPpvId = null;
  let currentPpvs = [];
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
    currentPpvs = ppvs;
    const tbody = global.document.getElementById('ppvTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    for (const p of ppvs) {
      const day = p.scheduleDay != null ? p.scheduleDay : 'None';
      const time = p.scheduleTime ? formatTime(p.scheduleTime) : 'None';
      const tr = global.document.createElement('tr');
      tr.innerHTML = `<td>${p.ppv_number}</td><td>${p.message || ''}</td><td>${p.description || ''}</td><td>${p.price}</td><td>${day}</td><td>${time}</td><td><button class="btn btn-primary" onclick="App.PPV.sendPpvPrompt(${p.id})">Send</button> <button class="btn btn-secondary" onclick="App.PPV.editPpv(${p.id})">Edit</button> <button class="btn btn-secondary" onclick="App.PPV.deletePpv(${p.id})">Delete</button></td>`;
      tbody.appendChild(tr);
    }
  }

  async function fetchVaultLists() {
    try {
      const res = await global.fetch('/api/vault-lists');
      if (!res.ok) return;
      const lists = await res.json();
      const select = global.document.getElementById('vaultListSelect');
      if (!select) return;
      select.innerHTML = '<option value="">--</option>';
      for (const l of lists) {
        const opt = global.document.createElement('option');
        opt.value = l.id;
        opt.textContent = l.name || `List ${l.id}`;
        select.appendChild(opt);
      }
      if (selectedVaultListId) select.value = selectedVaultListId;
    } catch (err) {
      global.console.error('Error fetching vault lists:', err);
    }
  }

  function linkPreviewInclude(includeCb, previewCb, label) {
    // Previewing a media item without including it would break the PPV message,
    // so keep the "Include" and "Preview" checkboxes in sync.
    function updateLabel() {
      if (label) {
        label.textContent = previewCb.checked ? 'Preview' : 'Paywalled';
      }
    }
    includeCb.addEventListener('change', () => {
      if (!includeCb.checked) previewCb.checked = false;
      updateLabel();
    });
    previewCb.addEventListener('change', () => {
      if (previewCb.checked) {
        includeCb.checked = true;
        includeCb.dispatchEvent(new global.Event('change'));
      }
      updateLabel();
    });
    updateLabel();
  }

  async function loadVaultMedia() {
    try {
      await fetchVaultLists();
      const res = await global.fetch('/api/vault-media');
      const container = global.document.getElementById('vaultMediaList');
      if (!res.ok) {
        let err;
        try {
          err = await res.json();
        } catch {}
        const message =
          (err && (err.error || err.message)) ||
          'Failed to load vault media';
        if (global.alert) global.alert(message);
        global.console.error('Error loading vault media:', message);
        if (container) container.innerHTML = '';
        return;
      }
      const data = await res.json();
      const items = Array.isArray(data) ? data : [];
      if (!container) return;
      container.innerHTML = '';
      for (const m of items) {
        const div = global.document.createElement('div');
        div.className = 'media-item';

        const icon = global.document.createElement('span');
        icon.className = 'icon';
        icon.textContent =
          m.type === 'video' ? '🎬' : m.type === 'audio' ? '🎵' : '🖼️';
        div.appendChild(icon);

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

        const accessSpan = global.document.createElement('span');
        accessSpan.className = 'access-label';
        div.appendChild(accessSpan);

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

        const likes = m.likes || m.likes_count || m.likesCount || 0;
        const tips = m.tips || m.tips_amount || m.tipsAmount || 0;
        const statsSpan = global.document.createElement('span');
        statsSpan.className = 'media-stats';
        statsSpan.textContent = ` Likes: ${likes} Tips: ${tips}`;
        statsSpan.style.display = 'none';
        div.appendChild(statsSpan);

        mediaCb.addEventListener('change', () => {
          statsSpan.style.display = mediaCb.checked ? 'inline' : 'none';
        });

        linkPreviewInclude(mediaCb, previewCb, accessSpan);

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

  async function scrapeMedia() {
    const input = global.document.getElementById('cdnUrl');
    if (!input) return;
    const url = input.value.trim();
    if (!url) return;
    try {
      const res = await global.fetch('/api/vault-media/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const result = await res.json();
      if (!res.ok) {
        global.alert(result.error || 'Failed to scrape media');
        return;
      }
      input.value = '';
      await loadVaultMedia();
    } catch (err) {
      global.console.error('Error scraping media:', err);
    }
  }

  function resetForm() {
    const numInput = global.document.getElementById('ppvNumber');
    if (numInput) {
      numInput.value = '';
      numInput.disabled = false;
    }
    const msgInput = global.document.getElementById('message');
    if (msgInput) msgInput.value = '';
    const descInput = global.document.getElementById('description');
    if (descInput) descInput.value = '';
    const priceInput = global.document.getElementById('price');
    if (priceInput) priceInput.value = '';
    const dayInput = global.document.getElementById('scheduleDay');
    if (dayInput) dayInput.value = '';
    const timeInput = global.document.getElementById('scheduleTime');
    if (timeInput) timeInput.value = '';
    const mediaList = global.document.getElementById('vaultMediaList');
    if (mediaList) mediaList.innerHTML = '';
    const listSelect = global.document.getElementById('vaultListSelect');
    if (listSelect) listSelect.value = '';
    selectedVaultListId = null;
    editingPpvId = null;
    const saveBtn = global.document.getElementById('saveBtn');
    if (saveBtn) saveBtn.textContent = 'Save PPV';
  }

  async function savePpv() {
    const description = global.document.getElementById('description').value.trim();
    const message = global.document.getElementById('message').value.trim();
    const priceStr = global.document.getElementById('price').value;
    const price = parseFloat(priceStr);
    const scheduleDayVal = global.document.getElementById('scheduleDay').value;
    const scheduleTime = global.document.getElementById('scheduleTime').value;
    const scheduleDay = scheduleDayVal ? parseInt(scheduleDayVal, 10) : null;

    if (editingPpvId) {
      const payload = {};
      if (description) payload.description = description;
      if (message) payload.message = message;
      if (!Number.isNaN(price)) payload.price = price;

      if ((scheduleDayVal && scheduleTime) || (!scheduleDayVal && !scheduleTime)) {
        if (scheduleDayVal) {
          if (
            !Number.isInteger(scheduleDay) ||
            scheduleDay < 1 ||
            scheduleDay > 31
          ) {
            global.alert('scheduleDay must be an integer between 1 and 31');
            return;
          }
          if (
            typeof scheduleTime !== 'string' ||
            !/^\d{2}:\d{2}$/.test(scheduleTime)
          ) {
            global.alert('scheduleTime must be in HH:MM format');
            return;
          }
          const [h, m] = scheduleTime.split(':').map(Number);
          if (h < 0 || h > 23 || m < 0 || m > 59) {
            global.alert('scheduleTime must be in 24-hour HH:MM format');
            return;
          }
          payload.scheduleDay = scheduleDay;
          payload.scheduleTime = scheduleTime;
        }
      } else {
        global.alert('Both schedule day and time must be provided');
        return;
      }

      try {
        const res = await global.fetch(`/api/ppv/${editingPpvId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await res.json().catch(() => ({}));
        if (res.ok) {
          resetForm();
          fetchPpvs();
        } else {
          global.alert(result.error || 'Failed to save PPV');
        }
      } catch (err) {
        global.console.error('Error saving PPV:', err);
      }
      return;
    }

    const ppvNumber = parseInt(global.document.getElementById('ppvNumber').value, 10);
    const mediaFiles = Array.from(
      global.document.querySelectorAll('.mediaCheckbox:checked'),
    ).map((cb) => Number(cb.value));
    const previews = Array.from(
      global.document.querySelectorAll('.previewCheckbox:checked'),
    ).map((cb) => Number(cb.value));

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
          description,
          message,
          price,
          mediaFiles,
          previews,
          scheduleDay,
          scheduleTime,
          vaultListId: selectedVaultListId,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        resetForm();
        fetchPpvs();
      } else {
        global.alert(result.error || 'Failed to save PPV');
      }
    } catch (err) {
      global.console.error('Error saving PPV:', err);
    }
  }

  async function createVaultList() {
    const name = global.prompt('Enter list name');
    if (!name) return;
    try {
      const res = await global.fetch('/api/vault-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const result = await res.json();
      if (!res.ok) {
        global.alert(result.error || 'Failed to create list');
        return;
      }
      selectedVaultListId = result.id;
      await fetchVaultLists();
      const select = global.document.getElementById('vaultListSelect');
      if (select) select.value = String(selectedVaultListId);
    } catch (err) {
      global.console.error('Error creating vault list:', err);
    }
  }

  async function renameVaultList() {
    const select = global.document.getElementById('vaultListSelect');
    const id = select && select.value;
    if (!id) {
      global.alert('Select a list first');
      return;
    }
    const name = global.prompt('Enter new list name');
    if (!name) return;
    try {
      const res = await global.fetch(`/api/vault-lists/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const result = await res.json();
      if (!res.ok) {
        global.alert(result.error || 'Failed to rename list');
        return;
      }
      selectedVaultListId = Number(id);
      await fetchVaultLists();
      if (select) select.value = String(id);
    } catch (err) {
      global.console.error('Error renaming vault list:', err);
    }
  }

  async function deleteVaultList() {
    const select = global.document.getElementById('vaultListSelect');
    const id = select && select.value;
    if (!id) {
      global.alert('Select a list first');
      return;
    }
    if (!global.confirm('Delete this list?')) return;
    try {
      const res = await global.fetch(`/api/vault-lists/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        global.alert(result.error || 'Failed to delete list');
        return;
      }
      if (selectedVaultListId === Number(id)) {
        selectedVaultListId = null;
      }
      await fetchVaultLists();
    } catch (err) {
      global.console.error('Error deleting vault list:', err);
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

  async function editPpv(id) {
    const ppv = currentPpvs.find((p) => p.id === id);
    if (!ppv) return;
    editingPpvId = id;
    const numInput = global.document.getElementById('ppvNumber');
    if (numInput) {
      numInput.value = ppv.ppv_number;
      numInput.disabled = true;
    }
    const msgInput = global.document.getElementById('message');
    if (msgInput) msgInput.value = ppv.message || '';
    const descInput = global.document.getElementById('description');
    if (descInput) descInput.value = ppv.description || '';
    const priceInput = global.document.getElementById('price');
    if (priceInput) priceInput.value = ppv.price != null ? ppv.price : '';
    const dayInput = global.document.getElementById('scheduleDay');
    if (dayInput) dayInput.value = ppv.scheduleDay != null ? ppv.scheduleDay : '';
    const timeInput = global.document.getElementById('scheduleTime');
    if (timeInput) timeInput.value = ppv.scheduleTime || '';
    selectedVaultListId = ppv.vault_list_id || ppv.vaultListId || null;
    await loadVaultMedia();
    const mediaIds = ppv.mediaFiles || [];
    const previewIds = ppv.previews || [];
    for (const cb of global.document.querySelectorAll('.mediaCheckbox')) {
      if (mediaIds.includes(Number(cb.value))) {
        cb.checked = true;
        cb.dispatchEvent(new global.Event('change'));
      }
    }
    for (const cb of global.document.querySelectorAll('.previewCheckbox')) {
      if (previewIds.includes(Number(cb.value))) {
        cb.checked = true;
        cb.dispatchEvent(new global.Event('change'));
      }
    }
    const listSelect = global.document.getElementById('vaultListSelect');
    if (listSelect)
      listSelect.value = selectedVaultListId ? String(selectedVaultListId) : '';
    const saveBtn = global.document.getElementById('saveBtn');
    if (saveBtn) saveBtn.textContent = 'Update PPV';
  }

  function init() {
    const loadBtn = global.document.getElementById('btnLoadVaultMedia');
    if (loadBtn) loadBtn.addEventListener('click', loadVaultMedia);
    const uploadBtn = global.document.getElementById('uploadMediaBtn');
    if (uploadBtn) uploadBtn.addEventListener('click', uploadMedia);
    const scrapeBtn = global.document.getElementById('scrapeMediaBtn');
    if (scrapeBtn) scrapeBtn.addEventListener('click', scrapeMedia);
    const saveBtn = global.document.getElementById('saveBtn');
    if (saveBtn) saveBtn.addEventListener('click', savePpv);
    const listSelect = global.document.getElementById('vaultListSelect');
    if (listSelect) {
      listSelect.addEventListener('change', (e) => {
        selectedVaultListId = e.target.value ? Number(e.target.value) : null;
      });
    }
    const createListBtn = global.document.getElementById('createVaultListBtn');
    if (createListBtn) createListBtn.addEventListener('click', createVaultList);
    const renameListBtn = global.document.getElementById('renameVaultListBtn');
    if (renameListBtn) renameListBtn.addEventListener('click', renameVaultList);
    const deleteListBtn = global.document.getElementById('deleteVaultListBtn');
    if (deleteListBtn) deleteListBtn.addEventListener('click', deleteVaultList);
    fetchVaultLists();
    fetchPpvs();
  }

  const PPV = {
    fetchPpvs,
    formatTime,
    renderPpvTable,
    linkPreviewInclude,
    loadVaultMedia,
    uploadMedia,
    scrapeMedia,
    savePpv,
    deletePpv,
    sendPpv,
    sendPpvPrompt,
    editPpv,
    createVaultList,
    renameVaultList,
    deleteVaultList,
    fetchVaultLists,
    init,
  };

  global.App = global.App || {};
  global.App.PPV = PPV;

  if (typeof module !== 'undefined') {
    module.exports = PPV;
  }

  global.document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : global);

// Fetch the vault media list when the "Load Vault Media" button is clicked
document
  .getElementById('btnLoadVaultMedia')
  .addEventListener('click', async () => {
    try {
      const res = await fetch('/api/vault-media');
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || err.message || 'Failed to load vault media');
        return;
      }
      const mediaItems = await res.json();
      const container = document.getElementById('vaultMediaList');
      container.innerHTML = '';
      if (mediaItems.length === 0) {
        container.textContent = 'No media found in vault.';
      } else {
        let tableHtml =
          '<table><thead><tr><th>ID</th><th>Media</th><th>Include</th><th>Preview</th><th>Likes</th><th>Tips</th></tr></thead><tbody>';
        for (const m of mediaItems) {
          const thumbUrl = m.preview_url || m.thumb_url || '';
          tableHtml += '<tr>';
          tableHtml += `<td>${m.id}</td>`;
          tableHtml +=
            '<td>' +
            (thumbUrl
              ? `<img src="${thumbUrl}" alt="media" style="max-width:80px;">`
              : '') +
            '</td>';
          tableHtml += `<td><input type="checkbox" class="mediaCheckbox" value="${m.id}"></td>`;
          tableHtml += `<td><input type="checkbox" class="previewCheckbox" value="${m.id}"></td>`;
          tableHtml += `<td>${m.likes || 0}</td>`;
          tableHtml += `<td>${m.tips || 0}</td>`;
          tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table>';
        container.innerHTML = tableHtml;
      }
    } catch (error) {
      console.error('Error fetching vault media:', error);
    }
  });
