import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig } from './config.js';
import { openDb, runMigrations } from './db.js';
import { buildHealthRouter } from './health.js';
import { loadGeoIp } from './poller/geoip.js';
import { runOnePoll, startScheduler } from './poller/index.js';
import { loadOui } from './poller/oui.js';
import { createPfsenseClient } from './poller/pfsense.js';
import { buildActionsRouter } from './routes/actions.js';
import { buildFragmentsRouter } from './routes/fragments.js';
import { buildPageRouter } from './routes/page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
runMigrations(db);

const ouiMap = loadOui(cfg.ouiPath);
const geoRanges = loadGeoIp(cfg.geoIpPath);

const client = createPfsenseClient({
  baseUrl: cfg.pfsenseUrl,
  apiKey: cfg.pfsenseApiKey,
  verifyTls: cfg.pfsenseVerifyTls,
});

// Per-state firewall byte totals and per-device ntfy retry state are kept
// in-memory across polls and threaded into runOnePoll. Initialized empty here
// and handed to the scheduler after the initial sync so the second poll can
// compute true deltas from the first poll's observations.
const ntfyRetry = new Map();
let prevStateBytes = new Map();

console.log(JSON.stringify({ level: 'info', msg: 'running initial sync poll' }));
const first = await runOnePoll({
  db,
  client,
  ouiMap,
  geoRanges,
  now: Math.floor(Date.now() / 1000),
  staleAfterSec: cfg.pollIntervalSec * 10,
  ntfyTopicUrl: cfg.ntfyTopicUrl,
  graceSec: cfg.newDeviceGraceMinutes * 60,
  wanOverride: cfg.wanInterfaceName,
  prevStateBytes,
  ntfyRetry,
});
if (first.success && first.stateBytes) prevStateBytes = first.stateBytes;
console.log(
  JSON.stringify({
    level: 'info',
    msg: 'initial poll done',
    success: first.success,
    duration_ms: first.duration_ms,
    error: first.error,
  }),
);

const sched = startScheduler({
  db,
  client,
  ouiMap,
  geoRanges,
  intervalSec: cfg.pollIntervalSec,
  staleAfterSec: cfg.pollIntervalSec * 10,
  ntfyTopicUrl: cfg.ntfyTopicUrl,
  graceSec: cfg.newDeviceGraceMinutes * 60,
  wanOverride: cfg.wanInterfaceName,
  initialStateBytes: prevStateBytes,
  ntfyRetry,
});

const app = express();
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use('/static', express.static(join(__dirname, 'static')));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', buildHealthRouter());
app.use(buildPageRouter({ db }));
app.use(buildFragmentsRouter({ db }));
app.use(buildActionsRouter({ db }));

const server = app.listen(cfg.port, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'http listening', port: cfg.port }));
});

let shuttingDown = false;
async function shutdown(signal) {
  // Double-signal protection: a second SIGTERM mid-shutdown would race the
  // first into server.close / db.close.
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: 'info', msg: 'shutdown', signal }));

  // Force-exit if graceful shutdown stalls. server.close() waits for existing
  // HTTP connections to drain, and HTMX keep-alives on the dashboard can sit
  // idle for the full 30s polling interval, leaving the SIGTERM from a docker
  // stop unhandled before SIGKILL arrives — which never flushes the SQLite WAL.
  const forceExit = setTimeout(() => {
    console.error(JSON.stringify({ level: 'error', msg: 'shutdown timed out, forcing exit' }));
    process.exit(1);
  }, 8000);
  forceExit.unref();

  try {
    // Stop the scheduler and wait for any in-flight poll to finish writing to
    // the DB before we close it; otherwise a poll's post-fetch writes can land
    // on a closed sqlite handle and surface as cryptic errors during graceful
    // shutdown.
    await sched.stop();
    // Don't wait on idle keep-alive connections. Available in Node 18.2+.
    server.closeIdleConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
    db.close();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'shutdown error', error: String(e) }));
    clearTimeout(forceExit);
    process.exit(1);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
