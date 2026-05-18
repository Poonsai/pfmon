import express from 'express';

export function buildPageRouter({ db } = {}) {
  const router = express.Router();
  router.get('/', (req, res) => {
    const vlans = db
      ? db.prepare(`SELECT pfsense_name, friendly_name FROM interfaces WHERE kind != 'wan' ORDER BY pfsense_name`).all()
      : [];
    res.render('layout', { vlans });
  });
  return router;
}
