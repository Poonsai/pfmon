import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { buildFragmentsRouter } from '../src/routes/fragments.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, '..', 'src', 'views'));
  app.use(buildFragmentsRouter({ db }));
  return app;
}

function seed(db) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES ('wan', 'WAN', 'wan')`,
  ).run();
  const wanId = db.prepare("SELECT id FROM interfaces WHERE pfsense_name='wan'").get().id;
  const dayStart = now - 24 * 3600;
  for (let i = 0; i < 24; i++) {
    const hour = dayStart + i * 3600;
    db.prepare(`INSERT INTO interface_traffic_hourly (interface_id, hour_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
                VALUES (?, ?, ?, ?, ?, ?)`).run(
      wanId,
      hour,
      1000 * (i + 1),
      200 * (i + 1),
      100,
      30,
    );
  }
}

describe('GET /fragments/wan-summary', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    seed(db);
  });

  it('renders today/week/month totals and an inline SVG', async () => {
    const res = await request(makeApp(db)).get('/fragments/wan-summary');
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    expect($('.wan-summary').length).toBe(1);
    expect($('.wan-summary svg').length).toBe(1);
    expect(res.text).toMatch(/today/i);
    expect(res.text).toMatch(/week/i);
    expect(res.text).toMatch(/month/i);
  });

  it('handles missing WAN interface gracefully', async () => {
    const empty = new Database(':memory:');
    runMigrations(empty);
    const res = await request(makeApp(empty)).get('/fragments/wan-summary');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/no wan/i);
  });

  it('shows traffic from in-progress samples before the hourly rollup has fired', async () => {
    // Fresh-start scenario: poller has written samples but no hourly rollup yet.
    const fresh = new Database(':memory:');
    runMigrations(fresh);
    fresh
      .prepare(
        `INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES ('wan','WAN','wan')`,
      )
      .run();
    const wanId = fresh.prepare("SELECT id FROM interfaces WHERE pfsense_name='wan'").get().id;
    const now = Math.floor(Date.now() / 1000);
    // Three samples in the current hour, no hourly rows.
    fresh
      .prepare(
        `INSERT INTO interface_traffic_samples (interface_id, ts, rx_bytes, tx_bytes) VALUES (?, ?, ?, ?)`,
      )
      .run(wanId, now - 90, 5_000_000, 1_000_000);
    fresh
      .prepare(
        `INSERT INTO interface_traffic_samples (interface_id, ts, rx_bytes, tx_bytes) VALUES (?, ?, ?, ?)`,
      )
      .run(wanId, now - 60, 3_000_000, 500_000);
    fresh
      .prepare(
        `INSERT INTO interface_traffic_samples (interface_id, ts, rx_bytes, tx_bytes) VALUES (?, ?, ?, ?)`,
      )
      .run(wanId, now - 30, 2_000_000, 250_000);
    expect(fresh.prepare('SELECT COUNT(*) c FROM interface_traffic_hourly').get().c).toBe(0);

    const res = await request(makeApp(fresh)).get('/fragments/wan-summary');
    expect(res.status).toBe(200);
    // Total rx today = 10MB; total tx today = 1.75MB. formatBytes(0) returns '-', so a real
    // total should NOT render as '-' after "Down:".
    expect(res.text).toMatch(/Down: 9\.5 MB/);
    expect(res.text).toMatch(/Up: 1\.7 MB/);
    // The chart should NOT show the "No data yet" placeholder when samples exist.
    expect(res.text).not.toMatch(/No data yet/);
  });

  it('combines past hourly buckets with current in-progress samples without double counting', async () => {
    const mixed = new Database(':memory:');
    runMigrations(mixed);
    mixed
      .prepare(
        `INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES ('wan','WAN','wan')`,
      )
      .run();
    const wanId = mixed.prepare("SELECT id FROM interfaces WHERE pfsense_name='wan'").get().id;
    const now = Math.floor(Date.now() / 1000);
    const hourStart = Math.floor(now / 3600) * 3600;
    // Past completed hour: 100 MiB rx, 10 MiB tx.
    mixed
      .prepare(`INSERT INTO interface_traffic_hourly (interface_id, hour_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
                   VALUES (?, ?, ?, ?, ?, ?)`)
      .run(wanId, hourStart - 3600, 100 * 1024 * 1024, 10 * 1024 * 1024, 0, 0);
    // Current in-progress hour: 25 MiB rx, 5 MiB tx from samples.
    mixed
      .prepare(
        `INSERT INTO interface_traffic_samples (interface_id, ts, rx_bytes, tx_bytes) VALUES (?, ?, ?, ?)`,
      )
      .run(wanId, hourStart + 60, 25 * 1024 * 1024, 5 * 1024 * 1024);

    const res = await request(makeApp(mixed)).get('/fragments/wan-summary');
    expect(res.status).toBe(200);
    // 100 + 25 = 125 MiB rx, 10 + 5 = 15 MiB tx
    expect(res.text).toMatch(/Down: 125 MB/);
    expect(res.text).toMatch(/Up: 15 MB/);
  });
});
