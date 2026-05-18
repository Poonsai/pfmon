import { describe, expect, it } from 'vitest';
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

  describe('per-state delta accounting', () => {
    const arp = [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.42', interface: 'lan' }];
    const interfaces = [{ pfsense_name: 'lan', ipv4_subnet: '10.0.0.0/24' }];

    function snapshot(firewallStates, prevStateBytes) {
      return buildSnapshot({
        arp,
        dhcpLeases: [],
        ndp: [],
        firewallStates,
        interfaces,
        ouiMap: FAKE_OUI,
        geoRanges: [],
        prevStateBytes,
      });
    }

    it('first observation of a state contributes 0 to the device delta', () => {
      const snap = snapshot([
        {
          protocol: 'tcp',
          source: '10.0.0.42:55555',
          destination: '8.8.8.8:443',
          direction: 'out',
          bytes_in: 1000,
          bytes_out: 5000,
        },
      ]);
      const d = snap.devices['aa:bb:cc:dd:ee:ff'];
      expect(d.tx_bytes_delta).toBe(0);
      expect(d.rx_bytes_delta).toBe(0);
      expect(snap.stateBytes.size).toBe(1);
    });

    it('subsequent observation contributes the per-state growth', () => {
      const first = snapshot([
        {
          protocol: 'tcp',
          source: '10.0.0.42:55555',
          destination: '8.8.8.8:443',
          direction: 'out',
          bytes_in: 1000,
          bytes_out: 5000,
        },
      ]);
      const second = snapshot(
        [
          {
            protocol: 'tcp',
            source: '10.0.0.42:55555',
            destination: '8.8.8.8:443',
            direction: 'out',
            bytes_in: 1500,
            bytes_out: 9000,
          },
        ],
        first.stateBytes,
      );
      const d = second.devices['aa:bb:cc:dd:ee:ff'];
      // tx delta: 1500 - 1000 = 500, rx delta: 9000 - 5000 = 4000.
      expect(d.tx_bytes_delta).toBe(500);
      expect(d.rx_bytes_delta).toBe(4000);
    });

    it('does NOT lose growth when a sibling state disappears between polls', () => {
      // Regression: the previous device-level cumulative-sum approach computed
      // delta = max(0, current_total - prev_total). When one of several states
      // expired, current_total dropped below prev_total and the surviving
      // state's actual growth was clamped to 0.
      const first = snapshot([
        {
          protocol: 'tcp',
          source: '10.0.0.42:11111',
          destination: '1.1.1.1:443',
          direction: 'out',
          bytes_in: 200,
          bytes_out: 1000,
        },
        {
          protocol: 'tcp',
          source: '10.0.0.42:22222',
          destination: '8.8.8.8:443',
          direction: 'out',
          bytes_in: 500,
          bytes_out: 2000,
        },
      ]);
      // State 1 (1.1.1.1) expired; state 2 (8.8.8.8) grew by 50 tx / 100 rx.
      const second = snapshot(
        [
          {
            protocol: 'tcp',
            source: '10.0.0.42:22222',
            destination: '8.8.8.8:443',
            direction: 'out',
            bytes_in: 550,
            bytes_out: 2100,
          },
        ],
        first.stateBytes,
      );
      const d = second.devices['aa:bb:cc:dd:ee:ff'];
      expect(d.tx_bytes_delta).toBe(50);
      expect(d.rx_bytes_delta).toBe(100);
    });

    it('attributes IPv6 firewall-state traffic to the device that owns the v6 address', () => {
      // Regression: devByIp used to only index v4 addresses, so any firewall
      // state whose source endpoint was a bracketed v6 address (the common
      // pfRest 2.8 shape) failed to find a device and dropped its bytes.
      const snap = buildSnapshot({
        arp: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.42', interface: 'lan' }],
        dhcpLeases: [],
        ndp: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: 'fe80::42' }],
        firewallStates: [
          {
            protocol: 'tcp',
            source: '[fe80::42]:55555',
            destination: '[2606:4700:4700::1111]:443',
            direction: 'out',
            bytes_in: 1000,
            bytes_out: 5000,
          },
        ],
        interfaces: [{ pfsense_name: 'lan', ipv4_subnet: '10.0.0.0/24' }],
        ouiMap: FAKE_OUI,
        geoRanges: [],
      });
      const d = snap.devices['aa:bb:cc:dd:ee:ff'];
      expect(d.states_count).toBe(1);
      expect(d.tx_bytes_total).toBe(1000);
      expect(d.rx_bytes_total).toBe(5000);
    });

    it('clamps negative deltas to 0 (state counters reset between polls)', () => {
      // pfSense states don't reset, but if pfRest ever returns a smaller value
      // (e.g. a renumbered state, or a counter wrap on long-lived states),
      // the delta must not go negative.
      const first = snapshot([
        {
          protocol: 'tcp',
          source: '10.0.0.42:33333',
          destination: '8.8.8.8:443',
          direction: 'out',
          bytes_in: 10_000,
          bytes_out: 50_000,
        },
      ]);
      const second = snapshot(
        [
          {
            protocol: 'tcp',
            source: '10.0.0.42:33333',
            destination: '8.8.8.8:443',
            direction: 'out',
            bytes_in: 100,
            bytes_out: 500,
          },
        ],
        first.stateBytes,
      );
      const d = second.devices['aa:bb:cc:dd:ee:ff'];
      expect(d.tx_bytes_delta).toBe(0);
      expect(d.rx_bytes_delta).toBe(0);
    });
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
