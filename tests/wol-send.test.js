import { createSocket } from 'node:dgram';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendMagicPacket } from '../src/wol.js';

describe('sendMagicPacket', () => {
  let listener, port;

  beforeEach(async () => {
    listener = createSocket('udp4');
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.bind(0, '127.0.0.1', () => {
        port = listener.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise((r) => listener.close(r));
  });

  it('sends a 102-byte packet to the configured host and port', async () => {
    const received = new Promise((resolve) => listener.once('message', (msg) => resolve(msg)));
    await sendMagicPacket({ mac: 'aa:bb:cc:dd:ee:ff', broadcastAddr: '127.0.0.1', port });
    const msg = await received;
    expect(msg.length).toBe(102);
    expect(msg[0]).toBe(0xff);
    expect(msg[6]).toBe(0xaa);
  });

  it('rejects when buildMagicPacket throws for an invalid MAC', async () => {
    await expect(
      sendMagicPacket({ mac: 'not-a-mac', broadcastAddr: '127.0.0.1', port }),
    ).rejects.toThrow(/invalid mac/i);
  });

  it('rejects when the broadcastAddr is bad', async () => {
    await expect(
      sendMagicPacket({
        mac: 'aa:bb:cc:dd:ee:ff',
        broadcastAddr: 'not.a.host.example.invalid',
        port,
      }),
    ).rejects.toThrow();
  });
});
