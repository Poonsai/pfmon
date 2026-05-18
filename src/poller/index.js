import cron from 'node-cron';
import { buildSnapshot } from './snapshot.js';
import { normalizeInterfaces } from './interfaces.js';
import {
  syncInterfaces,
  reconcileDevices,
  recordTrafficSamples,
  recordInterfaceTrafficSamples,
  recordGeoConnections,
  recordFirewallBlocks,
} from './reconcile.js';
import { maybeFireNewDeviceAlerts } from './alerts.js';
import { pruneOldRows, rollupHourly, rollupDaily } from './retention.js';

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
    });

    reconcileDevices(db, { snapshot, now, staleAfterSec });
    recordTrafficSamples(db, { snapshot, now });
    recordInterfaceTrafficSamples(db, { stats: interfaceStats, now });
    recordGeoConnections(db, { snapshot, now });
    recordFirewallBlocks(db, { blocks: filterLogBlocks });

    await maybeFireNewDeviceAlerts(db, { topicUrl: ntfyTopicUrl, now, graceSec });

    const duration = Date.now() - start;
    db.prepare('INSERT INTO poll_log (ts, success, duration_ms) VALUES (?, 1, ?)').run(
      now,
      duration,
    );
    return { success: true, duration_ms: duration };
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
}) {
  let consecutiveFails = 0;
  let nextRunAt = Date.now();

  async function tick() {
    if (Date.now() < nextRunAt) return;
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
    });
    if (result.success) {
      consecutiveFails = 0;
      nextRunAt = Date.now() + intervalSec * 1000;
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
  }

  const fastTask = cron.schedule('*/5 * * * * *', tick);
  const hourlyTask = cron.schedule('0 * * * *', () =>
    rollupHourly(db, { now: Math.floor(Date.now() / 1000) }),
  );
  const dailyTask = cron.schedule('5 0 * * *', () => {
    const now = Math.floor(Date.now() / 1000);
    rollupDaily(db, { now });
    pruneOldRows(db, { now });
  });

  return {
    stop: () => {
      fastTask.stop();
      hourlyTask.stop();
      dailyTask.stop();
    },
  };
}
