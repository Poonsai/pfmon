const MAC_RE = /^([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})$/i;

export function buildMagicPacket(mac) {
  const m = MAC_RE.exec(String(mac ?? '').trim());
  if (!m) throw new Error(`invalid mac: ${mac}`);
  const macBytes = Buffer.from(m.slice(1).map((h) => Number.parseInt(h, 16)));
  const packet = Buffer.alloc(102);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) macBytes.copy(packet, 6 + i * 6);
  return packet;
}
