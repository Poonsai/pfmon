const SEC_DAY = 86400;
const SEC_HOUR = 3600;

export function pruneOldRows(db, { now }) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM traffic_samples WHERE ts < ?').run(now - 7 * SEC_DAY);
    db.prepare('DELETE FROM interface_traffic_samples WHERE ts < ?').run(now - 7 * SEC_DAY);
    db.prepare('DELETE FROM traffic_hourly WHERE hour_bucket < ?').run(now - 90 * SEC_DAY);
    db.prepare('DELETE FROM interface_traffic_hourly WHERE hour_bucket < ?').run(
      now - 90 * SEC_DAY,
    );
    db.prepare('DELETE FROM firewall_blocks WHERE ts < ?').run(now - 7 * SEC_DAY);
    db.prepare('DELETE FROM poll_log WHERE ts < ?').run(now - 7 * SEC_DAY);
  });
  tx();
}

export function rollupHourly(db, { now }) {
  const cutoff = Math.floor(now / SEC_HOUR) * SEC_HOUR;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO traffic_hourly (device_id, hour_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
      SELECT device_id, (ts / 3600) * 3600 AS hour_bucket,
             SUM(rx_bytes), SUM(tx_bytes), MAX(rx_bytes), MAX(tx_bytes)
      FROM traffic_samples
      WHERE ts < ?
      GROUP BY device_id, hour_bucket
      ON CONFLICT(device_id, hour_bucket) DO UPDATE SET
        rx_bytes = excluded.rx_bytes,
        tx_bytes = excluded.tx_bytes,
        peak_rx_rate = excluded.peak_rx_rate,
        peak_tx_rate = excluded.peak_tx_rate
    `).run(cutoff);
    db.prepare(`
      INSERT INTO interface_traffic_hourly (interface_id, hour_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
      SELECT interface_id, (ts / 3600) * 3600,
             SUM(rx_bytes), SUM(tx_bytes), MAX(rx_bytes), MAX(tx_bytes)
      FROM interface_traffic_samples
      WHERE ts < ?
      GROUP BY interface_id, (ts / 3600) * 3600
      ON CONFLICT(interface_id, hour_bucket) DO UPDATE SET
        rx_bytes = excluded.rx_bytes,
        tx_bytes = excluded.tx_bytes,
        peak_rx_rate = excluded.peak_rx_rate,
        peak_tx_rate = excluded.peak_tx_rate
    `).run(cutoff);
  });
  tx();
}

export function rollupDaily(db, { now }) {
  const cutoff = Math.floor(now / SEC_DAY) * SEC_DAY;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO traffic_daily (device_id, day_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
      SELECT device_id, (hour_bucket / 86400) * 86400,
             SUM(rx_bytes), SUM(tx_bytes), MAX(peak_rx_rate), MAX(peak_tx_rate)
      FROM traffic_hourly
      WHERE hour_bucket < ?
      GROUP BY device_id, (hour_bucket / 86400) * 86400
      ON CONFLICT(device_id, day_bucket) DO UPDATE SET
        rx_bytes = excluded.rx_bytes,
        tx_bytes = excluded.tx_bytes,
        peak_rx_rate = excluded.peak_rx_rate,
        peak_tx_rate = excluded.peak_tx_rate
    `).run(cutoff);
    db.prepare(`
      INSERT INTO interface_traffic_daily (interface_id, day_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
      SELECT interface_id, (hour_bucket / 86400) * 86400,
             SUM(rx_bytes), SUM(tx_bytes), MAX(peak_rx_rate), MAX(peak_tx_rate)
      FROM interface_traffic_hourly
      WHERE hour_bucket < ?
      GROUP BY interface_id, (hour_bucket / 86400) * 86400
      ON CONFLICT(interface_id, day_bucket) DO UPDATE SET
        rx_bytes = excluded.rx_bytes,
        tx_bytes = excluded.tx_bytes,
        peak_rx_rate = excluded.peak_rx_rate,
        peak_tx_rate = excluded.peak_tx_rate
    `).run(cutoff);
  });
  tx();
}
