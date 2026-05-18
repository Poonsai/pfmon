// pfRest 2.8 returns the interface config record with these key fields:
//   id     - pfSense canonical name: "wan", "lan", "opt1", "opt2", "vlan10"
//   if     - physical NIC: "igc0", "em0", "ovpns3"
//   descr  - friendly description configured in pfSense UI: "WAN", "IoT"
//   enable - whether the interface is up
//   ipaddr - "dhcp" or a static IPv4 address
//   subnet - numeric prefix length (e.g. 24)
// Older pfRest variants used `ipv4_address` + `ipv4_subnet` and didn't
// expose `id`; the code below handles both shapes.

function classifyKind(iface) {
  const id = (iface.id ?? '').toLowerCase();
  const name = (iface.if ?? iface.descr ?? '').toLowerCase();
  if (id === 'wan' || name === 'wan') return 'wan';
  if (id.startsWith('vlan') || /vlan/.test(name) || iface.tag) return 'vlan';
  if (id === 'lan' || name === 'lan') return 'lan';
  if (/^opt\d+$/.test(id)) return 'opt';
  return 'opt';
}

function computeNetwork(ip, prefixBits) {
  const bits = Number(prefixBits);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return null;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return null;
  const n = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const network = (n & mask) >>> 0;
  return [
    (network >>> 24) & 0xff,
    (network >>> 16) & 0xff,
    (network >>> 8) & 0xff,
    network & 0xff,
  ].join('.');
}

function subnet(iface) {
  // pfRest 2.8: ipaddr + subnet (numeric)
  const ip = iface.ipaddr;
  const prefix = iface.subnet;
  if (ip && ip !== 'dhcp' && prefix != null) {
    const net = computeNetwork(ip, prefix);
    if (net) return `${net}/${prefix}`;
  }
  // Older pfRest: ipv4_address + ipv4_subnet
  if (iface.ipv4_address && iface.ipv4_subnet) {
    const net = computeNetwork(iface.ipv4_address, iface.ipv4_subnet);
    if (net) return `${net}/${iface.ipv4_subnet}`;
  }
  return null;
}

export function normalizeInterfaces(payload, { wanOverride } = {}) {
  return (payload ?? [])
    .filter((i) => i.enable !== false) // skip disabled interfaces (e.g. disabled OpenVPN)
    .map((i) => {
      const canonicalName = i.id ?? i.if ?? i.name;
      return {
        pfsense_name: canonicalName,
        friendly_name: i.descr ?? canonicalName,
        kind: wanOverride && canonicalName === wanOverride ? 'wan' : classifyKind(i),
        vlan_tag: i.tag ? Number(i.tag) : null,
        ipv4_subnet: subnet(i),
        ipv6_prefix: i.ipv6_prefix ?? null,
      };
    })
    .filter((i) => i.pfsense_name);
}
