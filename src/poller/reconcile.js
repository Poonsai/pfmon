export function syncInterfaces(db, interfaces) {
  const upsert = db.prepare(`
    INSERT INTO interfaces (pfsense_name, friendly_name, kind, vlan_tag, ipv4_subnet, ipv6_prefix)
    VALUES (@pfsense_name, @friendly_name, @kind, @vlan_tag, @ipv4_subnet, @ipv6_prefix)
    ON CONFLICT(pfsense_name) DO UPDATE SET
      friendly_name = excluded.friendly_name,
      kind = excluded.kind,
      vlan_tag = excluded.vlan_tag,
      ipv4_subnet = excluded.ipv4_subnet,
      ipv6_prefix = excluded.ipv6_prefix
  `);
  const tx = db.transaction((rows) => { for (const r of rows) upsert.run(r); });
  tx(interfaces);
}
