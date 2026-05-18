import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadOui, lookupVendor } from '../src/poller/oui.js';

describe('oui', () => {
  it('looks up vendor by MAC prefix', () => {
    const fixture = join(tmpdir(), `oui-${Date.now()}.csv`);
    writeFileSync(
      fixture,
      'Registry,Assignment,Organization Name,Organization Address\n' +
        'MA-L,001CB3,Apple Inc.,1 Infinite Loop\n' +
        'MA-L,28EF01,Espressif Inc.,addr\n',
    );
    const map = loadOui(fixture);
    expect(lookupVendor(map, '00:1c:b3:aa:bb:cc')).toBe('Apple Inc.');
    expect(lookupVendor(map, '28-EF-01-11-22-33')).toBe('Espressif Inc.');
    expect(lookupVendor(map, '11:22:33:44:55:66')).toBeNull();
  });

  it('returns an empty map when the OUI file is missing, instead of crashing', () => {
    // Regression: loadOui used to throw an unhandled ENOENT and kill the
    // process when local-dev users hadn't run `npm run fetch-data`. Vendor
    // lookup is non-essential, so missing-file degrades gracefully.
    const missing = join(tmpdir(), `oui-does-not-exist-${Date.now()}.csv`);
    const map = loadOui(missing);
    expect(map.size).toBe(0);
    expect(lookupVendor(map, '00:1c:b3:aa:bb:cc')).toBeNull();
  });
});
