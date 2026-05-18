import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { runOnePoll } from '../src/poller/index.js';

function fakeClient() {
  return {
    fetchArpTable: async () => [
      { mac: 'AA:BB:CC:DD:EE:FF', ip: '10.0.0.42', hostname: 'tv', interface: 'lan' },
    ],
    fetchDhcpLeases: async () => [
      {
        mac: 'aa:bb:cc:dd:ee:ff',
        ip: '10.0.0.42',
        type: 'dynamic',
        hostname: 'tv',
        expires: 9_999_999,
      },
    ],
    fetchNdpTable: async () => [],
    fetchFirewallStates: async () => [
      { src: '10.0.0.42', dst: '8.8.8.8', bytes_in: 100, bytes_out: 50 },
    ],
    fetchInterfaces: async () => [
      { if: 'wan', descr: 'WAN' },
      { if: 'lan', descr: 'LAN', ipv4_address: '10.0.0.1', ipv4_subnet: '24' },
    ],
    fetchInterfaceStats: async () => [
      { name: 'wan', inbytes: 1000, outbytes: 500 },
      { name: 'lan', inbytes: 2000, outbytes: 1000 },
    ],
    fetchFilterLogBlocks: async () => [],
  };
}

describe('runOnePoll', () => {
  it('runs a full tick end-to-end and writes data + poll_log', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const result = await runOnePoll({
      db,
      client: fakeClient(),
      ouiMap: new Map([['AABBCC', 'TestCorp']]),
      geoRanges: [],
      now: 1_000_000,
      staleAfterSec: 300,
    });
    expect(result.success).toBe(true);
    expect(db.prepare('SELECT COUNT(*) c FROM devices').get().c).toBe(1);
    expect(db.prepare('SELECT COUNT(*) c FROM interfaces').get().c).toBe(2);
    expect(db.prepare('SELECT COUNT(*) c FROM poll_log WHERE success=1').get().c).toBe(1);
  });

  it('records a poll_log failure row on error and does not crash', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const broken = {
      ...fakeClient(),
      fetchArpTable: async () => {
        throw new Error('boom');
      },
    };
    const result = await runOnePoll({
      db,
      client: broken,
      ouiMap: new Map(),
      geoRanges: [],
      now: 1_000_000,
      staleAfterSec: 300,
    });
    expect(result.success).toBe(false);
    const row = db.prepare('SELECT success, error_msg FROM poll_log').get();
    expect(row.success).toBe(0);
    expect(row.error_msg).toMatch(/boom/);
  });
});
