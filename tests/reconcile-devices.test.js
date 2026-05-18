import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { reconcileDevices, syncInterfaces } from '../src/poller/reconcile.js';

function fresh() {
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
  return db;
}

function mkDev(overrides = {}) {
  return {
    mac: 'aa:bb:cc:dd:ee:ff',
    vendor: 'TestCorp',
    hostname: 'tv',
    ip: '10.0.0.42',
    ipv6: null,
    interface: 'lan',
    lease_type: 'dynamic',
    lease_expires_at: null,
    states_count: 0,
    rx_bytes_total: 0,
    tx_bytes_total: 0,
    device_type_guess: 'Unknown',
    countries: {},
    ...overrides,
  };
}

describe('reconcile.reconcileDevices', () => {
  it('inserts a new device and flags it as NEW', () => {
    const db = fresh();
    const now = 1_700_000_000;
    const result = reconcileDevices(db, {
      snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': mkDev() } },
      now,
      staleAfterSec: 300,
    });
    expect(result.newDeviceIds).toHaveLength(1);
    const row = db.prepare("SELECT * FROM devices WHERE mac='aa:bb:cc:dd:ee:ff'").get();
    expect(row.first_seen_at).toBe(now);
    expect(row.last_seen_at).toBe(now);
    expect(row.new_until_seen_at).toBe(now);
    expect(row.is_online).toBe(1);
  });

  it('updates last_seen and records online transition when a device returns', () => {
    const db = fresh();
    reconcileDevices(db, {
      snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': mkDev() } },
      now: 1000,
      staleAfterSec: 300,
    });
    reconcileDevices(db, { snapshot: { devices: {} }, now: 2000, staleAfterSec: 300 });
    const offline = db.prepare("SELECT is_online FROM devices WHERE mac='aa:bb:cc:dd:ee:ff'").get();
    expect(offline.is_online).toBe(0);
    const events1 = db
      .prepare('SELECT status FROM uptime_events ORDER BY ts')
      .all()
      .map((r) => r.status);
    expect(events1).toEqual(['online', 'offline']);

    reconcileDevices(db, {
      snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': mkDev() } },
      now: 3000,
      staleAfterSec: 300,
    });
    const events2 = db
      .prepare('SELECT status FROM uptime_events ORDER BY ts')
      .all()
      .map((r) => r.status);
    expect(events2).toEqual(['online', 'offline', 'online']);
  });

  it('keeps a device "online" if its last_seen is within staleAfterSec', () => {
    const db = fresh();
    reconcileDevices(db, {
      snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': mkDev() } },
      now: 1000,
      staleAfterSec: 300,
    });
    reconcileDevices(db, { snapshot: { devices: {} }, now: 1200, staleAfterSec: 300 });
    const row = db.prepare("SELECT is_online FROM devices WHERE mac='aa:bb:cc:dd:ee:ff'").get();
    expect(row.is_online).toBe(1);
  });
});
