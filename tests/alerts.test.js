import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { maybeFireNewDeviceAlerts } from '../src/poller/alerts.js';

let server, topicUrl, received;

beforeAll(() => new Promise((resolve) => {
  received = [];
  const app = express();
  app.use(express.text({ type: '*/*' }));
  app.post('/topic', (req, res) => {
    received.push({ body: req.body, headers: req.headers });
    res.send('ok');
  });
  server = app.listen(0, () => { topicUrl = `http://127.0.0.1:${server.address().port}/topic`; resolve(); });
}));
afterAll(() => new Promise((r) => server.close(r)));

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const now = 1_000_000;
  db.prepare(`INSERT INTO devices (mac, vendor, hostname, current_ip, is_online, first_seen_at, last_seen_at, new_until_seen_at)
              VALUES ('aa:bb:cc:dd:ee:ff','Espressif','iot1','10.20.0.99', 1, ?, ?, ?)`).run(now, now, now);
  return { db, now };
}

describe('maybeFireNewDeviceAlerts', () => {
  it('does not fire before grace period elapses', async () => {
    const { db, now } = setup();
    await maybeFireNewDeviceAlerts(db, { topicUrl, now: now + 60, graceSec: 300 });
    expect(received).toHaveLength(0);
  });

  it('fires once after grace period and sets alerted_at', async () => {
    const { db, now } = setup();
    await maybeFireNewDeviceAlerts(db, { topicUrl, now: now + 400, graceSec: 300 });
    expect(received).toHaveLength(1);
    expect(received[0].body).toMatch(/iot1|10\.20\.0\.99|aa:bb:cc:dd:ee:ff/);
    received.length = 0;
    await maybeFireNewDeviceAlerts(db, { topicUrl, now: now + 500, graceSec: 300 });
    expect(received).toHaveLength(0);
  });

  it('is a no-op when topicUrl is empty', async () => {
    const { db, now } = setup();
    await maybeFireNewDeviceAlerts(db, { topicUrl: '', now: now + 400, graceSec: 300 });
    expect(received).toHaveLength(0);
  });
});
