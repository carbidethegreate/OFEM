const express = require('express');

module.exports = function ({
  getOFAccountId,
  ofApiRequest,
  ofApi,
  pool,
  sanitizeError,
  OF_FETCH_LIMIT,
}) {
  const router = express.Router();

  async function listVaultMedia(req, res) {
    try {
      const accountId = await getOFAccountId();
      const limit = 100;
      let offset = 0;
      const media = [];
      while (true) {
        const resp = await ofApiRequest(() =>
          ofApi.get(`/${accountId}/media/vault`, {
            params: { limit, offset },
          }),
        );
        const items =
          resp.data?.media ||
          resp.data?.list ||
          resp.data?.data ||
          resp.data;
        if (!Array.isArray(items) || items.length === 0) break;
        media.push(...items);
        offset += limit;
        if (offset >= OF_FETCH_LIMIT) break;
      }

      for (const m of media) {
        const id = m.id;
        const likes = m.likes ?? m.likesCount ?? null;
        const tips = m.tips ?? null;
        const thumb = m.thumb_url ?? m.thumb?.url ?? null;
        const preview = m.preview_url ?? m.preview?.url ?? null;
        const created = m.created_at ? new Date(m.created_at) : null;
        await pool.query(
          'INSERT INTO vault_media (id, likes, tips, thumb_url, preview_url, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET likes=EXCLUDED.likes, tips=EXCLUDED.tips, thumb_url=EXCLUDED.thumb_url, preview_url=EXCLUDED.preview_url, created_at=EXCLUDED.created_at',
          [id, likes, tips, thumb, preview, created],
        );
      }

      const dbRes = await pool.query(
        'SELECT id, likes, tips, thumb_url, preview_url, created_at FROM vault_media ORDER BY id',
      );
      res.json(dbRes.rows);
    } catch (err) {
      console.error('Error fetching vault media:', sanitizeError(err));
      const status = err.message.includes('OnlyFans account') ? 400 : 500;
      res.status(status).json({
        error: status === 400 ? err.message : 'Failed to fetch vault media',
      });
    }
  }

  router.get('/vault-media', listVaultMedia);
  router.get('/', listVaultMedia);

  router.get('/vault-lists', async (req, res) => {
    try {
      let accountId;
      try {
        accountId = await getOFAccountId();
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const resp = await ofApiRequest(() =>
        ofApi.get(`/${accountId}/media/vault/lists`),
      );
      const lists =
        resp.data?.list ||
        resp.data?.lists ||
        resp.data?.data?.list ||
        resp.data?.data?.lists ||
        resp.data;
      if (Array.isArray(lists)) {
        for (const l of lists) {
          const id = l.id;
          const name = l.name || null;
          if (id != null) {
            await pool.query(
              'INSERT INTO vault_lists (id, name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name',
              [id, name],
            );
          }
        }
      }
      res.json(lists);
    } catch (err) {
      console.error('Error fetching vault lists:', sanitizeError(err));
      const status = err.message.includes('OnlyFans account') ? 400 : 500;
      res.status(status).json({
        error:
          status === 400 ? err.message : 'Failed to fetch vault lists',
      });
    }
  });

  router.post('/vault-lists', async (req, res) => {
    try {
      const name = req.body?.name;
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name required' });
      }
      let accountId;
      try {
        accountId = await getOFAccountId();
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const resp = await ofApiRequest(() =>
        ofApi.post(`/${accountId}/media/vault/lists`, { name }),
      );
      const list = resp.data?.list || resp.data;
      const id = list.id;
      await pool.query(
        'INSERT INTO vault_lists (id, name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name',
        [id, name],
      );
      res.json(list);
    } catch (err) {
      console.error('Error creating vault list:', sanitizeError(err));
      res.status(500).json({ error: 'Failed to create vault list' });
    }
  });

  router.get('/vault-lists/:id', async (req, res) => {
    try {
      const id = req.params.id;
      let accountId;
      try {
        accountId = await getOFAccountId();
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const resp = await ofApiRequest(() =>
        ofApi.get(`/${accountId}/media/vault/lists/${id}`),
      );
      const list = resp.data?.list || resp.data;
      const name = list.name || null;
      await pool.query(
        'INSERT INTO vault_lists (id, name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name',
        [id, name],
      );
      const media =
        list.media_ids ||
        list.media?.map((m) => m.id) ||
        list.media ||
        [];
      if (Array.isArray(media)) {
        for (const mediaId of media) {
          const mId = typeof mediaId === 'object' ? mediaId.id : mediaId;
          if (mId != null) {
            await pool.query(
              'INSERT INTO vault_list_media (list_id, media_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
              [id, mId],
            );
          }
        }
      }
      res.json(list);
    } catch (err) {
      console.error('Error fetching vault list:', sanitizeError(err));
      res.status(500).json({ error: 'Failed to fetch vault list' });
    }
  });

  router.put('/vault-lists/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const name = req.body?.name;
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name required' });
      }
      let accountId;
      try {
        accountId = await getOFAccountId();
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const resp = await ofApiRequest(() =>
        ofApi.put(`/${accountId}/media/vault/lists/${id}`, { name }),
      );
      await pool.query(
        'INSERT INTO vault_lists (id, name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name',
        [id, name],
      );
      res.json(resp.data);
    } catch (err) {
      console.error('Error updating vault list:', sanitizeError(err));
      res.status(500).json({ error: 'Failed to update vault list' });
    }
  });

  router.delete('/vault-lists/:id', async (req, res) => {
    try {
      const id = req.params.id;
      let accountId;
      try {
        accountId = await getOFAccountId();
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      await ofApiRequest(() =>
        ofApi.delete(`/${accountId}/media/vault/lists/${id}`),
      );
      await pool.query('DELETE FROM vault_lists WHERE id=$1', [id]);
      await pool.query('DELETE FROM vault_list_media WHERE list_id=$1', [id]);
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting vault list:', sanitizeError(err));
      res.status(500).json({ error: 'Failed to delete vault list' });
    }
  });

  router.post('/vault-lists/:id/media', async (req, res) => {
    try {
      const id = req.params.id;
      const mediaIds = Array.isArray(req.body?.media_ids)
        ? req.body.media_ids.map(Number).filter(Number.isFinite)
        : [];
      if (mediaIds.length === 0) {
        return res.status(400).json({ error: 'media_ids required' });
      }
      let accountId;
      try {
        accountId = await getOFAccountId();
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const resp = await ofApiRequest(() =>
        ofApi.post(`/${accountId}/media/vault/lists/${id}/media`, {
          media_ids: mediaIds,
        }),
      );
      for (const mediaId of mediaIds) {
        await pool.query(
          'INSERT INTO vault_list_media (list_id, media_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, mediaId],
        );
      }
      res.json(resp.data);
    } catch (err) {
      console.error('Error adding media to vault list:', sanitizeError(err));
      res.status(500).json({ error: 'Failed to add media to vault list' });
    }
  });

  router.delete('/vault-lists/:id/media', async (req, res) => {
    try {
      const id = req.params.id;
      const mediaIds = Array.isArray(req.body?.media_ids)
        ? req.body.media_ids.map(Number).filter(Number.isFinite)
        : [];
      if (mediaIds.length === 0) {
        return res.status(400).json({ error: 'media_ids required' });
      }
      let accountId;
      try {
        accountId = await getOFAccountId();
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const resp = await ofApiRequest(() =>
        ofApi.delete(`/${accountId}/media/vault/lists/${id}/media`, {
          data: { media_ids: mediaIds },
        }),
      );
      await pool.query(
        'DELETE FROM vault_list_media WHERE list_id=$1 AND media_id = ANY($2::bigint[])',
        [id, mediaIds],
      );
      res.json(resp.data);
    } catch (err) {
      console.error('Error removing media from vault list:', sanitizeError(err));
      res.status(500).json({ error: 'Failed to remove media from vault list' });
    }
  });

  return router;
};
