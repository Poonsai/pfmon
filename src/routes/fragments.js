import express from 'express';
import { renderWanChartSvg } from '../charts/wan-chart.js';
import { renderUptimeSparklineSvg } from '../charts/uptime-sparkline.js';
import { renderDeviceTrafficSvg } from '../charts/device-traffic-chart.js';

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

  router.get('/fragments/alerts', (req, res) => {
    const newDevices = db.prepare(`
      SELECT d.id, d.mac, d.vendor, d.hostname, d.current_ip, i.pfsense_name AS interface_name
      FROM devices d
      LEFT JOIN interfaces i ON i.id = d.interface_id
      WHERE d.new_until_seen_at IS NOT NULL
      ORDER BY d.first_seen_at DESC
    `).all();
    const lastPoll = db.prepare('SELECT success, error_msg, ts FROM poll_log ORDER BY ts DESC LIMIT 1').get();
    const pollFailed = lastPoll && lastPoll.success === 0;
    res.render('fragments/alerts', { newDevices, pollFailed, pollError: lastPoll?.error_msg ?? null });
  });

  router.get('/fragments/wan-summary', (req, res) => {
    const range = req.query.range === '7d' ? '7d' : (req.query.range === '30d' ? '30d' : '24h');
    const rangeSec = range === '24h' ? 24 * 3600 : (range === '7d' ? 7 * 86400 : 30 * 86400);
    const now = Math.floor(Date.now() / 1000);

    const wan = db.prepare(`SELECT id, friendly_name FROM interfaces WHERE kind = 'wan' LIMIT 1`).get();
    if (!wan) {
      return res.render('fragments/wan-summary', { wan: null });
    }

    const samples = db.prepare(`
      SELECT hour_bucket AS ts, rx_bytes, tx_bytes
      FROM interface_traffic_hourly
      WHERE interface_id = ? AND hour_bucket >= ?
      ORDER BY hour_bucket
    `).all(wan.id, now - rangeSec);

    function totalSince(since) {
      const r = db.prepare(`
        SELECT COALESCE(SUM(rx_bytes), 0) AS rx, COALESCE(SUM(tx_bytes), 0) AS tx
        FROM interface_traffic_hourly
        WHERE interface_id = ? AND hour_bucket >= ?
      `).get(wan.id, since);
      return { rx: r.rx, tx: r.tx };
    }
    const today = totalSince(now - 24 * 3600);
    const week = totalSince(now - 7 * 86400);
    const month = totalSince(now - 30 * 86400);

    const chartSvg = renderWanChartSvg({ samples, width: 800, height: 90 });
    res.render('fragments/wan-summary', { wan, today, week, month, range, chartSvg, formatBytes });
  });

  router.get('/fragments/device/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).send('bad id');
    const dev = db.prepare(`
      SELECT d.*, i.pfsense_name AS interface_name, i.friendly_name AS interface_friendly
      FROM devices d
      LEFT JOIN interfaces i ON i.id = d.interface_id
      WHERE d.id = ?
    `).get(id);
    if (!dev) return res.status(404).send('not found');

    const now = Math.floor(Date.now() / 1000);
    const tags = db.prepare('SELECT tag FROM device_tags WHERE device_id = ? ORDER BY tag').all(id).map(r => r.tag);
    const todayBytes = db.prepare(`
      SELECT COALESCE(SUM(rx_bytes), 0) AS rx, COALESCE(SUM(tx_bytes), 0) AS tx
      FROM traffic_hourly WHERE device_id = ? AND hour_bucket >= ?
    `).get(id, now - 24 * 3600);
    const weekBytes = db.prepare(`
      SELECT COALESCE(SUM(rx_bytes), 0) AS rx, COALESCE(SUM(tx_bytes), 0) AS tx
      FROM traffic_hourly WHERE device_id = ? AND hour_bucket >= ?
    `).get(id, now - 7 * 86400);
    const monthBytes = db.prepare(`
      SELECT COALESCE(SUM(rx_bytes), 0) AS rx, COALESCE(SUM(tx_bytes), 0) AS tx
      FROM traffic_daily WHERE device_id = ? AND day_bucket >= ?
    `).get(id, now - 30 * 86400);
    const allTimeBytes = db.prepare(`
      SELECT COALESCE(SUM(rx_bytes), 0) AS rx, COALESCE(SUM(tx_bytes), 0) AS tx
      FROM traffic_daily WHERE device_id = ?
    `).get(id);
    const lastSample = db.prepare(`
      SELECT rx_bytes, tx_bytes, states_count
      FROM traffic_samples
      WHERE device_id = ?
      ORDER BY ts DESC LIMIT 1
    `).get(id) ?? { rx_bytes: 0, tx_bytes: 0, states_count: 0 };
    const trafficSamples = db.prepare(`
      SELECT hour_bucket AS ts, rx_bytes, tx_bytes
      FROM traffic_hourly WHERE device_id = ? AND hour_bucket >= ?
      ORDER BY hour_bucket
    `).all(id, now - 24 * 3600);
    const uptimeEvents = db.prepare(`
      SELECT ts, status FROM uptime_events
      WHERE device_id = ? AND ts >= ?
      ORDER BY ts
    `).all(id, now - 24 * 3600);
    const countries = db.prepare(`
      SELECT country_code, hit_count FROM geo_connections
      WHERE device_id = ? ORDER BY hit_count DESC LIMIT 5
    `).all(id);

    const trafficSvg = renderDeviceTrafficSvg({ samples: trafficSamples });
    const uptimeSvg = renderUptimeSparklineSvg({
      events: uptimeEvents,
      windowStart: now - 24 * 3600,
      windowEnd: now,
      isOnlineNow: dev.is_online === 1,
    });

    res.render('fragments/device-detail', {
      dev, tags, todayBytes, weekBytes, monthBytes, allTimeBytes,
      lastSample, countries, trafficSvg, uptimeSvg, now,
      formatBytes, formatRelative,
    });
  });

  return router;
}
