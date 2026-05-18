import express from 'express';

export function buildFragmentsRouter({ db }) {
  const router = express.Router();

  router.get('/fragments/header-meta', (req, res) => {
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM devices) AS total,
        (SELECT COUNT(*) FROM devices WHERE is_online = 1) AS online,
        (SELECT COUNT(*) FROM interfaces WHERE kind = 'vlan') AS vlans
    `).get();
    const lastPoll = db.prepare('SELECT ts FROM poll_log WHERE success = 1 ORDER BY ts DESC LIMIT 1').get();
    const freshness = lastPoll ? (Math.floor(Date.now() / 1000) - lastPoll.ts) : null;
    res.render('fragments/header-meta', { ...counts, freshness });
  });

  return router;
}
