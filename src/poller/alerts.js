// NTFY_MAX_ATTEMPTS is exported so tests can iterate up to the cap; the other
// two are internal-only and don't need to leak into the module's public API.
export const NTFY_MAX_ATTEMPTS = 5;
const NTFY_INITIAL_BACKOFF_SEC = 60;
const NTFY_MAX_BACKOFF_SEC = 3600;
// Node's global fetch has no default timeout. A hung ntfy server would stall
// the poll indefinitely (the alert fires inside runOnePoll). Cap each POST.
const NTFY_TIMEOUT_MS = 5000;

function nextBackoffSec(attempts) {
  // Exponential: 60s, 120s, 240s, 480s, 960s, capped at 1h.
  const exp = NTFY_INITIAL_BACKOFF_SEC * 2 ** Math.max(0, attempts - 1);
  return Math.min(NTFY_MAX_BACKOFF_SEC, exp);
}

export async function maybeFireNewDeviceAlerts(
  db,
  { topicUrl, now, graceSec, ntfyRetry, timeoutMs = NTFY_TIMEOUT_MS },
) {
  if (!topicUrl) return;
  const candidates = db
    .prepare(`
    SELECT d.id, d.mac, d.vendor, d.hostname, d.current_ip, i.pfsense_name AS interface_name
    FROM devices d
    LEFT JOIN interfaces i ON i.id = d.interface_id
    WHERE d.alerted_at IS NULL AND d.first_seen_at <= ?
  `)
    .all(now - graceSec);

  const markAlerted = db.prepare('UPDATE devices SET alerted_at = ? WHERE id = ?');

  for (const dev of candidates) {
    // Per-device retry state lives in-memory across polls (passed through
    // runOnePoll). Without it, a misconfigured ntfy URL would re-attempt every
    // candidate device every poll cycle indefinitely — log spam at best,
    // rate-limited bans at worst.
    const retry = ntfyRetry?.get(dev.id);
    if (retry) {
      if (retry.attempts >= NTFY_MAX_ATTEMPTS) continue;
      if (retry.nextAttemptAt != null && now < retry.nextAttemptAt) continue;
    }

    const body = `New device on network\nvendor=${dev.vendor ?? '?'}\nhostname=${dev.hostname ?? '?'}\nip=${dev.current_ip ?? '?'}\nmac=${dev.mac}\nvlan=${dev.interface_name ?? '?'}`;
    let ok = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(topicUrl, {
        method: 'POST',
        headers: { Title: 'pfmon: new device', 'Content-Type': 'text/plain' },
        body,
        signal: controller.signal,
      });
      ok = res.ok;
      if (!ok) {
        console.log(JSON.stringify({ level: 'warn', msg: 'ntfy non-2xx', status: res.status }));
      }
    } catch (e) {
      console.log(JSON.stringify({ level: 'warn', msg: 'ntfy error', error: String(e) }));
    } finally {
      clearTimeout(timer);
    }

    if (ok) {
      markAlerted.run(now, dev.id);
      ntfyRetry?.delete(dev.id);
    } else if (ntfyRetry) {
      const attempts = (retry?.attempts ?? 0) + 1;
      const nextAttemptAt = now + nextBackoffSec(attempts);
      ntfyRetry.set(dev.id, { attempts, nextAttemptAt });
      if (attempts >= NTFY_MAX_ATTEMPTS) {
        console.log(
          JSON.stringify({
            level: 'warn',
            msg: 'ntfy giving up on device after max attempts',
            device_id: dev.id,
            attempts,
          }),
        );
      }
    }
  }
}
