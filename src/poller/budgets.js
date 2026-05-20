const NTFY_INITIAL_BACKOFF_SEC = 60;
const NTFY_MAX_BACKOFF_SEC = 3600;
const NTFY_MAX_ATTEMPTS = 5;
const NTFY_TIMEOUT_MS = 5000;

function nextBackoffSec(attempts) {
  const exp = NTFY_INITIAL_BACKOFF_SEC * 2 ** Math.max(0, attempts - 1);
  return Math.min(NTFY_MAX_BACKOFF_SEC, exp);
}

// The retry keyspace is shared with new-device alerts (via the same `ntfyRetry`
// Map). Prefix our keys so a device id can have both kinds of retries pending
// without collision.
const retryKey = (deviceId) => `budget:${deviceId}`;

export async function maybeFireBudgetAlerts(
  db,
  { topicUrl, now, ntfyRetry, timeoutMs = NTFY_TIMEOUT_MS },
) {
  if (!topicUrl) return;
  const dayBucket = Math.floor(now / 86400) * 86400;
  const candidates = db
    .prepare(`
    SELECT d.id, d.mac, d.hostname, d.nickname, d.current_ip, d.daily_budget_bytes,
      (
        COALESCE((SELECT SUM(rx_bytes + tx_bytes) FROM traffic_hourly th
                  WHERE th.device_id = d.id AND th.hour_bucket >= @dayBucket), 0)
        + COALESCE((SELECT SUM(rx_bytes + tx_bytes) FROM traffic_samples ts
                    WHERE ts.device_id = d.id AND ts.ts >= @dayBucket
                    AND NOT EXISTS (
                      SELECT 1 FROM traffic_hourly h
                      WHERE h.device_id = ts.device_id
                      AND h.hour_bucket = (ts.ts / 3600) * 3600
                    )), 0)
      ) AS bytes_today
    FROM devices d
    WHERE d.daily_budget_bytes IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM budget_alerts ba
        WHERE ba.device_id = d.id AND ba.day_bucket = @dayBucket
      )
  `)
    .all({ dayBucket });

  const markAlerted = db.prepare(
    'INSERT OR IGNORE INTO budget_alerts (device_id, day_bucket, alerted_at) VALUES (?, ?, ?)',
  );

  for (const dev of candidates) {
    if (dev.bytes_today < dev.daily_budget_bytes) continue;
    const key = retryKey(dev.id);
    const retry = ntfyRetry?.get(key);
    if (retry) {
      if (retry.attempts >= NTFY_MAX_ATTEMPTS) continue;
      if (retry.nextAttemptAt != null && now < retry.nextAttemptAt) continue;
    }

    const name = dev.nickname ?? dev.hostname ?? dev.mac;
    const budgetMb = Math.round(dev.daily_budget_bytes / 1024 / 1024);
    const usedMb = Math.round(dev.bytes_today / 1024 / 1024);
    const body = `Budget hit: ${name}\nused=${usedMb} MB\nbudget=${budgetMb} MB\nip=${dev.current_ip ?? '?'}`;

    let ok = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(topicUrl, {
        method: 'POST',
        headers: { Title: 'pfmon: budget alert', 'Content-Type': 'text/plain' },
        body,
        signal: controller.signal,
      });
      ok = res.ok;
      if (!ok) {
        console.log(
          JSON.stringify({ level: 'warn', msg: 'ntfy budget non-2xx', status: res.status }),
        );
      }
    } catch (e) {
      console.log(JSON.stringify({ level: 'warn', msg: 'ntfy budget error', error: String(e) }));
    } finally {
      clearTimeout(timer);
    }

    if (ok) {
      markAlerted.run(dev.id, dayBucket, now);
      ntfyRetry?.delete(key);
    } else if (ntfyRetry) {
      const attempts = (retry?.attempts ?? 0) + 1;
      const nextAttemptAt = now + nextBackoffSec(attempts);
      ntfyRetry.set(key, { attempts, nextAttemptAt });
    }
  }
}
