import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { getTopTalkers } from '../src/routes/fragments.js';

describe('getTopTalkers', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES ('lan','LAN','lan')`,
    ).run();
    db.prepare(`INSERT INTO devices (mac, hostname, current_ip, is_online, first_seen_at, last_seen_at) VALUES
      ('aa:00:00:00:00:01','heavy','10.0.0.1',1,?,?),
      ('aa:00:00:00:00:02','medium','10.0.0.2',1,?,?),
      ('aa:00:00:00:00:03','light','10.0.0.3',1,?,?),
      ('aa:00:00:00:00:04','silent','10.0.0.4',1,?,?)`).run(
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
    );
    const heavy = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:01'").get().id;
    const medium = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:02'").get().id;
    const light = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:03'").get().id;
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(heavy, now - 60, 100_000_000, 5_000_000);
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(medium, now - 60, 10_000_000, 500_000);
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(light, now - 60, 1_000, 500);
  });

  it('returns devices ordered by total bytes descending', () => {
    const now = Math.floor(Date.now() / 1000);
    const rows = getTopTalkers(db, { sinceTs: now - 3600, limit: 10 });
    expect(rows.length).toBe(3);
    expect(rows[0].mac).toBe('aa:00:00:00:00:01');
    expect(rows[1].mac).toBe('aa:00:00:00:00:02');
    expect(rows[2].mac).toBe('aa:00:00:00:00:03');
    expect(rows[0].bytes).toBe(105_000_000);
  });

  it('respects the limit', () => {
    const now = Math.floor(Date.now() / 1000);
    const rows = getTopTalkers(db, { sinceTs: now - 3600, limit: 2 });
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.mac)).toEqual(['aa:00:00:00:00:01', 'aa:00:00:00:00:02']);
  });

  it('counts hourly rollup rows in addition to raw samples', () => {
    const medium = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:02'").get().id;
    const now = Math.floor(Date.now() / 1000);
    const hour = Math.floor((now - 3600) / 3600) * 3600;
    db.prepare(
      `INSERT INTO traffic_hourly (device_id, hour_bucket, rx_bytes, tx_bytes) VALUES (?, ?, ?, ?)`,
    ).run(medium, hour, 500_000_000, 50_000_000);
    const rows = getTopTalkers(db, { sinceTs: now - 7200, limit: 10 });
    expect(rows[0].mac).toBe('aa:00:00:00:00:02');
  });

  it('returns display fields (nickname-or-hostname, ip, interface name)', () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `UPDATE devices SET nickname='Big Box', interface_id=(SELECT id FROM interfaces WHERE pfsense_name='lan') WHERE mac='aa:00:00:00:00:01'`,
    ).run();
    const rows = getTopTalkers(db, { sinceTs: now - 3600, limit: 1 });
    expect(rows[0].nickname).toBe('Big Box');
    expect(rows[0].current_ip).toBe('10.0.0.1');
    expect(rows[0].interface_friendly).toBe('LAN');
  });
});
