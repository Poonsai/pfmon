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

  return router;
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
