export function loadConfig() {
  const required = (name) => {
    const v = process.env[name];
    if (!v) {
      console.error(`missing env: ${name}`);
      process.exit(2);
    }
    return v;
  };
  // Number('') is 0 and Number('abc') is NaN — both produce dangerous values
  // downstream (e.g. a NaN pollIntervalSec makes the scheduler tick continuously
  // without delay). Validate positive integer here so misconfiguration fails fast.
  const positiveInt = (name, fallback) => {
    const raw = process.env[name];
    if (raw == null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      console.error(`invalid env: ${name}=${raw} (expected positive integer)`);
      process.exit(2);
    }
    return n;
  };
  // Unlike positiveInt, this accepts 0 (the digest hour 00:00 is valid) and
  // caps at 23. Empty / unset → null (digest disabled).
  const hourInRange = (name) => {
    const raw = process.env[name];
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 23) {
      console.error(`invalid env: ${name}=${raw} (expected integer 0..23)`);
      process.exit(2);
    }
    return n;
  };
  return {
    pfsenseUrl: required('PFSENSE_URL'),
    pfsenseApiKey: required('PFSENSE_API_KEY'),
    pfsenseVerifyTls: (process.env.PFSENSE_VERIFY_TLS ?? 'true') !== 'false',
    pollIntervalSec: positiveInt('POLL_INTERVAL_SECONDS', 30),
    ntfyTopicUrl: process.env.NTFY_TOPIC_URL ?? '',
    newDeviceGraceMinutes: positiveInt('NEW_DEVICE_GRACE_MINUTES', 5),
    dbPath: process.env.DB_PATH ?? '/data/pfmon.db',
    port: positiveInt('PORT', 8080),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    wanInterfaceName: process.env.WAN_INTERFACE_NAME || null,
    ouiPath: process.env.OUI_PATH ?? new URL('../data/oui.csv', import.meta.url).pathname,
    geoIpPath:
      process.env.GEOIP_PATH ?? new URL('../data/dbip-country-lite.csv', import.meta.url).pathname,
    wolBroadcastAddr: process.env.WOL_BROADCAST_ADDR ?? '255.255.255.255',
    wolPort: positiveInt('WOL_PORT', 9),
    digestHour: hourInRange('DIGEST_HOUR'),
  };
}
