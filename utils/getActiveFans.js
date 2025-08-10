module.exports = async function getActiveFans(pool, { allowAllIfEmpty = true } = {}) {
  const { rows } = await pool.query('SELECT * FROM fans');
  const allIds = [];
  const activeIds = [];
  let hasActiveCol = false;
  for (const r of rows) {
    const id =
      r.of_user_id ??
      r.ofuserid ??
      r.user_id ??
      r.userid ??
      r.id;
    if (id == null || id === 'null' || id === 0) continue;
    const idText = String(id);
    allIds.push(idText);
    const activeFlag =
      r.active ??
      r.is_active ??
      r.subscribed ??
      r.is_subscribed ??
      (r.issubscribed !== undefined ||
      r.canreceivechatmessage !== undefined ||
      r.isSubscribed !== undefined ||
      r.canReceiveChatMessage !== undefined
        ? (r.issubscribed ?? r.isSubscribed) &&
          (r.canreceivechatmessage ?? r.canReceiveChatMessage)
        : undefined);
    if (activeFlag !== undefined && activeFlag !== null) {
      hasActiveCol = true;
      if (activeFlag) activeIds.push(idText);
    }
  }
  let list = hasActiveCol ? activeIds : allIds;
  if ((!list || list.length === 0) && allowAllIfEmpty) {
    list = allIds;
  }
  return list;
};
