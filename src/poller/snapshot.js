import { lookupCountry } from './geoip.js';
import { lookupVendor } from './oui.js';
import { guessDeviceType } from './rules.js';

function normMac(mac) {
  return (mac ?? '').toLowerCase().trim();
}

function normHostname(h) {
  // pfRest 2.8 ARP returns '?' when no DNS/static name is known.
  if (h == null) return null;
  const t = String(h).trim();
  return t === '' || t === '?' ? null : t;
}

// pfRest 2.8 firewall states report endpoints as "ip:port" (IPv4) or "[ipv6]:port".
// Extract the bare IP so it can be matched against ARP/DHCP entries.
function ipFromEndpoint(s) {
  if (!s || typeof s !== 'string') return null;
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    return end > 0 ? s.slice(1, end) : null;
  }
  const lastColon = s.lastIndexOf(':');
  // No colon = bare IP; multiple colons = bare IPv6.
  if (lastColon === -1 || s.indexOf(':') !== lastColon) return s;
  return s.slice(0, lastColon);
}

function ipInSubnet(ip, cidr) {
  if (!ip || !cidr) return false;
  const [base, bits] = cidr.split('/');
  const mask = (0xffffffff << (32 - Number(bits))) >>> 0;
  const n = ip.split('.').reduce((a, p) => a * 256 + Number(p), 0) >>> 0;
  const b = base.split('.').reduce((a, p) => a * 256 + Number(p), 0) >>> 0;
  return (n & mask) === (b & mask);
}

// Unique key for a single firewall state record. Each pf state is a 5-tuple
// (proto, src ip:port, dst ip:port, direction) — concat them as the map key.
function stateKey(st) {
  return [
    st.protocol ?? st.proto ?? '',
    st.source ?? st.src ?? '',
    st.destination ?? st.dst ?? '',
    st.direction ?? '',
  ].join('|');
}

export function buildSnapshot({
  arp,
  dhcpLeases,
  ndp,
  firewallStates,
  interfaces,
  ouiMap,
  geoRanges,
  // Per-state byte totals from the previous poll. Required for accurate per-flow
  // delta accounting: summing bytes across active states is not a monotone
  // cumulative counter (it drops when states expire), so a device-level delta
  // computed from those sums would clamp to 0 on the next poll and silently
  // lose every byte that the disappearing state transferred since it was last
  // observed. Tracking per-state lets us sum positive deltas across states.
  prevStateBytes,
}) {
  const devices = {};
  function ensure(mac) {
    const key = normMac(mac);
    if (!devices[key]) {
      devices[key] = {
        mac: key,
        vendor: lookupVendor(ouiMap, key),
        hostname: null,
        ip: null,
        ipv6: null,
        interface: null,
        lease_type: null,
        lease_expires_at: null,
        states_count: 0,
        rx_bytes_total: 0,
        tx_bytes_total: 0,
        rx_bytes_delta: 0,
        tx_bytes_delta: 0,
        countries: {},
      };
    }
    return devices[key];
  }

  for (const row of arp ?? []) {
    // pfRest 2.8 uses mac_address/ip_address; older variants used mac/ip.
    const mac = row.mac_address ?? row.mac;
    if (!mac) continue;
    const d = ensure(mac);
    d.ip = row.ip_address ?? row.ip ?? d.ip;
    d.hostname = normHostname(row.hostname) ?? d.hostname;
    d.interface = row.interface ?? d.interface;
  }
  for (const row of dhcpLeases ?? []) {
    if (!row.mac) continue;
    const d = ensure(row.mac);
    d.hostname = row.hostname ?? d.hostname;
    d.ip = row.ip ?? d.ip;
    d.lease_type = row.type ?? d.lease_type;
    d.lease_expires_at = row.expires ?? d.lease_expires_at;
  }
  for (const row of ndp ?? []) {
    if (!row.mac) continue;
    const d = ensure(row.mac);
    d.ipv6 = row.ip ?? d.ipv6;
  }

  const ifByIp = (ip) =>
    (interfaces ?? []).find((i) => ipInSubnet(ip, i.ipv4_subnet))?.pfsense_name ?? null;

  for (const d of Object.values(devices)) {
    if (!d.interface && d.ip) d.interface = ifByIp(d.ip);
    d.device_type_guess = guessDeviceType({ vendor: d.vendor, hostname: d.hostname });
  }

  // pfRest 2.8: state.source/destination are "ip:port" strings.
  // Older variants exposed bare IPs on state.src / state.dst.
  // Index both v4 and v6 addresses — most devices on a home network are
  // dual-stack, and without v6 in the map all v6 firewall states get silently
  // unattributed (states_count and bytes_delta drop a non-trivial share of
  // device traffic, especially DNS/QUIC).
  const devByIp = new Map();
  for (const d of Object.values(devices)) {
    if (d.ip) devByIp.set(d.ip, d);
    if (d.ipv6) devByIp.set(d.ipv6, d);
  }
  const nextStateBytes = new Map();
  for (const st of firewallStates ?? []) {
    const srcIp = ipFromEndpoint(st.source) ?? st.src ?? null;
    const dstIp = ipFromEndpoint(st.destination) ?? st.dst ?? null;
    // bytes_in is forward-flow (source -> destination); bytes_out is the
    // reverse. The matched device is the state's source, so bytes_in is what
    // the device transmitted (tx) and bytes_out is what it received (rx).
    const txTotal = Number(st.bytes_in ?? 0);
    const rxTotal = Number(st.bytes_out ?? 0);
    // Track per-state totals for next poll's delta computation, regardless of
    // whether we can attribute the state to a known device.
    const key = stateKey(st);
    if (key !== '|||') nextStateBytes.set(key, { rx: rxTotal, tx: txTotal });

    const dev = srcIp ? devByIp.get(srcIp) : null;
    if (!dev) continue;
    dev.states_count += 1;
    dev.tx_bytes_total += txTotal;
    dev.rx_bytes_total += rxTotal;

    const prev = prevStateBytes?.get(key);
    // New state on first observation contributes 0 to the delta — its bytes_in
    // could be substantial if pfmon just started or the state was created
    // between polls, and we have no baseline to subtract. Conservative: attribute
    // 0 now, and capture this state's growth from the next poll onward.
    const txDelta = prev ? Math.max(0, txTotal - prev.tx) : 0;
    const rxDelta = prev ? Math.max(0, rxTotal - prev.rx) : 0;
    dev.tx_bytes_delta += txDelta;
    dev.rx_bytes_delta += rxDelta;

    const cc = lookupCountry(geoRanges ?? [], dstIp);
    if (cc) dev.countries[cc] = (dev.countries[cc] ?? 0) + 1;
  }

  return { devices, stateBytes: nextStateBytes };
}
