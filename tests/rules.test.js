import { describe, it, expect } from 'vitest';
import { guessDeviceType } from '../src/poller/rules.js';

describe('rules.guessDeviceType', () => {
  it('returns iPhone for Apple vendor + iphone hostname', () => {
    expect(guessDeviceType({ vendor: 'Apple Inc.', hostname: 'iphone-jane' })).toBe('iPhone');
  });
  it('returns Mac for Apple + macbook hostname', () => {
    expect(guessDeviceType({ vendor: 'Apple Inc.', hostname: 'macbook-air' })).toBe('Mac');
  });
  it('returns IoT (ESP) for Espressif vendor', () => {
    expect(guessDeviceType({ vendor: 'Espressif Inc.', hostname: 'esp-xxxx' })).toBe('IoT (ESP)');
  });
  it('returns Echo for Amazon + echo hostname', () => {
    expect(guessDeviceType({ vendor: 'Amazon Technologies Inc.', hostname: 'echo-dot' })).toBe('Echo');
  });
  it('returns Unknown when no rule matches', () => {
    expect(guessDeviceType({ vendor: 'NoSuch Corp', hostname: 'random-host' })).toBe('Unknown');
  });
  it('handles missing hostname', () => {
    expect(guessDeviceType({ vendor: 'Espressif Inc.', hostname: null })).toBe('IoT (ESP)');
  });
});
