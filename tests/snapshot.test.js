import { describe, it, expect } from 'vitest';
import { buildSnapshot } from '../src/poller/snapshot.js';

const FAKE_OUI = new Map([['AABBCC', 'TestCorp']]);

function ipToNum(ip) {
  return ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
}

describe('buildSnapshot', () => {
  it('merges ARP + leases + NDP into one row per MAC', () => {
    const snap = buildSnapshot({
      arp: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.42', hostname: 'tv', interface: 'lan' }],
      dhcpLeases: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.42', hostname: 'tv', type: 'dynamic', expires: 1700000000 }],
      ndp: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: 'fe80::1' }],
      firewallStates: [
        { src: '10.0.0.42', dst: '8.8.8.8', bytes_in: 100, bytes_out: 200 },
        { src: '10.0.0.42', dst: '1.1.1.1', bytes_in: 50, bytes_out: 50 },
      ],
      interfaces: [{ pfsense_name: 'lan', ipv4_subnet: '10.0.0.0/24' }],
      ouiMap: FAKE_OUI,
      geoRanges: [[ipToNum('8.8.8.0'), ipToNum('8.8.8.255'), 'US']],
    });
    const d = snap.devices['aa:bb:cc:dd:ee:ff'];
    expect(d.ip).toBe('10.0.0.42');
    expect(d.ipv6).toBe('fe80::1');
    expect(d.vendor).toBe('TestCorp');
    expect(d.interface).toBe('lan');
    expect(d.lease_type).toBe('dynamic');
    expect(d.states_count).toBe(2);
    expect(d.rx_bytes_total).toBe(150);
    expect(d.tx_bytes_total).toBe(250);
    expect(d.countries).toEqual({ US: 1 });
  });

  it('handles a device known only via ARP', () => {
    const snap = buildSnapshot({
      arp: [{ mac: 'AA:BB:CC:11:22:33', ip: '10.0.0.5', hostname: null, interface: 'lan' }],
      dhcpLeases: [], ndp: [], firewallStates: [],
      interfaces: [{ pfsense_name: 'lan', ipv4_subnet: '10.0.0.0/24' }],
      ouiMap: FAKE_OUI, geoRanges: [],
    });
    expect(snap.devices['aa:bb:cc:11:22:33'].vendor).toBe('TestCorp');
    expect(snap.devices['aa:bb:cc:11:22:33'].lease_type).toBeNull();
  });
});
