(function (global) {
  const sizeClasses = {
    sm: 'm-editor-fs__sm',
    s: 'm-editor-fs__s',
    default: 'm-editor-fs__default',
    l: 'm-editor-fs__l',
    lg: 'm-editor-fs__lg',
  };

  const colorClasses = {
    gray: 'm-editor-fc__gray',
    blue1: 'm-editor-fc__blue-1',
    blue2: 'm-editor-fc__blue-2',
  };

  function wrapSelection(wrapper) {
    const sel = global.getSelection ? global.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const contents = range.extractContents();
    const node = wrapper(contents);
    range.insertNode(node);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function applySize(size) {
    const cls = sizeClasses[size];
    if (!cls) return;
    wrapSelection((contents) => {
      const span = global.document.createElement('span');
      span.className = cls;
      span.appendChild(contents);
      return span;
    });
  }

  function applyColor(color) {
    const cls = colorClasses[color];
    if (!cls) return;
    wrapSelection((contents) => {
      const span = global.document.createElement('span');
      span.className = cls;
      span.appendChild(contents);
      return span;
    });
  }

  function applyBold() {
    wrapSelection((contents) => {
      const span = global.document.createElement('span');
      span.className = 'm-editor-fs__default';
      const strong = global.document.createElement('strong');
      strong.appendChild(contents);
      span.appendChild(strong);
      return span;
    });
  }

  function applyItalic() {
    wrapSelection((contents) => {
      const span = global.document.createElement('span');
      span.className = 'm-editor-fs__default';
      const em = global.document.createElement('em');
      em.appendChild(contents);
      span.appendChild(em);
      return span;
    });
  }

  function insertPlaceholder(text) {
    const sel = global.getSelection ? global.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = global.document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const Editor = {
    applySize,
    applyColor,
    applyBold,
    applyItalic,
    insertPlaceholder,
  };

  global.App = global.App || {};
  global.App.Editor = Editor;

  if (typeof module !== 'undefined') {
    module.exports = Editor;
  }
})(typeof window !== 'undefined' ? window : global);

// Wire up Load Vault Media, Send, and Schedule actions. Render media table. Push status updates to the UI.

if (typeof document !== 'undefined') {
  (() => {
    const $ = (sel) => document.querySelector(sel);

    document.addEventListener('DOMContentLoaded', () => {
      $('#btnLoadVaultMedia')?.addEventListener('click', loadVaultMedia);
      $('#btnSendAll')?.addEventListener('click', () =>
        sendMessages({ schedule: false }),
      );
      $('#btnSchedule')?.addEventListener('click', () =>
        sendMessages({ schedule: true }),
      );
      $('#btnClearStatus')?.addEventListener('click', clearStatusUI);

      // Delegate Save Parker Name per row
      document.body.addEventListener('click', async (e) => {
        const btn = e.target.closest('.saveParkerBtn');
        if (!btn) return;
        const userId = btn.dataset.userId;
        const input = document.querySelector(
          `input[data-parker-input="${userId}"]`,
        );
        const parkerName = input ? input.value.trim() : '';
        if (!userId) return;
        await saveParkerName(userId, parkerName);
      });
    });

    async function loadVaultMedia() {
      setBusy('#btnLoadVaultMedia', true);
      try {
        const res = await fetch('/api/vault-media');
        const data = await res.json();
        if (!res.ok)
          throw new Error(data?.error || 'Failed to load vault media');
        renderVaultMediaTable(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        alert(err.message || 'Failed to load vault media');
      } finally {
        setBusy('#btnLoadVaultMedia', false);
      }
    }

    function renderVaultMediaTable(items) {
      const container = $('#vaultMediaList');
      if (!container) return;
      if (!items.length) {
        container.innerHTML = '<p>No media found.</p>';
        return;
      }
      const rows = items
        .map((m) => {
          const id = sanitize(String(m.id ?? ''));
          const thumb = sanitize(m.preview_url || m.thumb_url || '');
          const likes = sanitize(String(m.likes ?? m.likesCount ?? 0));
          const tips = sanitize(String(m.tips ?? 0));
          return `
        <tr>
          <td><input type="checkbox" class="mediaCheckbox" value="${id}"></td>
          <td>${id}</td>
          <td>${thumb ? `<img src="${thumb}" alt="thumb" style="max-width:80px;max-height:80px;">` : ''}</td>
          <td>${likes}</td>
          <td>${tips}</td>
        </tr>
      `;
        })
        .join('');
      container.innerHTML = `
      <table class="table table-striped" id="vaultMediaTable">
        <thead>
          <tr><th>Pick</th><th>ID</th><th>Preview</th><th>Likes</th><th>Tips</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    }

    function getSelectedMediaIds() {
      return Array.from(
        document.querySelectorAll('#vaultMediaTable .mediaCheckbox:checked'),
      ).map((cb) => cb.value);
    }

    function buildPayload(scheduleFlag) {
      const messageEl = document.querySelector('#messageInput');
      const text = (messageEl?.innerHTML || '').trim();
      const price = ($('#priceInput')?.value || '').trim();
      const lockedText = ($('#lockedText')?.value || '').trim();
      const mediaIds = getSelectedMediaIds();
      const date = $('#scheduleDateInput')?.value || '';
      const time = $('#scheduleTimeInput')?.value || '';
      let scheduleAt = null;
      if (scheduleFlag && date && time) {
        // Convert local date and time to ISO
        const local = new Date(`${date}T${time}`);
        scheduleAt = isNaN(local.getTime()) ? null : local.toISOString();
      }
      const payload = {
        text,
        price: price ? Number(price) : null,
        mediaIds,
        scheduleAt,
        scope: 'allActiveFans',
      };
      if (lockedText) payload.lockedText = lockedText;
      return payload;
    }

    async function sendMessages({ schedule }) {
      const payload = buildPayload(schedule);
      if (!payload.text) {
        alert('Message is required');
        return;
      }
      const endpoint = schedule
        ? '/api/messages/schedule'
        : '/api/messages/send';
      setBusy('#btnSendAll', true);
      setBusy('#btnSchedule', true);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data?.error || 'Failed to submit messages');
        updateStatusUI(data);
      } catch (err) {
        console.error(err);
        alert(err.message || 'Failed to send');
      } finally {
        setBusy('#btnSendAll', false);
        setBusy('#btnSchedule', false);
      }
    }

    async function saveParkerName(userId, parkerName) {
      try {
        const res = await fetch(
          `/api/fans/${encodeURIComponent(userId)}/parker-name`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parkerName }),
          },
        );
        const data = await res.json();
        if (!res.ok)
          throw new Error(data?.error || 'Failed to save Parker Name');
        toast('Saved');
      } catch (err) {
        console.error(err);
        alert(err.message || 'Failed to save');
      }
    }

    function updateStatusUI(result) {
      // Expecting result to include totals and maybe per user statuses
      // Example: { queued, sent, failed, errors: [{userId, message}] }
      if (result?.errors?.length) {
        console.table(result.errors);
      }
      toast('Submitted');
    }

    function clearStatusUI() {
      // Clear any status indicators in the table
      document
        .querySelectorAll('.statusDot')
        .forEach((el) => el.classList.remove('ok', 'fail'));
    }

    function setBusy(sel, busy) {
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!el) return;
      el.disabled = !!busy;
    }

    function sanitize(s) {
      return s.replace(
        /[<>&"]/g,
        (c) =>
          ({
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
          })[c],
      );
    }

    function toast(msg) {
      console.log(msg);
    }
  })();
}
