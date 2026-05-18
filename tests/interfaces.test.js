import { describe, expect, it } from 'vitest';
import { normalizeInterfaces } from '../src/poller/interfaces.js';

describe('normalizeInterfaces (pfRest 2.8 shape)', () => {
  const payload = [
    { id: 'wan', if: 'igc0', enable: true, descr: 'WAN', ipaddr: 'dhcp', subnet: null },
    { id: 'lan', if: 'igc1', enable: true, descr: 'LAN', ipaddr: '10.35.35.1', subnet: 24 },
    { id: 'opt1', if: 'em0', enable: true, descr: 'OPT1', ipaddr: '10.36.36.1', subnet: 24 },
    { id: 'opt2', if: 'ovpns3', enable: false, descr: 'OPT2', ipaddr: null, subnet: null },
    {
      id: 'vlan10',
      if: 'igc1.10',
      enable: true,
      descr: 'IoT',
      tag: '10',
      ipaddr: '10.20.0.1',
      subnet: 24,
    },
  ];

  it('uses pfRest 2.8 `id` field as the canonical name', () => {
    const out = normalizeInterfaces(payload);
    const names = out.map((i) => i.pfsense_name);
    expect(names).toContain('wan');
    expect(names).toContain('lan');
    expect(names).toContain('opt1');
    expect(names).toContain('vlan10');
  });

  it('classifies WAN by id even when `if` is a NIC name', () => {
    const out = normalizeInterfaces(payload);
    const wan = out.find((i) => i.pfsense_name === 'wan');
    expect(wan.kind).toBe('wan');
  });

  it('classifies LAN by id', () => {
    const out = normalizeInterfaces(payload);
    const lan = out.find((i) => i.pfsense_name === 'lan');
    expect(lan.kind).toBe('lan');
  });

  it('classifies opt1 as opt', () => {
    const out = normalizeInterfaces(payload);
    const opt = out.find((i) => i.pfsense_name === 'opt1');
    expect(opt.kind).toBe('opt');
  });

  it('classifies vlan10 as vlan', () => {
    const out = normalizeInterfaces(payload);
    const vlan = out.find((i) => i.pfsense_name === 'vlan10');
    expect(vlan.kind).toBe('vlan');
    expect(vlan.vlan_tag).toBe(10);
  });

  it('skips disabled interfaces', () => {
    const out = normalizeInterfaces(payload);
    expect(out.find((i) => i.pfsense_name === 'opt2')).toBeUndefined();
  });

  it('computes the network address from ipaddr+subnet, not just zeroing last octet', () => {
    const out = normalizeInterfaces(payload);
    expect(out.find((i) => i.pfsense_name === 'lan').ipv4_subnet).toBe('10.35.35.0/24');
    expect(out.find((i) => i.pfsense_name === 'opt1').ipv4_subnet).toBe('10.36.36.0/24');
  });

  it('does not store a subnet for DHCP-typed WAN', () => {
    const out = normalizeInterfaces(payload);
    expect(out.find((i) => i.pfsense_name === 'wan').ipv4_subnet).toBeNull();
  });

  it('respects WAN_INTERFACE_NAME override', () => {
    const out = normalizeInterfaces(payload, { wanOverride: 'opt1' });
    expect(out.find((i) => i.pfsense_name === 'opt1').kind).toBe('wan');
  });

  it('handles the older pfRest shape (no id; ipv4_address+ipv4_subnet) for backward compat', () => {
    const older = [
      { if: 'wan', descr: 'WAN' },
      { if: 'lan', descr: 'LAN', ipv4_address: '10.0.0.1', ipv4_subnet: '24' },
    ];
    const out = normalizeInterfaces(older);
    expect(out.find((i) => i.pfsense_name === 'wan').kind).toBe('wan');
    const lan = out.find((i) => i.pfsense_name === 'lan');
    expect(lan.kind).toBe('lan');
    expect(lan.ipv4_subnet).toBe('10.0.0.0/24');
  });

  it('computes non-/24 network addresses correctly', () => {
    const out = normalizeInterfaces([
      { id: 'lan', enable: true, descr: 'LAN', ipaddr: '10.10.13.5', subnet: 22 },
    ]);
    expect(out[0].ipv4_subnet).toBe('10.10.12.0/22');
  });
});
