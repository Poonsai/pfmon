export function loadConfig() {
  const required = (name) => {
    const v = process.env[name];
    if (!v) { console.error(`missing env: ${name}`); process.exit(2); }
    return v;
  };
  return {
    pfsenseUrl: required('PFSENSE_URL'),
    pfsenseApiKey: required('PFSENSE_API_KEY'),
    pfsenseVerifyTls: (process.env.PFSENSE_VERIFY_TLS ?? 'true') !== 'false',
    pollIntervalSec: Number(process.env.POLL_INTERVAL_SECONDS ?? 30),
    ntfyTopicUrl: process.env.NTFY_TOPIC_URL ?? '',
    newDeviceGraceMinutes: Number(process.env.NEW_DEVICE_GRACE_MINUTES ?? 5),
    dbPath: process.env.DB_PATH ?? '/data/pfmon.db',
    port: Number(process.env.PORT ?? 8080),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    wanInterfaceName: process.env.WAN_INTERFACE_NAME || null,
    ouiPath: process.env.OUI_PATH ?? new URL('../data/oui.csv', import.meta.url).pathname,
    geoIpPath: process.env.GEOIP_PATH ?? new URL('../data/dbip-country-lite.csv', import.meta.url).pathname,
  };
}
