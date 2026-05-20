import express from 'express';
import { sendMagicPacket } from '../wol.js';

export function buildActionsRouter({ db, wolConfig }) {
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
    const tags = db
      .prepare('SELECT tag FROM device_tags WHERE device_id = ? ORDER BY tag')
      .all(id)
      .map((r) => r.tag);
    const html = tags
      .map(
        (t) =>
          `<span class="tag-chip">${escapeHtml(t)}<button hx-delete="/devices/${id}/tags/${encodeURIComponent(t)}" hx-target="closest .tag-chip" hx-swap="outerHTML">x</button></span>`,
      )
      .join(' ');
    res.send(html);
  });

  router.delete('/devices/:id/tags/:tag', (req, res) => {
    const id = Number(req.params.id);
    let tag;
    try {
      // decodeURIComponent throws URIError on malformed % escapes like '%FF'.
      // Catch and 400 rather than letting Express return a 500.
      tag = decodeURIComponent(req.params.tag).toLowerCase();
    } catch (_e) {
      return res.status(400).send('bad tag');
    }
    db.prepare('DELETE FROM device_tags WHERE device_id = ? AND tag = ?').run(id, tag);
    res.send('');
  });

  router.post('/devices/:id/dismiss-new', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE devices SET new_until_seen_at = NULL WHERE id = ?').run(id);
    res.send('');
  });

  router.post('/devices/:id/wake', async (req, res) => {
    const id = Number(req.params.id);
    const dev = db.prepare('SELECT mac FROM devices WHERE id = ?').get(id);
    if (!dev) return res.status(404).send('not found');
    try {
      await sendMagicPacket({
        mac: dev.mac,
        broadcastAddr: wolConfig.broadcastAddr,
        port: wolConfig.port,
      });
      console.log(JSON.stringify({ level: 'info', msg: 'wol sent', device_id: id, mac: dev.mac }));
      res
        .status(200)
        .send('<span style="color: var(--success); font-size: 12px;">Magic packet sent</span>');
    } catch (e) {
      console.error(
        JSON.stringify({ level: 'error', msg: 'wol failed', device_id: id, error: String(e) }),
      );
      res
        .status(500)
        .send('<span style="color: var(--danger); font-size: 12px;">Wake failed</span>');
    }
  });

  return router;
}

function escapeHtml(s) {
  return String(s).replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
