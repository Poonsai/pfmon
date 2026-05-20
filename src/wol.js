import { createSocket } from 'node:dgram';

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

export function sendMagicPacket({ mac, broadcastAddr, port }) {
  return new Promise((resolve, reject) => {
    let packet;
    try {
      packet = buildMagicPacket(mac);
    } catch (e) {
      reject(e);
      return;
    }
    const socket = createSocket('udp4');
    socket.once('error', (err) => {
      try {
        socket.close();
      } catch (_e) {}
      reject(err);
    });
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
      } catch (e) {
        socket.close();
        reject(e);
        return;
      }
      socket.send(packet, port, broadcastAddr, (err) => {
        socket.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
