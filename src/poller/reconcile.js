export function syncInterfaces(db, interfaces) {
  const upsert = db.prepare(`
    INSERT INTO interfaces (pfsense_name, friendly_name, kind, vlan_tag, ipv4_subnet, ipv6_prefix)
    VALUES (@pfsense_name, @friendly_name, @kind, @vlan_tag, @ipv4_subnet, @ipv6_prefix)
    ON CONFLICT(pfsense_name) DO UPDATE SET
      friendly_name = excluded.friendly_name,
      kind = excluded.kind,
      vlan_tag = excluded.vlan_tag,
      ipv4_subnet = excluded.ipv4_subnet,
      ipv6_prefix = excluded.ipv6_prefix
  `);
  const tx = db.transaction((rows) => { for (const r of rows) upsert.run(r); });
  tx(interfaces);
}

export function reconcileDevices(db, { snapshot, now, staleAfterSec }) {
  const newDeviceIds = [];

  const selByMac = db.prepare('SELECT id, is_online, first_seen_at, alerted_at FROM devices WHERE mac = ?');
  const selIface = db.prepare('SELECT id FROM interfaces WHERE pfsense_name = ?');
  const insDev = db.prepare(`
    INSERT INTO devices (mac, vendor, hostname, current_ip, current_ipv6, interface_id,
      current_lease_type, current_lease_expires_at, device_type_guess,
      is_online, first_seen_at, last_seen_at, new_until_seen_at)
    VALUES (@mac, @vendor, @hostname, @ip, @ipv6, @interface_id,
      @lease_type, @lease_expires_at, @device_type_guess,
      1, @now, @now, @now)
  `);
  const updDev = db.prepare(`
    UPDATE devices SET
      vendor = COALESCE(@vendor, vendor),
      hostname = COALESCE(@hostname, hostname),
      current_ip = @ip,
      current_ipv6 = COALESCE(@ipv6, current_ipv6),
      interface_id = COALESCE(@interface_id, interface_id),
      current_lease_type = COALESCE(@lease_type, current_lease_type),
      current_lease_expires_at = COALESCE(@lease_expires_at, current_lease_expires_at),
      device_type_guess = COALESCE(@device_type_guess, device_type_guess),
      last_seen_at = @now,
      is_online = 1
    WHERE id = @id
  `);
  const markOffline = db.prepare('UPDATE devices SET is_online = 0 WHERE id = ? AND is_online = 1');
  const insUptime = db.prepare('INSERT INTO uptime_events (device_id, ts, status) VALUES (?, ?, ?)');
  const findStale = db.prepare('SELECT id FROM devices WHERE is_online = 1 AND last_seen_at < ?');

  const tx = db.transaction(() => {
    for (const [mac, dev] of Object.entries(snapshot.devices)) {
      const interface_id = dev.interface ? (selIface.get(dev.interface)?.id ?? null) : null;
      const existing = selByMac.get(mac);
      if (!existing) {
        const info = insDev.run({
          mac, vendor: dev.vendor, hostname: dev.hostname, ip: dev.ip, ipv6: dev.ipv6,
          interface_id, lease_type: dev.lease_type, lease_expires_at: dev.lease_expires_at,
          device_type_guess: dev.device_type_guess, now,
        });
        const id = info.lastInsertRowid;
        insUptime.run(id, now, 'online');
        newDeviceIds.push({ id, mac });
      } else {
        updDev.run({
          id: existing.id,
          vendor: dev.vendor, hostname: dev.hostname, ip: dev.ip, ipv6: dev.ipv6,
          interface_id, lease_type: dev.lease_type, lease_expires_at: dev.lease_expires_at,
          device_type_guess: dev.device_type_guess, now,
        });
        if (existing.is_online === 0) insUptime.run(existing.id, now, 'online');
      }
    }
    const cutoff = now - staleAfterSec;
    const stale = findStale.all(cutoff);
    for (const { id } of stale) {
      markOffline.run(id);
      insUptime.run(id, now, 'offline');
    }
  });
  tx();
  return { newDeviceIds };
}
