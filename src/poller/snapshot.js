import { lookupVendor } from './oui.js';
import { lookupCountry } from './geoip.js';
import { guessDeviceType } from './rules.js';

function normMac(mac) {
  return (mac ?? '').toLowerCase().trim();
}

function ipInSubnet(ip, cidr) {
  if (!ip || !cidr) return false;
  const [base, bits] = cidr.split('/');
  const mask = (0xffffffff << (32 - Number(bits))) >>> 0;
  const n = (ip.split('.').reduce((a, p) => a * 256 + Number(p), 0)) >>> 0;
  const b = (base.split('.').reduce((a, p) => a * 256 + Number(p), 0)) >>> 0;
  return (n & mask) === (b & mask);
}

export function buildSnapshot({ arp, dhcpLeases, ndp, firewallStates, interfaces, ouiMap, geoRanges }) {
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
    if (!row.mac) continue;
    const d = ensure(row.mac);
    d.ip = row.ip ?? d.ip;
    d.hostname = row.hostname ?? d.hostname;
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

  const ifByIp = (ip) => (interfaces ?? []).find(i => ipInSubnet(ip, i.ipv4_subnet))?.pfsense_name ?? null;

  for (const d of Object.values(devices)) {
    if (!d.interface && d.ip) d.interface = ifByIp(d.ip);
    d.device_type_guess = guessDeviceType({ vendor: d.vendor, hostname: d.hostname });
  }

  for (const st of firewallStates ?? []) {
    const dev = Object.values(devices).find(d => d.ip === st.src);
    if (!dev) continue;
    dev.states_count += 1;
    dev.rx_bytes_total += Number(st.bytes_in ?? 0);
    dev.tx_bytes_total += Number(st.bytes_out ?? 0);
    const cc = lookupCountry(geoRanges ?? [], st.dst);
    if (cc) dev.countries[cc] = (dev.countries[cc] ?? 0) + 1;
  }

  return { devices };
}
