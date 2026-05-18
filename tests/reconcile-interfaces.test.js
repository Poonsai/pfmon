import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { syncInterfaces } from '../src/poller/reconcile.js';

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('reconcile.syncInterfaces', () => {
  it('inserts new interfaces and updates existing rows', () => {
    const db = fresh();
    syncInterfaces(db, [
      {
        pfsense_name: 'wan',
        friendly_name: 'WAN',
        kind: 'wan',
        vlan_tag: null,
        ipv4_subnet: null,
        ipv6_prefix: null,
      },
      {
        pfsense_name: 'lan',
        friendly_name: 'LAN',
        kind: 'lan',
        vlan_tag: null,
        ipv4_subnet: '10.0.0.0/24',
        ipv6_prefix: null,
      },
    ]);
    const rows = db
      .prepare('SELECT pfsense_name, kind FROM interfaces ORDER BY pfsense_name')
      .all();
    expect(rows).toEqual([
      { pfsense_name: 'lan', kind: 'lan' },
      { pfsense_name: 'wan', kind: 'wan' },
    ]);
    syncInterfaces(db, [
      {
        pfsense_name: 'lan',
        friendly_name: 'Home LAN',
        kind: 'lan',
        vlan_tag: null,
        ipv4_subnet: '10.0.0.0/24',
        ipv6_prefix: null,
      },
    ]);
    const lan = db.prepare("SELECT friendly_name FROM interfaces WHERE pfsense_name='lan'").get();
    expect(lan.friendly_name).toBe('Home LAN');
  });
});
