import { createHash } from 'node:crypto';

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

export function recordTrafficSamples(db, { snapshot, now }) {
  const selDev = db.prepare('SELECT id FROM devices WHERE mac = ?');
  const selPrev = db.prepare('SELECT rx_total, tx_total FROM device_counter_state WHERE device_id = ?');
  const upsertPrev = db.prepare(`
    INSERT INTO device_counter_state (device_id, rx_total, tx_total) VALUES (?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET rx_total = excluded.rx_total, tx_total = excluded.tx_total
  `);
  const insSample = db.prepare(`
    INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const [mac, d] of Object.entries(snapshot.devices)) {
      const devRow = selDev.get(mac);
      if (!devRow) continue;
      const prev = selPrev.get(devRow.id);
      const rxDelta = prev ? Math.max(0, d.rx_bytes_total - prev.rx_total) : 0;
      const txDelta = prev ? Math.max(0, d.tx_bytes_total - prev.tx_total) : 0;
      upsertPrev.run(devRow.id, d.rx_bytes_total, d.tx_bytes_total);
      insSample.run(devRow.id, now, rxDelta, txDelta, d.states_count ?? 0);
    }
  });
  tx();
}

export function recordInterfaceTrafficSamples(db, { stats, now }) {
  const selIface = db.prepare('SELECT id FROM interfaces WHERE pfsense_name = ?');
  const selPrev = db.prepare('SELECT rx_total, tx_total FROM interface_counter_state WHERE interface_id = ?');
  const upsertPrev = db.prepare(`
    INSERT INTO interface_counter_state (interface_id, rx_total, tx_total) VALUES (?, ?, ?)
    ON CONFLICT(interface_id) DO UPDATE SET rx_total = excluded.rx_total, tx_total = excluded.tx_total
  `);
  const insSample = db.prepare(`
    INSERT INTO interface_traffic_samples (interface_id, ts, rx_bytes, tx_bytes) VALUES (?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const s of stats ?? []) {
      const iface = selIface.get(s.name);
      if (!iface) continue;
      const prev = selPrev.get(iface.id);
      const rx = Number(s.inbytes ?? 0);
      const txTotal = Number(s.outbytes ?? 0);
      const rxDelta = prev ? Math.max(0, rx - prev.rx_total) : 0;
      const txDelta = prev ? Math.max(0, txTotal - prev.tx_total) : 0;
      upsertPrev.run(iface.id, rx, txTotal);
      insSample.run(iface.id, now, rxDelta, txDelta);
    }
  });
  tx();
}

export function recordGeoConnections(db, { snapshot, now }) {
  const selDev = db.prepare('SELECT id FROM devices WHERE mac = ?');
  const upsert = db.prepare(`
    INSERT INTO geo_connections (device_id, country_code, last_seen_at, hit_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(device_id, country_code) DO UPDATE SET
      hit_count = hit_count + excluded.hit_count,
      last_seen_at = excluded.last_seen_at
  `);
  const tx = db.transaction(() => {
    for (const [mac, d] of Object.entries(snapshot.devices)) {
      const row = selDev.get(mac);
      if (!row) continue;
      for (const [cc, n] of Object.entries(d.countries ?? {})) {
        upsert.run(row.id, cc, now, n);
      }
    }
  });
  tx();
}

export function recordFirewallBlocks(db, { blocks }) {
  const selDevByIp = db.prepare('SELECT id FROM devices WHERE current_ip = ?');
  const ins = db.prepare(`
    INSERT OR IGNORE INTO firewall_blocks
      (ts, device_id, src_ip, src_port, dst_ip, dst_port, proto, direction, dedupe_hash)
    VALUES (@ts, @device_id, @src_ip, @src_port, @dst_ip, @dst_port, @proto, @direction, @dedupe_hash)
  `);
  const tx = db.transaction(() => {
    for (const b of blocks ?? []) {
      const dev = b.src_ip ? selDevByIp.get(b.src_ip) : null;
      const dedupe = createHash('sha256')
        .update(`${b.ts}|${b.src_ip ?? ''}|${b.src_port ?? ''}|${b.dst_ip ?? ''}|${b.dst_port ?? ''}|${b.proto ?? ''}`)
        .digest('hex');
      ins.run({
        ts: Number(b.ts ?? Math.floor(Date.now() / 1000)),
        device_id: dev?.id ?? null,
        src_ip: b.src_ip ?? null,
        src_port: b.src_port ?? null,
        dst_ip: b.dst_ip ?? null,
        dst_port: b.dst_port ?? null,
        proto: b.proto ?? null,
        direction: b.direction ?? null,
        dedupe_hash: dedupe,
      });
    }
  });
  tx();
}
