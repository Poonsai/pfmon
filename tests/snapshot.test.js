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
      dhcpLeases: [
        {
          mac: 'aa:bb:cc:dd:ee:ff',
          ip: '10.0.0.42',
          hostname: 'tv',
          type: 'dynamic',
          expires: 1700000000,
        },
      ],
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
    // bytes_in is the forward-flow direction (source -> destination). The device
    // is the source here, so bytes_in is what the device SENT (tx) and bytes_out
    // is what it RECEIVED (rx).
    expect(d.tx_bytes_total).toBe(150);
    expect(d.rx_bytes_total).toBe(250);
    expect(d.countries).toEqual({ US: 1 });
  });

  it('handles a device known only via ARP', () => {
    const snap = buildSnapshot({
      arp: [{ mac: 'AA:BB:CC:11:22:33', ip: '10.0.0.5', hostname: null, interface: 'lan' }],
      dhcpLeases: [],
      ndp: [],
      firewallStates: [],
      interfaces: [{ pfsense_name: 'lan', ipv4_subnet: '10.0.0.0/24' }],
      ouiMap: FAKE_OUI,
      geoRanges: [],
    });
    expect(snap.devices['aa:bb:cc:11:22:33'].vendor).toBe('TestCorp');
    expect(snap.devices['aa:bb:cc:11:22:33'].lease_type).toBeNull();
  });

  it('attributes bytes from pfRest 2.8 firewall states (source/destination + ip:port)', () => {
    const snap = buildSnapshot({
      arp: [],
      dhcpLeases: [
        {
          mac: 'aa:bb:cc:dd:ee:ff',
          ip: '10.0.0.42',
          hostname: 'tv',
          active_status: 'static',
          ends: '',
        },
      ],
      ndp: [],
      firewallStates: [
        // pfRest 2.8 shape: source/destination carry "ip:port" and bytes_in/bytes_out.
        { source: '10.0.0.42:55555', destination: '8.8.8.8:443', bytes_in: 100, bytes_out: 200 },
        { source: '10.0.0.42:55556', destination: '1.1.1.1:443', bytes_in: 50, bytes_out: 50 },
        // A NAT'd duplicate where source is the WAN-side public IP - should NOT match any device.
        {
          source: '203.0.113.5:33333',
          destination: '8.8.8.8:443',
          bytes_in: 9999,
          bytes_out: 9999,
        },
      ],
      interfaces: [{ pfsense_name: 'lan', ipv4_subnet: '10.0.0.0/24' }],
      ouiMap: FAKE_OUI,
      geoRanges: [[ipToNum('8.8.8.0'), ipToNum('8.8.8.255'), 'US']],
    });
    const d = snap.devices['aa:bb:cc:dd:ee:ff'];
    expect(d.states_count).toBe(2);
    expect(d.tx_bytes_total).toBe(150);
    expect(d.rx_bytes_total).toBe(250);
    expect(d.countries).toEqual({ US: 1 });
  });

  it('treats a one-way UDP broadcast (bytes_in only) as device upload', () => {
    // UDP broadcast traffic from a LAN device: bytes flow source -> destination
    // (the device -> broadcast address) with no reply, so bytes_in is large and
    // bytes_out is 0. The device's TX must reflect that, not RX. Regression
    // proof against accidentally swapping the rx/tx mapping back.
    const snap = buildSnapshot({
      arp: [{ mac: 'aa:bb:cc:dd:ee:fe', ip: '10.35.35.15', interface: 'lan' }],
      dhcpLeases: [],
      ndp: [],
      firewallStates: [
        {
          interface: 'em0',
          protocol: 'udp',
          direction: 'in',
          source: '10.35.35.15:49153',
          destination: '255.255.255.255:6667',
          bytes_in: 88_988_800,
          bytes_out: 0,
        },
      ],
      interfaces: [{ pfsense_name: 'lan', ipv4_subnet: '10.35.35.0/24' }],
      ouiMap: FAKE_OUI,
      geoRanges: [],
    });
    const d = snap.devices['aa:bb:cc:dd:ee:fe'];
    expect(d.tx_bytes_total).toBe(88_988_800);
    expect(d.rx_bytes_total).toBe(0);
  });

  it('reads ARP rows in pfRest 2.8 shape (mac_address/ip_address)', () => {
    const snap = buildSnapshot({
      arp: [
        {
          mac_address: 'aa:bb:cc:11:22:33',
          ip_address: '10.0.0.5',
          hostname: '?',
          interface: 'LAN',
        },
      ],
      dhcpLeases: [],
      ndp: [],
      firewallStates: [],
      interfaces: [{ pfsense_name: 'lan', ipv4_subnet: '10.0.0.0/24' }],
      ouiMap: FAKE_OUI,
      geoRanges: [],
    });
    expect(snap.devices['aa:bb:cc:11:22:33']).toBeDefined();
    expect(snap.devices['aa:bb:cc:11:22:33'].ip).toBe('10.0.0.5');
  });
});
