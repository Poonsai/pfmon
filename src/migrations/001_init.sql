PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS interfaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pfsense_name TEXT NOT NULL UNIQUE,
  friendly_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('wan','lan','opt','vlan')),
  vlan_tag INTEGER,
  ipv4_subnet TEXT,
  ipv6_prefix TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac TEXT NOT NULL UNIQUE,
  vendor TEXT,
  hostname TEXT,
  nickname TEXT,
  notes TEXT,
  device_type_guess TEXT,
  current_ip TEXT,
  current_ipv6 TEXT,
  interface_id INTEGER REFERENCES interfaces(id) ON DELETE SET NULL,
  current_lease_type TEXT,
  current_lease_expires_at INTEGER,
  is_online INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  new_until_seen_at INTEGER,
  alerted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen_at);

CREATE TABLE IF NOT EXISTS device_tags (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (device_id, tag)
);

CREATE TABLE IF NOT EXISTS uptime_events (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('online','offline'))
);
CREATE INDEX IF NOT EXISTS idx_uptime_device_ts ON uptime_events(device_id, ts);

CREATE TABLE IF NOT EXISTS traffic_samples (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  states_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_traffic_samples_device_ts ON traffic_samples(device_id, ts);

CREATE TABLE IF NOT EXISTS traffic_hourly (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  hour_bucket INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  peak_rx_rate INTEGER,
  peak_tx_rate INTEGER,
  PRIMARY KEY (device_id, hour_bucket)
);

CREATE TABLE IF NOT EXISTS traffic_daily (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  day_bucket INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  peak_rx_rate INTEGER,
  peak_tx_rate INTEGER,
  PRIMARY KEY (device_id, day_bucket)
);

CREATE TABLE IF NOT EXISTS interface_traffic_samples (
  interface_id INTEGER NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER
);
CREATE INDEX IF NOT EXISTS idx_interface_traffic_samples ON interface_traffic_samples(interface_id, ts);

CREATE TABLE IF NOT EXISTS interface_traffic_hourly (
  interface_id INTEGER NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
  hour_bucket INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  peak_rx_rate INTEGER,
  peak_tx_rate INTEGER,
  PRIMARY KEY (interface_id, hour_bucket)
);

CREATE TABLE IF NOT EXISTS interface_traffic_daily (
  interface_id INTEGER NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
  day_bucket INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  peak_rx_rate INTEGER,
  peak_tx_rate INTEGER,
  PRIMARY KEY (interface_id, day_bucket)
);

CREATE TABLE IF NOT EXISTS firewall_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  src_ip TEXT,
  src_port INTEGER,
  dst_ip TEXT,
  dst_port INTEGER,
  proto TEXT,
  direction TEXT,
  dedupe_hash TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_fwblocks_device_ts ON firewall_blocks(device_id, ts);

CREATE TABLE IF NOT EXISTS geo_connections (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (device_id, country_code)
);

CREATE TABLE IF NOT EXISTS poll_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  success INTEGER NOT NULL,
  duration_ms INTEGER,
  error_msg TEXT
);
CREATE INDEX IF NOT EXISTS idx_poll_log_ts ON poll_log(ts);

CREATE TABLE IF NOT EXISTS device_counter_state (
  device_id INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  rx_total INTEGER NOT NULL,
  tx_total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS interface_counter_state (
  interface_id INTEGER PRIMARY KEY REFERENCES interfaces(id) ON DELETE CASCADE,
  rx_total INTEGER NOT NULL,
  tx_total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
