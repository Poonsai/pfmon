import express from 'express';
import { renderDeviceTrafficSvg } from '../charts/device-traffic-chart.js';
import { renderUptimeSparklineSvg } from '../charts/uptime-sparkline.js';
import { renderWanChartSvg } from '../charts/wan-chart.js';

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
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

// Sort key for IPv4 addresses. SQLite has no IP type and `ORDER BY current_ip`
// is a text sort — "10.0.0.10" sorts before "10.0.0.9". Convert each octet to
// a numeric key so the order matches what a human expects. Non-IPv4 values
// (NULL, IPv6 in current_ip, malformed) sort to the end.
function ipv4SortKey(ip) {
  if (!ip || typeof ip !== 'string') return Number.POSITIVE_INFINITY;
  const parts = ip.split('.');
  if (parts.length !== 4) return Number.POSITIVE_INFINITY;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return Number.POSITIVE_INFINITY;
    n = n * 256 + v;
  }
  return n;
}

// Time-series rollups (traffic_hourly, traffic_daily) lag behind the live poller. The
// hourly rollup runs at :00 each hour, the daily rollup at 00:05. To avoid showing 0 for
// the in-progress hour/day — or, worse, dropping samples that fall in a hour whose rollup
// hasn't fired yet (fresh-start scenario, or briefly each hour) — dashboard queries union
// rollup rows with sample rows but partition by *existence* of the rollup row, not a
// wall-clock boundary. A sample is counted only if no rollup row covers its bucket.

function sumDeviceBytes(db, { deviceId, sinceTs }) {
  return db
    .prepare(`
    SELECT
      COALESCE((SELECT SUM(rx_bytes) FROM traffic_hourly
                WHERE device_id = @id AND hour_bucket >= @sinceTs), 0)
      + COALESCE((SELECT SUM(rx_bytes) FROM traffic_samples s
                  WHERE s.device_id = @id AND s.ts >= @sinceTs
                  AND NOT EXISTS (
                    SELECT 1 FROM traffic_hourly h
                    WHERE h.device_id = s.device_id
                    AND h.hour_bucket = (s.ts / 3600) * 3600
                  )), 0)
      AS rx,
      COALESCE((SELECT SUM(tx_bytes) FROM traffic_hourly
                WHERE device_id = @id AND hour_bucket >= @sinceTs), 0)
      + COALESCE((SELECT SUM(tx_bytes) FROM traffic_samples s
                  WHERE s.device_id = @id AND s.ts >= @sinceTs
                  AND NOT EXISTS (
                    SELECT 1 FROM traffic_hourly h
                    WHERE h.device_id = s.device_id
                    AND h.hour_bucket = (s.ts / 3600) * 3600
                  )), 0)
      AS tx
  `)
    .get({ id: deviceId, sinceTs });
}

function sumDeviceBytesAllTime(db, { deviceId }) {
  return db
    .prepare(`
    SELECT
      COALESCE((SELECT SUM(rx_bytes) FROM traffic_daily
                WHERE device_id = @id), 0)
      + COALESCE((SELECT SUM(rx_bytes) FROM traffic_hourly h
                  WHERE h.device_id = @id
                  AND NOT EXISTS (
                    SELECT 1 FROM traffic_daily d
                    WHERE d.device_id = h.device_id
                    AND d.day_bucket = (h.hour_bucket / 86400) * 86400
                  )), 0)
      + COALESCE((SELECT SUM(rx_bytes) FROM traffic_samples s
                  WHERE s.device_id = @id
                  AND NOT EXISTS (
                    SELECT 1 FROM traffic_hourly h
                    WHERE h.device_id = s.device_id
                    AND h.hour_bucket = (s.ts / 3600) * 3600
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM traffic_daily d
                    WHERE d.device_id = s.device_id
                    AND d.day_bucket = (s.ts / 86400) * 86400
                  )), 0)
      AS rx,
      COALESCE((SELECT SUM(tx_bytes) FROM traffic_daily
                WHERE device_id = @id), 0)
      + COALESCE((SELECT SUM(tx_bytes) FROM traffic_hourly h
                  WHERE h.device_id = @id
                  AND NOT EXISTS (
                    SELECT 1 FROM traffic_daily d
                    WHERE d.device_id = h.device_id
                    AND d.day_bucket = (h.hour_bucket / 86400) * 86400
                  )), 0)
      + COALESCE((SELECT SUM(tx_bytes) FROM traffic_samples s
                  WHERE s.device_id = @id
                  AND NOT EXISTS (
                    SELECT 1 FROM traffic_hourly h
                    WHERE h.device_id = s.device_id
                    AND h.hour_bucket = (s.ts / 3600) * 3600
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM traffic_daily d
                    WHERE d.device_id = s.device_id
                    AND d.day_bucket = (s.ts / 86400) * 86400
                  )), 0)
      AS tx
  `)
    .get({ id: deviceId });
}

function sumInterfaceBytes(db, { interfaceId, sinceTs }) {
  return db
    .prepare(`
    SELECT
      COALESCE((SELECT SUM(rx_bytes) FROM interface_traffic_hourly
                WHERE interface_id = @id AND hour_bucket >= @sinceTs), 0)
      + COALESCE((SELECT SUM(rx_bytes) FROM interface_traffic_samples s
                  WHERE s.interface_id = @id AND s.ts >= @sinceTs
                  AND NOT EXISTS (
                    SELECT 1 FROM interface_traffic_hourly h
                    WHERE h.interface_id = s.interface_id
                    AND h.hour_bucket = (s.ts / 3600) * 3600
                  )), 0)
      AS rx,
      COALESCE((SELECT SUM(tx_bytes) FROM interface_traffic_hourly
                WHERE interface_id = @id AND hour_bucket >= @sinceTs), 0)
      + COALESCE((SELECT SUM(tx_bytes) FROM interface_traffic_samples s
                  WHERE s.interface_id = @id AND s.ts >= @sinceTs
                  AND NOT EXISTS (
                    SELECT 1 FROM interface_traffic_hourly h
                    WHERE h.interface_id = s.interface_id
                    AND h.hour_bucket = (s.ts / 3600) * 3600
                  )), 0)
      AS tx
  `)
    .get({ id: interfaceId, sinceTs });
}

function interfaceHourlySeries(db, { interfaceId, sinceTs }) {
  return db
    .prepare(`
    SELECT hour_bucket AS ts, rx_bytes, tx_bytes
    FROM interface_traffic_hourly
    WHERE interface_id = @id AND hour_bucket >= @sinceTs
    UNION ALL
    SELECT (s.ts / 3600) * 3600 AS ts,
           CAST(SUM(s.rx_bytes) AS INTEGER) AS rx_bytes,
           CAST(SUM(s.tx_bytes) AS INTEGER) AS tx_bytes
    FROM interface_traffic_samples s
    WHERE s.interface_id = @id AND s.ts >= @sinceTs
      AND NOT EXISTS (
        SELECT 1 FROM interface_traffic_hourly h
        WHERE h.interface_id = s.interface_id
        AND h.hour_bucket = (s.ts / 3600) * 3600
      )
    GROUP BY (s.ts / 3600) * 3600
    ORDER BY ts
  `)
    .all({ id: interfaceId, sinceTs });
}

export function buildFragmentsRouter({ db }) {
  const router = express.Router();

  router.get('/fragments/header-meta', (_req, res) => {
    const counts = db
      .prepare(`
      SELECT
        (SELECT COUNT(*) FROM devices) AS total,
        (SELECT COUNT(*) FROM devices WHERE is_online = 1) AS online,
        (SELECT COUNT(*) FROM interfaces WHERE kind = 'vlan') AS vlans
    `)
      .get();
    const lastPoll = db
      .prepare('SELECT ts FROM poll_log WHERE success = 1 ORDER BY ts DESC LIMIT 1')
      .get();
    const freshness = lastPoll ? Math.floor(Date.now() / 1000) - lastPoll.ts : null;
    res.render('fragments/header-meta', { ...counts, freshness });
  });

  router.get('/fragments/device-list', (req, res) => {
    const { q = '', status = '', vlan = '', sort = 'last_seen' } = req.query;

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
      // Escape SQL LIKE wildcards in the user-supplied search query. Without
      // this, a user typing "%" or "_" would unexpectedly match everything /
      // any single char. Backslash is also escaped so an ESCAPE '\' clause
      // works correctly. Parameters are still bound so this is a UX fix, not
      // a security fix.
      where.push(`(
        COALESCE(d.nickname,'') LIKE @qLike ESCAPE '\\' OR
        COALESCE(d.hostname,'') LIKE @qLike ESCAPE '\\' OR
        COALESCE(d.current_ip,'') LIKE @qLike ESCAPE '\\' OR
        d.mac LIKE @qLike ESCAPE '\\' OR
        COALESCE(d.vendor,'') LIKE @qLike ESCAPE '\\' OR
        EXISTS (SELECT 1 FROM device_tags t WHERE t.device_id = d.id AND t.tag LIKE @qLike ESCAPE '\\')
      )`);
      params.qLike = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    }

    const now = Math.floor(Date.now() / 1000);
    const bytesTodayStart = now - 24 * 3600;
    // Mirrors sumDeviceBytes: hourly buckets in range, plus samples whose bucket
    // isn't already in hourly. The existence-based partition keeps this correct
    // when the hourly rollup hasn't fired yet for a covered hour.
    const bytesTodaySql = `(
      COALESCE((SELECT SUM(rx_bytes + tx_bytes) FROM traffic_hourly th
                WHERE th.device_id = d.id AND th.hour_bucket >= @bytesTodayStart), 0)
      + COALESCE((SELECT SUM(rx_bytes + tx_bytes) FROM traffic_samples ts
                  WHERE ts.device_id = d.id AND ts.ts >= @bytesTodayStart
                  AND NOT EXISTS (
                    SELECT 1 FROM traffic_hourly th2
                    WHERE th2.device_id = ts.device_id
                    AND th2.hour_bucket = (ts.ts / 3600) * 3600
                  )), 0)
    )`;

    let orderBy = 'd.last_seen_at DESC';
    if (sort === 'name') orderBy = "COALESCE(d.nickname, d.hostname, '') COLLATE NOCASE";
    else if (sort === 'bytes_today') orderBy = `${bytesTodaySql} DESC`;
    // sort === 'ip' is handled in JS below — SQLite can't sort IPv4 numerically.

    const rows = db
      .prepare(`
      SELECT d.id, d.mac, d.vendor, d.hostname, d.nickname, d.current_ip,
             d.is_online, d.last_seen_at, d.new_until_seen_at,
             i.pfsense_name AS interface_name, i.friendly_name AS interface_friendly,
             ${bytesTodaySql} AS bytes_today
      FROM devices d
      LEFT JOIN interfaces i ON i.id = d.interface_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
    `)
      .all({ ...params, bytesTodayStart });

    if (sort === 'ip') {
      rows.sort((a, b) => ipv4SortKey(a.current_ip) - ipv4SortKey(b.current_ip));
    }

    const vlans = db
      .prepare(
        `SELECT pfsense_name, friendly_name FROM interfaces WHERE kind != 'wan' ORDER BY pfsense_name`,
      )
      .all();

    res.render('fragments/device-list', {
      rows,
      vlans,
      now: Math.floor(Date.now() / 1000),
      query: { q, status, vlan, sort },
      formatRelative,
      formatBytes,
    });
  });

  router.get('/fragments/alerts', (_req, res) => {
    const newDevices = db
      .prepare(`
      SELECT d.id, d.mac, d.vendor, d.hostname, d.current_ip, i.pfsense_name AS interface_name
      FROM devices d
      LEFT JOIN interfaces i ON i.id = d.interface_id
      WHERE d.new_until_seen_at IS NOT NULL
      ORDER BY d.first_seen_at DESC
    `)
      .all();
    const lastPoll = db
      .prepare('SELECT success, error_msg, ts FROM poll_log ORDER BY ts DESC LIMIT 1')
      .get();
    const pollFailed = lastPoll && lastPoll.success === 0;
    res.render('fragments/alerts', {
      newDevices,
      pollFailed,
      pollError: lastPoll?.error_msg ?? null,
    });
  });

  router.get('/fragments/wan-summary', (req, res) => {
    const range = req.query.range === '7d' ? '7d' : req.query.range === '30d' ? '30d' : '24h';
    const rangeSec = range === '24h' ? 24 * 3600 : range === '7d' ? 7 * 86400 : 30 * 86400;
    const now = Math.floor(Date.now() / 1000);

    const wan = db
      .prepare(`SELECT id, friendly_name FROM interfaces WHERE kind = 'wan' LIMIT 1`)
      .get();
    if (!wan) {
      return res.render('fragments/wan-summary', { wan: null });
    }

    const samples = interfaceHourlySeries(db, {
      interfaceId: wan.id,
      sinceTs: now - rangeSec,
    });
    const today = sumInterfaceBytes(db, { interfaceId: wan.id, sinceTs: now - 24 * 3600 });
    const week = sumInterfaceBytes(db, { interfaceId: wan.id, sinceTs: now - 7 * 86400 });
    const month = sumInterfaceBytes(db, { interfaceId: wan.id, sinceTs: now - 30 * 86400 });

    const chartSvg = renderWanChartSvg({ samples, width: 800, height: 90 });
    res.render('fragments/wan-summary', { wan, today, week, month, range, chartSvg, formatBytes });
  });

  router.get('/fragments/device/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).send('bad id');
    const dev = db
      .prepare(`
      SELECT d.*, i.pfsense_name AS interface_name, i.friendly_name AS interface_friendly
      FROM devices d
      LEFT JOIN interfaces i ON i.id = d.interface_id
      WHERE d.id = ?
    `)
      .get(id);
    if (!dev) return res.status(404).send('not found');

    const now = Math.floor(Date.now() / 1000);
    const tags = db
      .prepare('SELECT tag FROM device_tags WHERE device_id = ? ORDER BY tag')
      .all(id)
      .map((r) => r.tag);
    const todayBytes = sumDeviceBytes(db, { deviceId: id, sinceTs: now - 24 * 3600 });
    const weekBytes = sumDeviceBytes(db, { deviceId: id, sinceTs: now - 7 * 86400 });
    const monthBytes = sumDeviceBytes(db, { deviceId: id, sinceTs: now - 30 * 86400 });
    const allTimeBytes = sumDeviceBytesAllTime(db, { deviceId: id });
    // The bandwidth-now field renders "Down: X/s · Up: Y/s". A sample's
    // rx_bytes/tx_bytes is the delta over the previous poll interval, not a
    // per-second rate. Fetch the two most recent samples to derive the actual
    // interval and convert the delta into bytes/second so the "/s" label is
    // truthful. When only one sample exists we have no interval to divide by,
    // so we fall back to 30s — the default poll interval — and round.
    const recentSamples = db
      .prepare(`
      SELECT ts, rx_bytes, tx_bytes, states_count
      FROM traffic_samples
      WHERE device_id = ?
      ORDER BY ts DESC LIMIT 2
    `)
      .all(id);
    const latest = recentSamples[0] ?? { ts: now, rx_bytes: 0, tx_bytes: 0, states_count: 0 };
    const sampleIntervalSec =
      recentSamples.length === 2 ? Math.max(1, recentSamples[0].ts - recentSamples[1].ts) : 30;
    const lastSample = {
      rx_bytes: Math.round((latest.rx_bytes ?? 0) / sampleIntervalSec),
      tx_bytes: Math.round((latest.tx_bytes ?? 0) / sampleIntervalSec),
      states_count: latest.states_count ?? 0,
    };
    const trafficSamples = db
      .prepare(`
      SELECT hour_bucket AS ts, rx_bytes, tx_bytes
      FROM traffic_hourly WHERE device_id = ? AND hour_bucket >= ?
      ORDER BY hour_bucket
    `)
      .all(id, now - 24 * 3600);
    const uptimeEvents = db
      .prepare(`
      SELECT ts, status FROM uptime_events
      WHERE device_id = ? AND ts >= ?
      ORDER BY ts
    `)
      .all(id, now - 24 * 3600);
    const countries = db
      .prepare(`
      SELECT country_code, hit_count FROM geo_connections
      WHERE device_id = ? ORDER BY hit_count DESC LIMIT 5
    `)
      .all(id);

    const trafficSvg = renderDeviceTrafficSvg({ samples: trafficSamples });
    const uptimeSvg = renderUptimeSparklineSvg({
      events: uptimeEvents,
      windowStart: now - 24 * 3600,
      windowEnd: now,
      isOnlineNow: dev.is_online === 1,
    });

    res.render('fragments/device-detail', {
      dev,
      tags,
      todayBytes,
      weekBytes,
      monthBytes,
      allTimeBytes,
      lastSample,
      countries,
      trafficSvg,
      uptimeSvg,
      now,
      formatBytes,
      formatRelative,
    });
  });

  return router;
}
