ALTER TABLE devices ADD COLUMN daily_budget_bytes INTEGER;

CREATE TABLE IF NOT EXISTS budget_alerts (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  day_bucket INTEGER NOT NULL,
  alerted_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, day_bucket)
);
