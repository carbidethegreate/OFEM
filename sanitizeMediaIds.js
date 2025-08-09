function sanitizeMediaIds(ids) {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => {
      if (typeof id === 'number' && Number.isFinite(id)) return String(id);
      if (
        typeof id === 'string' &&
        (id.startsWith('ofapi_media_') || /^\d+$/.test(id))
      )
        return id;
      return null;
    })
    .filter(Boolean);
}
module.exports = sanitizeMediaIds;
