const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_BATCHES = 30;

const store = new Map();

function pruneExpired(now = Date.now()) {
  for (const [id, entry] of store.entries()) {
    if (!entry?.createdAt || now - entry.createdAt > TTL_MS) {
      store.delete(id);
    }
  }
  if (store.size > MAX_BATCHES) {
    const sorted = Array.from(store.entries()).sort(
      (a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0),
    );
    while (sorted.length > MAX_BATCHES) {
      const [id] = sorted.shift();
      store.delete(id);
    }
  }
}

function saveBatch(batchId, entry) {
  pruneExpired();
  if (!batchId || !entry) return;
  store.set(batchId, {
    ...entry,
    createdAt: entry.createdAt || Date.now(),
  });
}

function getBatch(batchId) {
  pruneExpired();
  if (!batchId) return null;
  const entry = store.get(batchId);
  if (!entry) return null;
  if (!entry.createdAt || Date.now() - entry.createdAt > TTL_MS) {
    store.delete(batchId);
    return null;
  }
  return entry;
}

function updateBatch(batchId, updater) {
  const entry = getBatch(batchId);
  if (!entry) return null;
  const updated = updater ? updater({ ...entry, items: [...(entry.items || [])] }) : entry;
  if (!updated) return null;
  saveBatch(batchId, updated);
  return updated;
}

module.exports = {
  saveBatch,
  getBatch,
  updateBatch,
  pruneExpired,
};
