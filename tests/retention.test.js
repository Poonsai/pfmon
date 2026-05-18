import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { reconcileDevices, syncInterfaces } from '../src/poller/reconcile.js';
import { pruneOldRows, rollupDaily, rollupHourly } from '../src/poller/retention.js';

function dev() {
  return {
    mac: 'aa:bb:cc:dd:ee:ff',
    vendor: 'X',
    hostname: 'h',
    ip: '10.0.0.42',
    ipv6: null,
    interface: 'lan',
    lease_type: null,
    lease_expires_at: null,
    device_type_guess: 'Unknown',
    rx_bytes_total: 0,
    tx_bytes_total: 0,
    states_count: 0,
    countries: {},
  };
}

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  syncInterfaces(db, [
    {
      pfsense_name: 'lan',
      friendly_name: 'LAN',
      kind: 'lan',
      vlan_tag: null,
      ipv4_subnet: '10.0.0.0/24',
      ipv6_prefix: null,
    },
  ]);
  reconcileDevices(db, {
    snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': dev() } },
    now: 1000,
    staleAfterSec: 300,
  });
  return db;
}

describe('retention', () => {
  it('prunes traffic_samples older than 7d and poll_log older than 7d', () => {
    const db = setup();
    const dev_id = db.prepare('SELECT id FROM devices LIMIT 1').get().id;
    const now = 1_000_000;
    db.prepare('INSERT INTO traffic_samples VALUES (?, ?, 0, 0, 0)').run(dev_id, now - 30 * 86400);
    db.prepare('INSERT INTO traffic_samples VALUES (?, ?, 0, 0, 0)').run(dev_id, now);
    db.prepare('INSERT INTO poll_log (ts, success) VALUES (?, 1)').run(now - 30 * 86400);
    db.prepare('INSERT INTO poll_log (ts, success) VALUES (?, 1)').run(now);
    pruneOldRows(db, { now });
    expect(db.prepare('SELECT COUNT(*) c FROM traffic_samples').get().c).toBe(1);
    expect(db.prepare('SELECT COUNT(*) c FROM poll_log').get().c).toBe(1);
  });

  it('rolls hourly aggregates from traffic_samples', () => {
    const db = setup();
    const dev_id = db.prepare('SELECT id FROM devices LIMIT 1').get().id;
    const hour = Math.floor(1_700_000_000 / 3600) * 3600;
    db.prepare('INSERT INTO traffic_samples VALUES (?, ?, 100, 50, 1)').run(dev_id, hour + 100);
    db.prepare('INSERT INTO traffic_samples VALUES (?, ?, 200, 75, 2)').run(dev_id, hour + 200);
    rollupHourly(db, { now: hour + 3700 });
    const row = db
      .prepare('SELECT rx_bytes, tx_bytes FROM traffic_hourly WHERE device_id = ?')
      .get(dev_id);
    expect(row).toEqual({ rx_bytes: 300, tx_bytes: 125 });
  });

  it('rolls daily aggregates from traffic_hourly', () => {
    const db = setup();
    const dev_id = db.prepare('SELECT id FROM devices LIMIT 1').get().id;
    const day = Math.floor(1_700_000_000 / 86400) * 86400;
    db.prepare('INSERT INTO traffic_hourly VALUES (?, ?, 100, 50, 10, 5)').run(dev_id, day);
    db.prepare('INSERT INTO traffic_hourly VALUES (?, ?, 200, 75, 20, 8)').run(dev_id, day + 3600);
    rollupDaily(db, { now: day + 86400 + 100 });
    const row = db
      .prepare('SELECT rx_bytes, tx_bytes, peak_rx_rate FROM traffic_daily WHERE device_id = ?')
      .get(dev_id);
    expect(row).toEqual({ rx_bytes: 300, tx_bytes: 125, peak_rx_rate: 20 });
  });

  it('does not overwrite an hourly row after its underlying samples have been pruned', () => {
    // Guardrail: the rollup uses ON CONFLICT DO UPDATE, but the SQL GROUP BY
    // only emits rows for keys present in samples. With samples for hour H
    // pruned, no row is emitted for H, so the existing hourly row for H stays
    // intact. If anyone ever changes the WHERE clause to "WHERE TRUE" or
    // introduces a LEFT JOIN that synthesizes zero-rows, this test catches the
    // resulting data loss.
    const db = setup();
    const dev_id = db.prepare('SELECT id FROM devices LIMIT 1').get().id;
    const hour = Math.floor(1_700_000_000 / 3600) * 3600;
    db.prepare('INSERT INTO traffic_samples VALUES (?, ?, 100, 50, 1)').run(dev_id, hour + 100);
    db.prepare('INSERT INTO traffic_samples VALUES (?, ?, 200, 75, 2)').run(dev_id, hour + 200);
    rollupHourly(db, { now: hour + 3700 });
    expect(
      db.prepare('SELECT rx_bytes, tx_bytes FROM traffic_hourly WHERE device_id = ?').get(dev_id),
    ).toEqual({ rx_bytes: 300, tx_bytes: 125 });

    // 8 days later — retention has pruned the underlying samples.
    db.prepare('DELETE FROM traffic_samples WHERE device_id = ?').run(dev_id);
    rollupHourly(db, { now: hour + 8 * 86400 });

    expect(
      db
        .prepare(
          'SELECT rx_bytes, tx_bytes FROM traffic_hourly WHERE device_id = ? AND hour_bucket = ?',
        )
        .get(dev_id, hour),
    ).toEqual({ rx_bytes: 300, tx_bytes: 125 });
  });

  it('does not overwrite a daily row after its underlying hourly rows have been pruned', () => {
    // Same guardrail for the daily rollup. Hourly retention is 90 days; daily
    // is retained forever. As long as the rollup's SELECT only emits rows for
    // present keys, daily rows remain intact after hourly is pruned.
    const db = setup();
    const dev_id = db.prepare('SELECT id FROM devices LIMIT 1').get().id;
    const day = Math.floor(1_700_000_000 / 86400) * 86400;
    db.prepare('INSERT INTO traffic_hourly VALUES (?, ?, 100, 50, 10, 5)').run(dev_id, day);
    db.prepare('INSERT INTO traffic_hourly VALUES (?, ?, 200, 75, 20, 8)').run(dev_id, day + 3600);
    rollupDaily(db, { now: day + 86400 + 100 });
    expect(
      db.prepare('SELECT rx_bytes, tx_bytes FROM traffic_daily WHERE device_id = ?').get(dev_id),
    ).toEqual({ rx_bytes: 300, tx_bytes: 125 });

    // 91 days later — hourly rows pruned.
    db.prepare('DELETE FROM traffic_hourly WHERE device_id = ?').run(dev_id);
    rollupDaily(db, { now: day + 91 * 86400 });

    expect(
      db
        .prepare(
          'SELECT rx_bytes, tx_bytes FROM traffic_daily WHERE device_id = ? AND day_bucket = ?',
        )
        .get(dev_id, day),
    ).toEqual({ rx_bytes: 300, tx_bytes: 125 });
  });

  it('rollupHourly fills in a previously-missed hour when run later (catch-up)', () => {
    // If pfmon was down at the top of hour H+1 (when H's rollup would normally
    // fire), the next rollup at H+2 should still create H's hourly row from
    // the still-extant samples.
    const db = setup();
    const dev_id = db.prepare('SELECT id FROM devices LIMIT 1').get().id;
    const hour = Math.floor(1_700_000_000 / 3600) * 3600;
    db.prepare('INSERT INTO traffic_samples VALUES (?, ?, 100, 50, 1)').run(dev_id, hour + 100);
    // Rollup runs 2 hours later, missed the first :00 trigger.
    rollupHourly(db, { now: hour + 2 * 3600 + 5 });
    expect(
      db
        .prepare(
          'SELECT rx_bytes, tx_bytes FROM traffic_hourly WHERE device_id = ? AND hour_bucket = ?',
        )
        .get(dev_id, hour),
    ).toEqual({ rx_bytes: 100, tx_bytes: 50 });
  });
});
