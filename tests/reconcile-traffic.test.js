import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import {
  reconcileDevices,
  recordInterfaceTrafficSamples,
  recordTrafficSamples,
  syncInterfaces,
} from '../src/poller/reconcile.js';

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
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
  return db;
}

function dev(overrides) {
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
    countries: {},
    ...overrides,
  };
}

describe('reconcile traffic', () => {
  it('persists the per-poll deltas precomputed by buildSnapshot', () => {
    // recordTrafficSamples no longer derives deltas from a cumulative counter;
    // buildSnapshot computes positive per-flow deltas using prevStateBytes and
    // writes them onto the device. recordTrafficSamples just stores them.
    const db = fresh();
    reconcileDevices(db, {
      snapshot: {
        devices: {
          'aa:bb:cc:dd:ee:ff': dev({ rx_bytes_delta: 0, tx_bytes_delta: 0, states_count: 3 }),
        },
      },
      now: 1000,
      staleAfterSec: 300,
    });
    recordTrafficSamples(db, {
      snapshot: {
        devices: {
          'aa:bb:cc:dd:ee:ff': dev({ rx_bytes_delta: 0, tx_bytes_delta: 0, states_count: 3 }),
        },
      },
      now: 1000,
    });
    const rows1 = db
      .prepare('SELECT rx_bytes, tx_bytes, states_count FROM traffic_samples ORDER BY ts')
      .all();
    expect(rows1).toEqual([{ rx_bytes: 0, tx_bytes: 0, states_count: 3 }]);

    recordTrafficSamples(db, {
      snapshot: {
        devices: {
          'aa:bb:cc:dd:ee:ff': dev({
            rx_bytes_delta: 500,
            tx_bytes_delta: 200,
            states_count: 5,
          }),
        },
      },
      now: 1030,
    });
    const rows2 = db
      .prepare('SELECT rx_bytes, tx_bytes, states_count FROM traffic_samples ORDER BY ts')
      .all();
    expect(rows2[1]).toEqual({ rx_bytes: 500, tx_bytes: 200, states_count: 5 });
  });

  it('records interface counters with deltas', () => {
    const db = fresh();
    recordInterfaceTrafficSamples(db, {
      stats: [{ name: 'wan', inbytes: 100, outbytes: 50 }],
      now: 1000,
    });
    recordInterfaceTrafficSamples(db, {
      stats: [{ name: 'wan', inbytes: 1100, outbytes: 250 }],
      now: 1030,
    });
    const rows = db
      .prepare('SELECT rx_bytes, tx_bytes FROM interface_traffic_samples ORDER BY ts')
      .all();
    expect(rows[1]).toEqual({ rx_bytes: 1000, tx_bytes: 200 });
  });
});
