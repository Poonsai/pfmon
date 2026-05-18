import express from 'express';

function formatRelative(ts, now) {
  if (!ts) return '-';
  const dt = now - ts;
  if (dt < 60) return 'now';
  if (dt < 3600) return `${Math.floor(dt / 60)}m`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h`;
  return `${Math.floor(dt / 86400)}d`;
}

function formatBytes(n) {
  if (!n) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

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

  router.get('/fragments/device-list', (req, res) => {
    const { q = '', status = '', vlan = '', sort = 'last_seen' } = req.query;
    const SEC = (n) => Math.floor(Date.now() / 1000) - n;

    const where = ['1=1'];
    const params = {};

    if (status === 'online') where.push('d.is_online = 1');
    else if (status === 'offline') where.push('d.is_online = 0');
    else if (status === 'new') where.push('d.new_until_seen_at IS NOT NULL');

    if (vlan) {
      where.push('i.pfsense_name = @vlan');
      params.vlan = vlan;
    }

    if (q) {
      where.push(`(
        COALESCE(d.nickname,'') LIKE @qLike OR
        COALESCE(d.hostname,'') LIKE @qLike OR
        COALESCE(d.current_ip,'') LIKE @qLike OR
        d.mac LIKE @qLike OR
        COALESCE(d.vendor,'') LIKE @qLike OR
        EXISTS (SELECT 1 FROM device_tags t WHERE t.device_id = d.id AND t.tag LIKE @qLike)
      )`);
      params.qLike = `%${q}%`;
    }

    let orderBy = 'd.last_seen_at DESC';
    if (sort === 'name') orderBy = "COALESCE(d.nickname, d.hostname, '') COLLATE NOCASE";
    else if (sort === 'ip') orderBy = "d.current_ip";
    else if (sort === 'bytes_today') {
      orderBy = `(SELECT COALESCE(SUM(rx_bytes + tx_bytes), 0)
                  FROM traffic_hourly th
                  WHERE th.device_id = d.id AND th.hour_bucket >= @todayStart) DESC`;
      params.todayStart = SEC(24 * 3600);
    }

    const rows = db.prepare(`
      SELECT d.id, d.mac, d.vendor, d.hostname, d.nickname, d.current_ip,
             d.is_online, d.last_seen_at, d.new_until_seen_at,
             i.pfsense_name AS interface_name, i.friendly_name AS interface_friendly,
             (SELECT COALESCE(SUM(rx_bytes + tx_bytes), 0)
              FROM traffic_hourly th
              WHERE th.device_id = d.id AND th.hour_bucket >= @bytesTodayStart) AS bytes_today
      FROM devices d
      LEFT JOIN interfaces i ON i.id = d.interface_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
    `).all({ ...params, bytesTodayStart: SEC(24 * 3600) });

    const vlans = db.prepare(`SELECT pfsense_name, friendly_name FROM interfaces WHERE kind != 'wan' ORDER BY pfsense_name`).all();

    res.render('fragments/device-list', {
      rows,
      vlans,
      now: Math.floor(Date.now() / 1000),
      query: { q, status, vlan, sort },
      formatRelative,
      formatBytes,
    });
  });

  return router;
}
