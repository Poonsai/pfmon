import express from 'express';

export function buildActionsRouter({ db }) {
  const router = express.Router();

  router.patch('/devices/:id/nickname', (req, res) => {
    const id = Number(req.params.id);
    const nickname = (req.body?.nickname ?? '').trim();
    const value = nickname.length === 0 ? null : nickname;
    const exists = db.prepare('SELECT 1 FROM devices WHERE id = ?').get(id);
    if (!exists) return res.status(404).send('not found');
    db.prepare('UPDATE devices SET nickname = ? WHERE id = ?').run(value, id);
    res.send(`<dd>
      <form hx-patch="/devices/${id}/nickname" hx-target="closest dd" hx-swap="outerHTML">
        <input type="text" name="nickname" class="inline-edit" value="${escapeHtml(value ?? '')}" placeholder="(unset)">
        <button class="action" type="submit">Save</button>
      </form>
    </dd>`);
  });

  router.patch('/devices/:id/notes', (req, res) => {
    const id = Number(req.params.id);
    const notes = (req.body?.notes ?? '').trim();
    const value = notes.length === 0 ? null : notes;
    const exists = db.prepare('SELECT 1 FROM devices WHERE id = ?').get(id);
    if (!exists) return res.status(404).send('not found');
    db.prepare('UPDATE devices SET notes = ? WHERE id = ?').run(value, id);
    res.send(`<dd>
      <form hx-patch="/devices/${id}/notes" hx-target="closest dd" hx-swap="outerHTML">
        <textarea class="inline-edit" name="notes" placeholder="(none)">${escapeHtml(value ?? '')}</textarea>
        <button class="action" type="submit">Save</button>
      </form>
    </dd>`);
  });

  router.post('/devices/:id/tags', (req, res) => {
    const id = Number(req.params.id);
    const tag = (req.body?.tag ?? '').trim().toLowerCase();
    if (tag.length === 0) return res.status(400).send('empty tag');
    const exists = db.prepare('SELECT 1 FROM devices WHERE id = ?').get(id);
    if (!exists) return res.status(404).send('not found');
    db.prepare('INSERT OR IGNORE INTO device_tags VALUES (?, ?)').run(id, tag);
    const tags = db.prepare('SELECT tag FROM device_tags WHERE device_id = ? ORDER BY tag').all(id).map(r => r.tag);
    const html = tags.map(t => `<span class="tag-chip">${escapeHtml(t)}<button hx-delete="/devices/${id}/tags/${encodeURIComponent(t)}" hx-target="closest .tag-chip" hx-swap="outerHTML">x</button></span>`).join(' ');
    res.send(html);
  });

  router.delete('/devices/:id/tags/:tag', (req, res) => {
    const id = Number(req.params.id);
    const tag = decodeURIComponent(req.params.tag).toLowerCase();
    db.prepare('DELETE FROM device_tags WHERE device_id = ? AND tag = ?').run(id, tag);
    res.send('');
  });

  return router;
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
