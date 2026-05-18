import Database from 'better-sqlite3';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { maybeFireNewDeviceAlerts, NTFY_MAX_ATTEMPTS } from '../src/poller/alerts.js';

let okServer, okTopicUrl, received;
let failServer, failTopicUrl;
let hangServer, hangTopicUrl;
const hangOpenSockets = new Set();

beforeAll(async () => {
  received = [];
  await new Promise((resolve) => {
    const app = express();
    app.use(express.text({ type: '*/*' }));
    app.post('/topic', (req, res) => {
      received.push({ body: req.body, headers: req.headers });
      res.send('ok');
    });
    okServer = app.listen(0, () => {
      okTopicUrl = `http://127.0.0.1:${okServer.address().port}/topic`;
      resolve();
    });
  });
  await new Promise((resolve) => {
    const app = express();
    app.post('/topic', (_req, res) => res.status(500).send('boom'));
    failServer = app.listen(0, () => {
      failTopicUrl = `http://127.0.0.1:${failServer.address().port}/topic`;
      resolve();
    });
  });
  await new Promise((resolve) => {
    // Server that accepts but never responds. Used to verify the fetch timeout
    // actually fires — otherwise a hung ntfy peer would stall a poll forever.
    const app = express();
    app.post('/topic', (_req, _res) => {
      // intentionally no response
    });
    hangServer = app.listen(0, () => {
      hangTopicUrl = `http://127.0.0.1:${hangServer.address().port}/topic`;
      resolve();
    });
    hangServer.on('connection', (socket) => {
      hangOpenSockets.add(socket);
      socket.on('close', () => hangOpenSockets.delete(socket));
    });
  });
});
afterAll(async () => {
  await new Promise((r) => okServer.close(r));
  await new Promise((r) => failServer.close(r));
  // Forcibly drop any lingering sockets so the hang server can close.
  for (const s of hangOpenSockets) s.destroy();
  await new Promise((r) => hangServer.close(r));
});

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const now = 1_000_000;
  db.prepare(`INSERT INTO devices (mac, vendor, hostname, current_ip, is_online, first_seen_at, last_seen_at, new_until_seen_at)
              VALUES ('aa:bb:cc:dd:ee:ff','Espressif','iot1','10.20.0.99', 1, ?, ?, ?)`).run(
    now,
    now,
    now,
  );
  return { db, now };
}

describe('maybeFireNewDeviceAlerts', () => {
  it('does not fire before grace period elapses', async () => {
    const { db, now } = setup();
    await maybeFireNewDeviceAlerts(db, {
      topicUrl: okTopicUrl,
      now: now + 60,
      graceSec: 300,
      ntfyRetry: new Map(),
    });
    expect(received).toHaveLength(0);
  });

  it('fires once after grace period and sets alerted_at', async () => {
    received.length = 0;
    const { db, now } = setup();
    await maybeFireNewDeviceAlerts(db, {
      topicUrl: okTopicUrl,
      now: now + 400,
      graceSec: 300,
      ntfyRetry: new Map(),
    });
    expect(received).toHaveLength(1);
    expect(received[0].body).toMatch(/iot1|10\.20\.0\.99|aa:bb:cc:dd:ee:ff/);
    received.length = 0;
    await maybeFireNewDeviceAlerts(db, {
      topicUrl: okTopicUrl,
      now: now + 500,
      graceSec: 300,
      ntfyRetry: new Map(),
    });
    expect(received).toHaveLength(0);
  });

  it('is a no-op when topicUrl is empty', async () => {
    received.length = 0;
    const { db, now } = setup();
    await maybeFireNewDeviceAlerts(db, {
      topicUrl: '',
      now: now + 400,
      graceSec: 300,
      ntfyRetry: new Map(),
    });
    expect(received).toHaveLength(0);
  });

  it('records retry state and backs off on failed POST instead of retrying every poll', async () => {
    const { db, now } = setup();
    const ntfyRetry = new Map();
    // First failed attempt at now+400.
    await maybeFireNewDeviceAlerts(db, {
      topicUrl: failTopicUrl,
      now: now + 400,
      graceSec: 300,
      ntfyRetry,
    });
    expect(ntfyRetry.size).toBe(1);
    const devId = Array.from(ntfyRetry.keys())[0];
    expect(ntfyRetry.get(devId).attempts).toBe(1);
    expect(ntfyRetry.get(devId).nextAttemptAt).toBeGreaterThan(now + 400);

    // 1 second later — backoff window hasn't elapsed; the function must skip
    // the POST entirely and leave `attempts` at 1.
    await maybeFireNewDeviceAlerts(db, {
      topicUrl: failTopicUrl,
      now: now + 401,
      graceSec: 300,
      ntfyRetry,
    });
    expect(ntfyRetry.get(devId).attempts).toBe(1);
  });

  it('aborts the POST when the ntfy server hangs (regression: no fetch timeout)', async () => {
    const { db, now } = setup();
    const ntfyRetry = new Map();
    const started = Date.now();
    await maybeFireNewDeviceAlerts(db, {
      topicUrl: hangTopicUrl,
      now: now + 400,
      graceSec: 300,
      ntfyRetry,
      timeoutMs: 200,
    });
    const elapsed = Date.now() - started;
    // Must return well under a second — the 200ms abort plus a small buffer.
    expect(elapsed).toBeLessThan(2000);
    // And the failure must be recorded so backoff kicks in.
    expect(ntfyRetry.size).toBe(1);
    expect(Array.from(ntfyRetry.values())[0].attempts).toBe(1);
  });

  it('gives up after NTFY_MAX_ATTEMPTS so a bad URL cannot spam forever', async () => {
    const { db, now } = setup();
    const ntfyRetry = new Map();
    let t = now + 400;
    // Push the clock forward past each backoff window so the next attempt fires.
    for (let i = 0; i < NTFY_MAX_ATTEMPTS; i++) {
      await maybeFireNewDeviceAlerts(db, {
        topicUrl: failTopicUrl,
        now: t,
        graceSec: 300,
        ntfyRetry,
      });
      t = Array.from(ntfyRetry.values())[0].nextAttemptAt + 1;
    }
    const devId = Array.from(ntfyRetry.keys())[0];
    expect(ntfyRetry.get(devId).attempts).toBe(NTFY_MAX_ATTEMPTS);

    // One more attempt far past any backoff — the function must short-circuit
    // on attempts >= NTFY_MAX_ATTEMPTS and not bump the counter further.
    await maybeFireNewDeviceAlerts(db, {
      topicUrl: failTopicUrl,
      now: t + 86400,
      graceSec: 300,
      ntfyRetry,
    });
    expect(ntfyRetry.get(devId).attempts).toBe(NTFY_MAX_ATTEMPTS);
  });
});
