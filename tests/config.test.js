import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

// Helper: snapshot and restore env around each case so individual tests can
// scribble on process.env without polluting siblings.
function withEnv(overrides, fn) {
  const backup = {};
  for (const key of Object.keys(overrides)) {
    backup[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(backup)) {
      if (backup[key] === undefined) delete process.env[key];
      else process.env[key] = backup[key];
    }
  }
}

describe('loadConfig', () => {
  let exitSpy;
  let errSpy;
  beforeEach(() => {
    // process.exit is fatal in tests; stub it. Throw so the calling code halts
    // immediately and we can assert on the call.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('returns parsed values when required env is set and numbers default', () => {
    const cfg = withEnv(
      {
        PFSENSE_URL: 'https://pfsense.lan',
        PFSENSE_API_KEY: 'key',
        POLL_INTERVAL_SECONDS: undefined,
        PORT: undefined,
        NEW_DEVICE_GRACE_MINUTES: undefined,
      },
      () => loadConfig(),
    );
    expect(cfg.pfsenseUrl).toBe('https://pfsense.lan');
    expect(cfg.pfsenseApiKey).toBe('key');
    expect(cfg.pollIntervalSec).toBe(30);
    expect(cfg.port).toBe(8080);
    expect(cfg.newDeviceGraceMinutes).toBe(5);
  });

  it('exits 2 when a required env var is missing', () => {
    expect(() =>
      withEnv({ PFSENSE_URL: undefined, PFSENSE_API_KEY: 'key' }, () => loadConfig()),
    ).toThrow('process.exit(2)');
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/missing env: PFSENSE_URL/));
  });

  it('rejects a non-numeric POLL_INTERVAL_SECONDS instead of accepting NaN', () => {
    // Regression: Number('abc') is NaN, which made `Date.now() < NaN` always
    // false and the scheduler tick continuously without any delay.
    expect(() =>
      withEnv(
        {
          PFSENSE_URL: 'https://pfsense.lan',
          PFSENSE_API_KEY: 'key',
          POLL_INTERVAL_SECONDS: 'abc',
        },
        () => loadConfig(),
      ),
    ).toThrow('process.exit(2)');
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/invalid env: POLL_INTERVAL_SECONDS/),
    );
  });

  it('rejects zero or negative integer env values', () => {
    expect(() =>
      withEnv(
        {
          PFSENSE_URL: 'https://pfsense.lan',
          PFSENSE_API_KEY: 'key',
          PORT: '0',
        },
        () => loadConfig(),
      ),
    ).toThrow('process.exit(2)');
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/invalid env: PORT/));
  });

  it('falls back to the default when an integer env var is empty string', () => {
    // Empty string used to be coerced to 0 by Number(''), which then tripped
    // the positive-integer check. Treat empty as unset → use the default.
    const cfg = withEnv(
      {
        PFSENSE_URL: 'https://pfsense.lan',
        PFSENSE_API_KEY: 'key',
        POLL_INTERVAL_SECONDS: '',
      },
      () => loadConfig(),
    );
    expect(cfg.pollIntervalSec).toBe(30);
  });

  it('treats PFSENSE_VERIFY_TLS=false as disabling TLS verification', () => {
    const cfg = withEnv(
      {
        PFSENSE_URL: 'https://pfsense.lan',
        PFSENSE_API_KEY: 'key',
        PFSENSE_VERIFY_TLS: 'false',
      },
      () => loadConfig(),
    );
    expect(cfg.pfsenseVerifyTls).toBe(false);
  });

  it('treats PFSENSE_VERIFY_TLS missing or "true" as enabling TLS verification', () => {
    expect(
      withEnv(
        {
          PFSENSE_URL: 'https://pfsense.lan',
          PFSENSE_API_KEY: 'key',
          PFSENSE_VERIFY_TLS: undefined,
        },
        () => loadConfig(),
      ).pfsenseVerifyTls,
    ).toBe(true);
    expect(
      withEnv(
        {
          PFSENSE_URL: 'https://pfsense.lan',
          PFSENSE_API_KEY: 'key',
          PFSENSE_VERIFY_TLS: 'true',
        },
        () => loadConfig(),
      ).pfsenseVerifyTls,
    ).toBe(true);
  });
});
