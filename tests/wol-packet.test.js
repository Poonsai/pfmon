import { describe, expect, it } from 'vitest';
import { buildMagicPacket } from '../src/wol.js';

describe('buildMagicPacket', () => {
  it('produces a 102-byte buffer', () => {
    const pkt = buildMagicPacket('aa:bb:cc:dd:ee:ff');
    expect(pkt.length).toBe(102);
  });

  it('starts with six 0xFF bytes', () => {
    const pkt = buildMagicPacket('aa:bb:cc:dd:ee:ff');
    for (let i = 0; i < 6; i++) expect(pkt[i]).toBe(0xff);
  });

  it('contains 16 repetitions of the MAC bytes after the header', () => {
    const pkt = buildMagicPacket('01:02:03:04:05:06');
    const macBytes = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06];
    for (let rep = 0; rep < 16; rep++) {
      for (let i = 0; i < 6; i++) {
        expect(pkt[6 + rep * 6 + i]).toBe(macBytes[i]);
      }
    }
  });

  it('accepts dash-separated MACs (Windows style)', () => {
    const pkt = buildMagicPacket('AA-BB-CC-DD-EE-FF');
    expect(pkt.length).toBe(102);
    expect(pkt[6]).toBe(0xaa);
  });

  it('accepts uppercase and mixed case', () => {
    const pkt = buildMagicPacket('Aa:Bb:Cc:dD:eE:fF');
    expect(pkt[6]).toBe(0xaa);
    expect(pkt[11]).toBe(0xff);
  });

  it('throws on an empty MAC', () => {
    expect(() => buildMagicPacket('')).toThrow(/invalid mac/i);
  });

  it('throws on a MAC with the wrong number of bytes', () => {
    expect(() => buildMagicPacket('aa:bb:cc:dd:ee')).toThrow(/invalid mac/i);
    expect(() => buildMagicPacket('aa:bb:cc:dd:ee:ff:00')).toThrow(/invalid mac/i);
  });

  it('throws on non-hex characters', () => {
    expect(() => buildMagicPacket('aa:bb:cc:dd:ee:zz')).toThrow(/invalid mac/i);
  });
});
