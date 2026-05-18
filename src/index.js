import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHealthRouter } from './health.js';
import { buildPageRouter } from './routes/page.js';
import { buildFragmentsRouter } from './routes/fragments.js';
import { buildActionsRouter } from './routes/actions.js';
import { loadConfig } from './config.js';
import { openDb, runMigrations } from './db.js';
import { loadOui } from './poller/oui.js';
import { loadGeoIp } from './poller/geoip.js';
import { createPfsenseClient } from './poller/pfsense.js';
import { runOnePoll, startScheduler } from './poller/index.js';

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

console.log(JSON.stringify({ level: 'info', msg: 'running initial sync poll' }));
const first = await runOnePoll({
  db, client, ouiMap, geoRanges,
  now: Math.floor(Date.now() / 1000),
  staleAfterSec: cfg.pollIntervalSec * 10,
  ntfyTopicUrl: cfg.ntfyTopicUrl,
  graceSec: cfg.newDeviceGraceMinutes * 60,
  wanOverride: cfg.wanInterfaceName,
});
console.log(JSON.stringify({ level: 'info', msg: 'initial poll done', ...first }));

const sched = startScheduler({
  db, client, ouiMap, geoRanges,
  intervalSec: cfg.pollIntervalSec,
  staleAfterSec: cfg.pollIntervalSec * 10,
  ntfyTopicUrl: cfg.ntfyTopicUrl,
  graceSec: cfg.newDeviceGraceMinutes * 60,
  wanOverride: cfg.wanInterfaceName,
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

function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', msg: 'shutdown', signal }));
  sched.stop();
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
