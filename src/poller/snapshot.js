import { lookupVendor } from './oui.js';
import { lookupCountry } from './geoip.js';
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

export function buildSnapshot({
  arp,
  dhcpLeases,
  ndp,
  firewallStates,
  interfaces,
  ouiMap,
  geoRanges,
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
  const devByIp = new Map();
  for (const d of Object.values(devices)) if (d.ip) devByIp.set(d.ip, d);
  for (const st of firewallStates ?? []) {
    const srcIp = ipFromEndpoint(st.source) ?? st.src ?? null;
    const dstIp = ipFromEndpoint(st.destination) ?? st.dst ?? null;
    const dev = srcIp ? devByIp.get(srcIp) : null;
    if (!dev) continue;
    dev.states_count += 1;
    // bytes_in is forward-flow (source -> destination); bytes_out is the
    // reverse. The matched device is the state's source, so bytes_in is what
    // the device transmitted (tx) and bytes_out is what it received (rx).
    dev.tx_bytes_total += Number(st.bytes_in ?? 0);
    dev.rx_bytes_total += Number(st.bytes_out ?? 0);
    const cc = lookupCountry(geoRanges ?? [], dstIp);
    if (cc) dev.countries[cc] = (dev.countries[cc] ?? 0) + 1;
  }

  return { devices };
}
