import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import {
  syncInterfaces,
  reconcileDevices,
  recordGeoConnections,
  recordFirewallBlocks,
} from '../src/poller/reconcile.js';

function dev(overrides = {}) {
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
    ...overrides,
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

describe('reconcile security tables', () => {
  it('upserts geo_connections per device + country', () => {
    const db = setup();
    recordGeoConnections(db, {
      snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': dev({ countries: { US: 3, NL: 1 } }) } },
      now: 2000,
    });
    const rows = db
      .prepare('SELECT country_code, hit_count FROM geo_connections ORDER BY country_code')
      .all();
    expect(rows).toEqual([
      { country_code: 'NL', hit_count: 1 },
      { country_code: 'US', hit_count: 3 },
    ]);
    recordGeoConnections(db, {
      snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': dev({ countries: { US: 2 } }) } },
      now: 3000,
    });
    const us = db
      .prepare("SELECT hit_count, last_seen_at FROM geo_connections WHERE country_code='US'")
      .get();
    expect(us.hit_count).toBe(5);
    expect(us.last_seen_at).toBe(3000);
  });

  it('inserts firewall_blocks de-duplicated by dedupe_hash', () => {
    const db = setup();
    const block = {
      ts: 1234,
      src_ip: '10.0.0.42',
      src_port: 5555,
      dst_ip: '8.8.8.8',
      dst_port: 53,
      proto: 'udp',
      direction: 'out',
    };
    recordFirewallBlocks(db, { blocks: [block] });
    recordFirewallBlocks(db, { blocks: [block, block] });
    const count = db.prepare('SELECT COUNT(*) as c FROM firewall_blocks').get().c;
    expect(count).toBe(1);
  });
});
