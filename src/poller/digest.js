function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function isoDate(now) {
  return new Date(now * 1000).toISOString().slice(0, 10);
}

export function buildDigestSummary(db, { now }) {
  const dayAgo = now - 86400;

  const newDevices = db
    .prepare(`
    SELECT hostname, nickname, mac, current_ip, device_type_guess
    FROM devices WHERE first_seen_at >= ?
    ORDER BY first_seen_at DESC LIMIT 10
  `)
    .all(dayAgo);

  const silentDevices = db
    .prepare(`
    SELECT hostname, nickname, mac, current_ip, last_seen_at
    FROM devices WHERE is_online = 0 AND last_seen_at < ?
    ORDER BY last_seen_at DESC LIMIT 10
  `)
    .all(dayAgo);

  const topMovers = db
    .prepare(`
    SELECT d.hostname, d.nickname, d.mac, (
      COALESCE((SELECT SUM(rx_bytes + tx_bytes) FROM traffic_hourly th
                WHERE th.device_id = d.id AND th.hour_bucket >= @dayAgo), 0)
      + COALESCE((SELECT SUM(rx_bytes + tx_bytes) FROM traffic_samples ts
                  WHERE ts.device_id = d.id AND ts.ts >= @dayAgo
                  AND NOT EXISTS (
                    SELECT 1 FROM traffic_hourly h
                    WHERE h.device_id = ts.device_id
                    AND h.hour_bucket = (ts.ts / 3600) * 3600
                  )), 0)
    ) AS bytes
    FROM devices d
    WHERE bytes > 0
    ORDER BY bytes DESC
    LIMIT 3
  `)
    .all({ dayAgo });

  const pollFailures = db
    .prepare('SELECT COUNT(*) AS c FROM poll_log WHERE ts >= ? AND success = 0')
    .get(dayAgo).c;

  const lines = [`pfmon daily digest - ${isoDate(now)}`, ''];
  let hasContent = false;

  if (newDevices.length > 0) {
    hasContent = true;
    lines.push('New devices (last 24h):');
    for (const d of newDevices) {
      const name = d.nickname ?? d.hostname ?? d.mac;
      const type =
        d.device_type_guess && d.device_type_guess !== 'Unknown' ? ` [${d.device_type_guess}]` : '';
      lines.push(`  - ${name} (${d.current_ip ?? '?'})${type}`);
    }
    lines.push('');
  }

  if (silentDevices.length > 0) {
    hasContent = true;
    lines.push('Devices gone silent:');
    for (const d of silentDevices) {
      const name = d.nickname ?? d.hostname ?? d.mac;
      const hrsAgo = Math.floor((now - d.last_seen_at) / 3600);
      lines.push(`  - ${name} (last seen ${hrsAgo}h ago)`);
    }
    lines.push('');
  }

  if (topMovers.length > 0) {
    hasContent = true;
    lines.push('Top bandwidth (last 24h):');
    topMovers.forEach((d, i) => {
      const name = d.nickname ?? d.hostname ?? d.mac;
      lines.push(`  ${i + 1}. ${name}: ${fmtBytes(d.bytes)}`);
    });
    lines.push('');
  }

  if (pollFailures > 0) {
    hasContent = true;
    lines.push(`WAN poll failures: ${pollFailures} in the last 24h`);
    lines.push('');
  }

  return { summary: lines.join('\n').trimEnd(), hasContent };
}
