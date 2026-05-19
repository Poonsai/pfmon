import { describe, expect, it } from 'vitest';
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
    expect(guessDeviceType({ vendor: 'Amazon Technologies Inc.', hostname: 'echo-dot' })).toBe(
      'Echo',
    );
  });
  it('returns Unknown when no rule matches', () => {
    expect(guessDeviceType({ vendor: 'NoSuch Corp', hostname: 'random-host' })).toBe('Unknown');
  });
  it('handles missing hostname', () => {
    expect(guessDeviceType({ vendor: 'Espressif Inc.', hostname: null })).toBe('IoT (ESP)');
  });
  it('returns PlayStation for Sony Interactive Entertainment vendor', () => {
    expect(
      guessDeviceType({ vendor: 'Sony Interactive Entertainment Inc.', hostname: 'ps5-living' }),
    ).toBe('PlayStation');
  });
  it('returns Xbox for Microsoft vendor + xbox hostname', () => {
    expect(guessDeviceType({ vendor: 'Microsoft Corporation', hostname: 'xbox-series-x' })).toBe(
      'Xbox',
    );
  });
  it('returns Nintendo for Nintendo vendor', () => {
    expect(guessDeviceType({ vendor: 'Nintendo Co., Ltd.', hostname: 'switch' })).toBe('Nintendo');
  });
  it('returns Tesla for Tesla vendor', () => {
    expect(guessDeviceType({ vendor: 'Tesla Motors', hostname: 'model-y' })).toBe('Tesla');
  });
  it('returns Camera for Ring/Wyze/Reolink vendors', () => {
    expect(guessDeviceType({ vendor: 'Ring LLC', hostname: 'doorbell' })).toBe('Camera');
    expect(guessDeviceType({ vendor: 'Wyze Labs Inc.', hostname: 'wyzecam' })).toBe('Camera');
    expect(guessDeviceType({ vendor: 'Reolink', hostname: 'reolink-cam' })).toBe('Camera');
  });
  it('returns Nest for Nest/Google Nest vendor', () => {
    expect(guessDeviceType({ vendor: 'Nest Labs Inc.', hostname: 'thermostat' })).toBe('Nest');
  });
  it('returns Router/AP for common networking vendors', () => {
    expect(guessDeviceType({ vendor: 'TP-LINK TECHNOLOGIES CO.,LTD.', hostname: 'ap-1' })).toBe(
      'Router or AP',
    );
    expect(guessDeviceType({ vendor: 'NETGEAR', hostname: 'router' })).toBe('Router or AP');
    expect(guessDeviceType({ vendor: 'ASUSTek COMPUTER INC.', hostname: 'asus-rt' })).toBe(
      'Router or AP',
    );
  });
  it('returns Laptop/PC for common PC vendors when no other rule matched', () => {
    expect(guessDeviceType({ vendor: 'Dell Inc.', hostname: 'dell-xps' })).toBe('Laptop or PC');
    expect(guessDeviceType({ vendor: 'LENOVO', hostname: 'thinkpad' })).toBe('Laptop or PC');
    expect(guessDeviceType({ vendor: 'Intel Corporate', hostname: 'desktop' })).toBe(
      'Laptop or PC',
    );
  });
  it('still returns Unknown when no rule matches', () => {
    expect(guessDeviceType({ vendor: 'Acme Widgets', hostname: 'widget-42' })).toBe('Unknown');
  });
});
