(function(global){
  async function fetchFans(){
    const res = await global.fetch('/api/fans');
    if(!res.ok) throw new Error('Failed to fetch fans');
    const data = await res.json();
    return data.fans || [];
  }

  async function populateFanSelect(){
    const fans = await fetchFans();
    const sel = global.document.getElementById('fanSelect');
    if(!sel) return;
    sel.innerHTML = fans.map(f => '<option value="'+ f.id +'">'+ escapeHtml(f.username || f.name || f.parker_name || String(f.id)) +'</option>').join('');
  }

  async function fetchMessageHistory(fanId, limit){
    const res = await global.fetch(`/api/messages/history?fanId=${fanId}&limit=${limit}`);
    if(!res.ok) throw new Error('Failed to fetch message history');
    const data = await res.json();
    return data.messages || [];
  }

  function renderMessageHistory(messages){
    const container = global.document.getElementById('messageHistory');
    if(!container) return;
    const items = messages.map(m => `<li><strong>${escapeHtml(m.direction || '')}</strong>: ${escapeHtml(m.body || '')}</li>`).join('');
    container.innerHTML = `<ul>${items}</ul>`;
  }

  async function handleFetch(){
    const fanId = global.document.getElementById('fanSelect').value;
    const limit = global.document.getElementById('limitInput').value || 20;
    const msgs = await fetchMessageHistory(fanId, limit);
    renderMessageHistory(msgs);
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  async function init(){
    await populateFanSelect();
    const btn = global.document.getElementById('fetchHistoryBtn');
    if(btn) btn.addEventListener('click', handleFetch);
  }

  const api = { fetchMessageHistory, renderMessageHistory, handleFetch, populateFanSelect, init };
  if (typeof module !== 'undefined') module.exports = api;
  else global.MessageHistory = api;
})(typeof window !== 'undefined' ? window : global);
