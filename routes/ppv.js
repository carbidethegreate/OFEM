const express = require('express');

module.exports = function ({
  getOFAccountId,
  ofApiRequest,
  ofApi,
  pool,
  sanitizeError,
  sendMessageToFan,
}) {
  const router = express.Router();
  // PPV management endpoints
  router.get('/ppv', async (req, res) => {
    try {
      const dbRes = await pool.query(
        'SELECT id, ppv_number, description, message, price, vault_list_id, schedule_day, schedule_time, last_sent_at, created_at FROM ppv_sets ORDER BY ppv_number',
      );
      const ppvs = dbRes.rows.map(
        ({ schedule_day, schedule_time, ...rest }) => ({
          ...rest,
          scheduleDay: schedule_day,
          scheduleTime: schedule_time,
        }),
      );
      res.json({ ppvs });
    } catch (err) {
      console.error('Error fetching PPVs:', sanitizeError(err));
      res.status(500).json({ error: 'Failed to fetch PPVs' });
    }
  });

  router.post('/ppv', async (req, res) => {
    const {
      ppvNumber,
      description,
      message,
      price,
      mediaFiles,
      previews,
      scheduleDay,
      scheduleTime,
    } = req.body || {};

    if ((scheduleDay == null) !== (scheduleTime == null)) {
      return res.status(400).json({
        error: 'Both scheduleDay and scheduleTime must be provided together',
      });
    }
    if (scheduleDay != null) {
      if (
        !Number.isInteger(scheduleDay) ||
        scheduleDay < 1 ||
        scheduleDay > 31
      ) {
        return res
          .status(400)
          .json({ error: 'scheduleDay must be an integer between 1 and 31' });
      }
      if (
        typeof scheduleTime !== 'string' ||
        !/^\d{2}:\d{2}$/.test(scheduleTime)
      ) {
        return res
          .status(400)
          .json({ error: 'scheduleTime must be in HH:MM format' });
      }
      const [h, m] = scheduleTime.split(':').map(Number);
      if (h < 0 || h > 23 || m < 0 || m > 59) {
        return res
          .status(400)
          .json({ error: 'scheduleTime must be in 24-hour HH:MM format' });
      }
    }

    if (
      !Number.isInteger(ppvNumber) ||
      typeof message !== 'string' ||
      message.trim() === '' ||
      !Number.isFinite(price) ||
      !Array.isArray(mediaFiles) ||
      mediaFiles.length === 0 ||
      !Array.isArray(previews)
    ) {
      return res.status(400).json({ error: 'Invalid PPV data.' });
    }
    let vaultListId;
    let accountId;
    try {
      accountId = await getOFAccountId();
      const listResp = await ofApiRequest(() =>
        ofApi.post(`/${accountId}/media/vault/lists`, {
          name: `PPV ${ppvNumber}`,
        }),
      );
      vaultListId = listResp.data?.id || listResp.data?.list?.id;
      await ofApiRequest(() =>
        ofApi.post(`/${accountId}/media/vault/lists/${vaultListId}/media`, {
          media_ids: mediaFiles,
        }),
      );

      const client = await pool.connect();
      let ppvRow;
      try {
        await client.query('BEGIN');
        const setRes = await client.query(
          'INSERT INTO ppv_sets (ppv_number, description, message, price, vault_list_id, schedule_day, schedule_time) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [
            ppvNumber,
            description ?? null,
            message,
            price,
            vaultListId,
            scheduleDay,
            scheduleTime,
          ],
        );
        ppvRow = setRes.rows[0];
        for (const mediaId of mediaFiles) {
          const isPreview = previews.includes(mediaId);
          await client.query(
            'INSERT INTO ppv_media (ppv_id, media_id, is_preview) VALUES ($1,$2,$3)',
            [ppvRow.id, mediaId, isPreview],
          );
        }
        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        try {
          await ofApiRequest(() =>
            ofApi.delete(`/${accountId}/media/vault/lists/${vaultListId}`),
          );
          vaultListId = null;
        } catch (cleanupErr) {
          console.error(
            'Error cleaning up vault list:',
            cleanupErr.response
              ? cleanupErr.response.data || cleanupErr.response.statusText
              : cleanupErr.message,
          );
        }
        throw dbErr;
      } finally {
        client.release();
      }
      const ppv = {
        ...ppvRow,
        scheduleDay: ppvRow.schedule_day,
        scheduleTime: ppvRow.schedule_time,
        media: mediaFiles.map((id) => ({
          media_id: id,
          is_preview: previews.includes(id),
        })),
      };
      delete ppv.schedule_day;
      delete ppv.schedule_time;
      res.status(201).json({ ppv });
    } catch (err) {
      if (vaultListId && accountId) {
        try {
          await ofApiRequest(() =>
            ofApi.delete(`/${accountId}/media/vault/lists/${vaultListId}`),
          );
        } catch (cleanupErr) {
          console.error(
            'Error cleaning up vault list:',
            cleanupErr.response
              ? cleanupErr.response.data || cleanupErr.response.statusText
              : cleanupErr.message,
          );
        }
      }
      console.error(
        'Error creating PPV:',
        err.response
          ? err.response.data || err.response.statusText
          : err.message,
      );
      const status = err.message.includes('OnlyFans account') ? 400 : 500;
      res
        .status(status)
        .json({ error: status === 400 ? err.message : 'Failed to create PPV' });
    }
  });

  router.put('/ppv/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const { description, message, price, scheduleDay, scheduleTime } =
        req.body || {};

      const existingRes = await pool.query(
        'SELECT schedule_day, schedule_time FROM ppv_sets WHERE id=$1',
        [id],
      );
      if (existingRes.rowCount === 0) {
        return res.status(404).json({ error: 'PPV not found' });
      }
      const existing = existingRes.rows[0];

      if ((scheduleDay !== undefined) !== (scheduleTime !== undefined)) {
        return res.status(400).json({
          error: 'Both scheduleDay and scheduleTime must be provided together',
        });
      }
      if (scheduleDay !== undefined && scheduleDay !== null) {
        if (
          !Number.isInteger(scheduleDay) ||
          scheduleDay < 1 ||
          scheduleDay > 31
        ) {
          return res
            .status(400)
            .json({ error: 'scheduleDay must be an integer between 1 and 31' });
        }
        if (
          typeof scheduleTime !== 'string' ||
          !/^\d{2}:\d{2}$/.test(scheduleTime)
        ) {
          return res
            .status(400)
            .json({ error: 'scheduleTime must be in HH:MM format' });
        }
        const [h, m] = scheduleTime.split(':').map(Number);
        if (h < 0 || h > 23 || m < 0 || m > 59) {
          return res
            .status(400)
            .json({ error: 'scheduleTime must be in 24-hour HH:MM format' });
        }
      }

      if (
        message !== undefined &&
        (typeof message !== 'string' || message.trim() === '')
      ) {
        return res
          .status(400)
          .json({ error: 'message must be a non-empty string' });
      }

      const fields = [];
      const values = [];
      let idx = 1;
      if (description !== undefined) {
        fields.push(`description=$${idx++}`);
        values.push(description);
      }
      if (message !== undefined) {
        fields.push(`message=$${idx++}`);
        values.push(message);
      }
      if (price !== undefined) {
        fields.push(`price=$${idx++}`);
        values.push(price);
      }
      if (scheduleDay !== undefined) {
        fields.push(`schedule_day=$${idx++}`);
        values.push(scheduleDay);
        fields.push(`schedule_time=$${idx++}`);
        values.push(scheduleTime);
      }
      if (!fields.length) {
        return res.status(400).json({ error: 'No valid fields to update.' });
      }

      values.push(id);
      const updateRes = await pool.query(
        `UPDATE ppv_sets SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`,
        values,
      );
      const updated = updateRes.rows[0];

      if (
        scheduleDay !== undefined &&
        (existing.schedule_day !== scheduleDay ||
          existing.schedule_time !== scheduleTime)
      ) {
        await pool.query(
          'UPDATE ppv_sets SET last_sent_at = NULL WHERE id=$1',
          [id],
        );
        console.log(`Reset last_sent_at for PPV ${id} due to schedule change`);
        updated.last_sent_at = null;
      }

      const ppv = {
        ...updated,
        scheduleDay: updated.schedule_day,
        scheduleTime: updated.schedule_time,
      };
      delete ppv.schedule_day;
      delete ppv.schedule_time;
      res.json({ ppv });
    } catch (err) {
      console.error('Error updating PPV:', sanitizeError(err));
      res.status(500).json({ error: 'Failed to update PPV' });
    }
  });

  router.post('/ppv/:id/send', async (req, res) => {
    const id = req.params.id;
    const { fanId } = req.body || {};
    if (!Number.isInteger(fanId)) {
      return res.status(400).json({ error: 'fanId required' });
    }
    try {
      const ppvRes = await pool.query(
        'SELECT message, price FROM ppv_sets WHERE id=$1',
        [id],
      );
      if (ppvRes.rowCount === 0) {
        return res.status(404).json({ error: 'PPV not found' });
      }
      const mediaRes = await pool.query(
        'SELECT media_id, is_preview FROM ppv_media WHERE ppv_id=$1',
        [id],
      );
      const mediaFiles = mediaRes.rows.map((r) => r.media_id);
      const previews = mediaRes.rows
        .filter((r) => r.is_preview)
        .map((r) => r.media_id);
      const { message = '', price = 0 } = ppvRes.rows[0];
      await sendMessageToFan(
        fanId,
        '',
        message,
        price,
        '',
        mediaFiles,
        previews,
      );
      try {
        await pool.query(
          'INSERT INTO ppv_sends (ppv_id, fan_id) VALUES ($1,$2)',
          [id, fanId],
        );
      } catch (logErr) {
        console.error('Error logging PPV send:', sanitizeError(logErr));
      }
      res.json({ success: true });
    } catch (err) {
      if (err.code === 'FAN_NOT_ELIGIBLE') {
        return res.status(400).json({ error: err.message });
      }
      const ofError = err.onlyfans_response?.body?.error;
      console.error(
        'Error sending PPV:',
        err.response
          ? err.response.data || err.response.statusText
          : err.message,
        ofError || '',
      );
      const status = err.status || err.response?.status;
      let message =
        status === 429
          ? 'OnlyFans API rate limit exceeded. Please try again later.'
          : err.response
            ? err.response.statusText || err.response.data
            : err.message;
      if (ofError) message += ` (OnlyFans error: ${ofError})`;
      res.status(status || 500).json({ error: message });
    }
  });

  router.delete('/ppv/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const dbRes = await pool.query(
        'SELECT vault_list_id FROM ppv_sets WHERE id=$1',
        [id],
      );
      if (dbRes.rows.length === 0) {
        return res.status(404).json({ error: 'PPV not found' });
      }
      const vaultListId = dbRes.rows[0].vault_list_id;
      if (vaultListId) {
        let accountId;
        try {
          accountId = await getOFAccountId();
        } catch {
          accountId = null;
        }
        if (accountId) {
          try {
            await ofApiRequest(() =>
              ofApi.delete(`/${accountId}/media/vault/lists/${vaultListId}`),
            );
          } catch (apiErr) {
            console.error(
              'Error deleting OnlyFans vault list:',
              apiErr.response
                ? apiErr.response.data || apiErr.response.statusText
                : apiErr.message,
            );
          }
        }
      }
      await pool.query('DELETE FROM ppv_sets WHERE id=$1', [id]);
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting PPV:', sanitizeError(err));
      res.status(500).json({ error: 'Failed to delete PPV' });
    }
  });

  return router;
};
