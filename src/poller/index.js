import cron from 'node-cron';
import { maybeFireNewDeviceAlerts } from './alerts.js';
import { maybeFireBudgetAlerts } from './budgets.js';
import { maybeSendDigest } from './digest.js';
import { normalizeInterfaces } from './interfaces.js';
import {
  reconcileDevices,
  recordFirewallBlocks,
  recordGeoConnections,
  recordInterfaceTrafficSamples,
  recordTrafficSamples,
  syncInterfaces,
} from './reconcile.js';
import { pruneOldRows, rollupDaily, rollupHourly } from './retention.js';
import { buildSnapshot } from './snapshot.js';

export async function runOnePoll({
  db,
  client,
  ouiMap,
  geoRanges,
  now,
  staleAfterSec,
  ntfyTopicUrl,
  graceSec,
  wanOverride,
  prevStateBytes,
  ntfyRetry,
}) {
  const start = Date.now();
  try {
    const [arp, dhcpLeases, ndp, firewallStates, rawInterfaces, interfaceStats, filterLogBlocks] =
      await Promise.all([
        client.fetchArpTable(),
        client.fetchDhcpLeases(),
        client.fetchNdpTable(),
        client.fetchFirewallStates(),
        client.fetchInterfaces(),
        client.fetchInterfaceStats(),
        client.fetchFilterLogBlocks(),
      ]);

    const interfaces = normalizeInterfaces(rawInterfaces, { wanOverride });
    syncInterfaces(db, interfaces);

    const snapshot = buildSnapshot({
      arp,
      dhcpLeases,
      ndp,
      firewallStates,
      interfaces,
      ouiMap,
      geoRanges,
      prevStateBytes,
    });

    reconcileDevices(db, { snapshot, now, staleAfterSec });
    recordTrafficSamples(db, { snapshot, now });
    recordInterfaceTrafficSamples(db, { stats: interfaceStats, now });
    recordGeoConnections(db, { snapshot, now });
    recordFirewallBlocks(db, { blocks: filterLogBlocks });

    await maybeFireNewDeviceAlerts(db, { topicUrl: ntfyTopicUrl, now, graceSec, ntfyRetry });
    await maybeFireBudgetAlerts(db, { topicUrl: ntfyTopicUrl, now, ntfyRetry });

    const duration = Date.now() - start;
    db.prepare('INSERT INTO poll_log (ts, success, duration_ms) VALUES (?, 1, ?)').run(
      now,
      duration,
    );
    return { success: true, duration_ms: duration, stateBytes: snapshot.stateBytes };
  } catch (e) {
    const duration = Date.now() - start;
    db.prepare(
      'INSERT INTO poll_log (ts, success, duration_ms, error_msg) VALUES (?, 0, ?, ?)',
    ).run(now, duration, String(e?.message ?? e));
    return { success: false, error: String(e?.message ?? e) };
  }
}

export function startScheduler({
  db,
  client,
  ouiMap,
  geoRanges,
  intervalSec,
  staleAfterSec,
  ntfyTopicUrl,
  graceSec,
  wanOverride,
  initialStateBytes,
  ntfyRetry,
  digestHour,
}) {
  let consecutiveFails = 0;
  let nextRunAt = Date.now();
  // Cron fires every 5s, but a poll can take longer than that (especially under
  // a slow pfRest). Without a re-entry guard the second cron tick races the
  // first into runOnePoll, producing duplicate rows in traffic_samples and
  // poll_log for the same `now`. inFlight also lets stop() await a running poll
  // so the caller can safely close the DB without writing into a closed handle.
  let inFlight = Promise.resolve();
  let running = false;
  let prevStateBytes = initialStateBytes ?? new Map();

  async function tick() {
    if (running || Date.now() < nextRunAt) return;
    running = true;
    inFlight = (async () => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const result = await runOnePoll({
          db,
          client,
          ouiMap,
          geoRanges,
          now,
          staleAfterSec,
          ntfyTopicUrl,
          graceSec,
          wanOverride,
          prevStateBytes,
          ntfyRetry,
        });
        if (result.success) {
          consecutiveFails = 0;
          nextRunAt = Date.now() + intervalSec * 1000;
          if (result.stateBytes) prevStateBytes = result.stateBytes;
        } else {
          consecutiveFails += 1;
          const backoffSec =
            consecutiveFails < 3
              ? intervalSec
              : Math.min(300, intervalSec * 2 ** Math.min(4, consecutiveFails - 2));
          nextRunAt = Date.now() + backoffSec * 1000;
          console.log(
            JSON.stringify({ level: 'warn', msg: 'poll failed', consecutiveFails, backoffSec }),
          );
        }
      } finally {
        running = false;
      }
    })();
    await inFlight;
  }

  const fastTask = cron.schedule('*/5 * * * * *', tick);
  const hourlyTask = cron.schedule('0 * * * *', async () => {
    const now = Math.floor(Date.now() / 1000);
    rollupHourly(db, { now });
    await maybeSendDigest(db, { topicUrl: ntfyTopicUrl, now, digestHour });
  });
  const dailyTask = cron.schedule('5 0 * * *', () => {
    const now = Math.floor(Date.now() / 1000);
    rollupDaily(db, { now });
    pruneOldRows(db, { now });
  });

  return {
    stop: async () => {
      fastTask.stop();
      hourlyTask.stop();
      dailyTask.stop();
      await inFlight;
    },
  };
}
