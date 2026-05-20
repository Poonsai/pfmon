import Database from 'better-sqlite3';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { maybeFireBudgetAlerts } from '../src/poller/budgets.js';

let okServer, okTopicUrl, received;
let failServer, failTopicUrl;

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
});
afterAll(async () => {
  await new Promise((r) => okServer.close(r));
  await new Promise((r) => failServer.close(r));
});

function setup({ budgetBytes, todayBytes }) {
  const db = new Database(':memory:');
  runMigrations(db);
  const now = 1_700_000_000;
  db.prepare(
    `INSERT INTO devices (mac, hostname, current_ip, is_online, first_seen_at, last_seen_at, daily_budget_bytes)
     VALUES ('aa:bb:cc:dd:ee:01','tv','10.0.0.10',1,?,?,?)`,
  ).run(now, now, budgetBytes);
  const id = db.prepare("SELECT id FROM devices WHERE mac='aa:bb:cc:dd:ee:01'").get().id;
  if (todayBytes > 0) {
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(id, now - 60, todayBytes, 0);
  }
  return { db, id, now };
}

describe('maybeFireBudgetAlerts', () => {
  it('does not fire when today bytes are under budget', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 50 * 1024 * 1024 });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now, ntfyRetry: new Map() });
    expect(received).toHaveLength(0);
  });

  it('fires one alert when today bytes cross budget', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 150 * 1024 * 1024 });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now, ntfyRetry: new Map() });
    expect(received).toHaveLength(1);
    expect(received[0].body).toMatch(/tv|10\.0\.0\.10/);
  });

  it('does not re-fire on subsequent polls within the same day', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 150 * 1024 * 1024 });
    const retry = new Map();
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now, ntfyRetry: retry });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now: now + 30, ntfyRetry: retry });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now: now + 3600, ntfyRetry: retry });
    expect(received).toHaveLength(1);
  });

  it('fires again on a new UTC day', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 150 * 1024 * 1024 });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now, ntfyRetry: new Map() });
    const id = db.prepare("SELECT id FROM devices WHERE mac='aa:bb:cc:dd:ee:01'").get().id;
    const tomorrow = now + 86400;
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(id, tomorrow, 200 * 1024 * 1024, 0);
    await maybeFireBudgetAlerts(db, {
      topicUrl: okTopicUrl,
      now: tomorrow + 60,
      ntfyRetry: new Map(),
    });
    expect(received).toHaveLength(2);
  });

  it('skips devices with no budget set (null)', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: null, todayBytes: 999 * 1024 * 1024 });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now, ntfyRetry: new Map() });
    expect(received).toHaveLength(0);
  });

  it('is a no-op when topicUrl is empty', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 150 * 1024 * 1024 });
    await maybeFireBudgetAlerts(db, { topicUrl: '', now, ntfyRetry: new Map() });
    expect(received).toHaveLength(0);
    const rows = db.prepare('SELECT * FROM budget_alerts').all();
    expect(rows.length).toBe(0);
  });

  it('records retry state on POST failure and does not mark alerted', async () => {
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 150 * 1024 * 1024 });
    const retry = new Map();
    await maybeFireBudgetAlerts(db, { topicUrl: failTopicUrl, now, ntfyRetry: retry });
    expect(retry.size).toBe(1);
    const rows = db.prepare('SELECT * FROM budget_alerts').all();
    expect(rows.length).toBe(0);
  });
});
