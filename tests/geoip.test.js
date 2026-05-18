import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGeoIp, lookupCountry } from '../src/poller/geoip.js';

describe('geoip', () => {
  it('looks up country by IPv4', () => {
    const fixture = join(tmpdir(), `geo-${Date.now()}.csv`);
    writeFileSync(
      fixture,
      '8.8.8.0,8.8.8.255,US\n' + '1.1.1.0,1.1.1.255,AU\n' + '192.0.2.0,192.0.2.255,XX\n',
    );
    const idx = loadGeoIp(fixture);
    expect(lookupCountry(idx, '8.8.8.8')).toBe('US');
    expect(lookupCountry(idx, '1.1.1.42')).toBe('AU');
    expect(lookupCountry(idx, '203.0.113.5')).toBeNull();
  });
});
