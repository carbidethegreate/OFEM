(function () {
  async function fetchPpvs() {
    try {
      const res = await fetch('/api/ppv');
      if (!res.ok) return;
      const data = await res.json();
      renderPpvTable(data.ppvs || []);
    } catch (err) {
      console.error('Error fetching PPVs:', err);
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
    const tbody = document.getElementById('ppvTableBody');
    tbody.innerHTML = '';
    for (const p of ppvs) {
      const day = p.scheduleDay != null ? p.scheduleDay : 'None';
      const time = p.scheduleTime ? formatTime(p.scheduleTime) : 'None';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${p.ppv_number}</td><td>${p.description}</td><td>${p.price}</td><td>${day}</td><td>${time}</td><td><button class="btn btn-secondary" onclick="deletePpv(${p.id})">Delete</button></td>`;
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
      const res = await fetch('/api/vault-media');
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data)
        ? data
        : data.list || data.results || data.media || data.data || [];
      const container = document.getElementById('vaultMediaList');
      container.innerHTML = '';
      for (const m of items) {
        const div = document.createElement('div');
        div.className = 'media-item';

        const thumb =
          (m.preview && (m.preview.url || m.preview.src)) ||
          (m.thumb && (m.thumb.url || m.thumb.src));
        if (thumb) {
          const img = document.createElement('img');
          img.src = thumb;
          div.appendChild(img);
        }

        const idSpan = document.createElement('span');
        idSpan.className = 'media-id';
        idSpan.textContent = 'ID: ' + m.id;
        div.appendChild(idSpan);

        const includeLabel = document.createElement('label');
        const mediaCb = document.createElement('input');
        mediaCb.type = 'checkbox';
        mediaCb.className = 'mediaCheckbox';
        mediaCb.value = m.id;
        includeLabel.appendChild(mediaCb);
        includeLabel.append(' Include');
        div.appendChild(includeLabel);

        const previewLabel = document.createElement('label');
        const previewCb = document.createElement('input');
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
      console.error('Error loading vault media:', err);
    }
  }

  async function savePpv() {
    const ppvNumber = parseInt(document.getElementById('ppvNumber').value, 10);
    const description = document.getElementById('description').value.trim();
    const price = parseFloat(document.getElementById('price').value);
    const mediaFiles = Array.from(
      document.querySelectorAll('.mediaCheckbox:checked'),
    ).map((cb) => Number(cb.value));
    const previews = Array.from(
      document.querySelectorAll('.previewCheckbox:checked'),
    ).map((cb) => Number(cb.value));
    const scheduleDayVal = document.getElementById('scheduleDay').value;
    const scheduleTime = document.getElementById('scheduleTime').value;
    const scheduleDay = scheduleDayVal ? parseInt(scheduleDayVal, 10) : null;
    try {
      const res = await fetch('/api/ppv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ppvNumber,
          description,
          price,
          mediaFiles,
          previews,
          scheduleDay,
          scheduleTime,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        document.getElementById('ppvNumber').value = '';
        document.getElementById('description').value = '';
        document.getElementById('price').value = '';
        document.getElementById('scheduleDay').value = '';
        document.getElementById('scheduleTime').value = '';
        document.getElementById('vaultMediaList').innerHTML = '';
        fetchPpvs();
      } else {
        alert(result.error || 'Failed to save PPV');
      }
    } catch (err) {
      console.error('Error saving PPV:', err);
    }
  }

  async function deletePpv(id) {
    if (!confirm('Delete this PPV?')) return;
    try {
      const res = await fetch(`/api/ppv/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchPpvs();
      } else {
        alert('Failed to delete PPV');
      }
    } catch (err) {
      console.error('Error deleting PPV:', err);
    }
  }

  window.deletePpv = deletePpv;

  document
    .getElementById('loadVaultBtn')
    .addEventListener('click', loadVaultMedia);
  document.getElementById('saveBtn').addEventListener('click', savePpv);
  fetchPpvs();
})();
