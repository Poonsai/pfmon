function classifyKind(iface) {
  const name = (iface.if ?? iface.descr ?? '').toLowerCase();
  if (name === 'wan' || /wan/.test(name)) return 'wan';
  if (/vlan/.test(name) || iface.tag) return 'vlan';
  if (name === 'lan') return 'lan';
  return 'opt';
}

function subnet(iface) {
  if (iface.ipv4_address && iface.ipv4_subnet) {
    return `${iface.ipv4_address.replace(/\.\d+$/, '.0')}/${iface.ipv4_subnet}`;
  }
  return null;
}

export function normalizeInterfaces(payload, { wanOverride } = {}) {
  return (payload ?? []).map(i => ({
    pfsense_name: i.if ?? i.name,
    friendly_name: i.descr ?? i.if ?? i.name,
    kind: wanOverride && (i.if === wanOverride) ? 'wan' : classifyKind(i),
    vlan_tag: i.tag ? Number(i.tag) : null,
    ipv4_subnet: subnet(i),
    ipv6_prefix: i.ipv6_prefix ?? null,
  })).filter(i => i.pfsense_name);
}
