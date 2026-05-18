export async function maybeFireNewDeviceAlerts(db, { topicUrl, now, graceSec }) {
  if (!topicUrl) return;
  const candidates = db.prepare(`
    SELECT d.id, d.mac, d.vendor, d.hostname, d.current_ip, i.pfsense_name AS interface_name
    FROM devices d
    LEFT JOIN interfaces i ON i.id = d.interface_id
    WHERE d.alerted_at IS NULL AND d.first_seen_at <= ?
  `).all(now - graceSec);

  const markAlerted = db.prepare('UPDATE devices SET alerted_at = ? WHERE id = ?');

  for (const dev of candidates) {
    const body = `New device on network\nvendor=${dev.vendor ?? '?'}\nhostname=${dev.hostname ?? '?'}\nip=${dev.current_ip ?? '?'}\nmac=${dev.mac}\nvlan=${dev.interface_name ?? '?'}`;
    try {
      const res = await fetch(topicUrl, {
        method: 'POST',
        headers: { 'Title': 'pfmon: new device', 'Content-Type': 'text/plain' },
        body,
      });
      if (!res.ok) {
        console.log(JSON.stringify({ level: 'warn', msg: 'ntfy non-2xx', status: res.status }));
        continue;
      }
      markAlerted.run(now, dev.id);
    } catch (e) {
      console.log(JSON.stringify({ level: 'warn', msg: 'ntfy error', error: String(e) }));
    }
  }
}
