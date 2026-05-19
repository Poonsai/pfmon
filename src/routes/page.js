import express from 'express';

export function buildPageRouter({ db } = {}) {
  const router = express.Router();
  router.get('/', (req, res) => {
    const vlans = db
      ? db
          .prepare(
            `SELECT pfsense_name, friendly_name FROM interfaces WHERE kind != 'wan' ORDER BY pfsense_name`,
          )
          .all()
      : [];
    // Mirror the fragment endpoint's accepted params so an F5 on a URL the
    // form previously pushed restores the same filter / sort selections.
    const query = {
      q: typeof req.query.q === 'string' ? req.query.q : '',
      status: typeof req.query.status === 'string' ? req.query.status : '',
      vlan: typeof req.query.vlan === 'string' ? req.query.vlan : '',
      sort: typeof req.query.sort === 'string' ? req.query.sort : 'last_seen',
    };
    res.render('layout', { vlans, query });
  });
  return router;
}
