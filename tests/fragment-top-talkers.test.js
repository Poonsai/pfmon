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
    `INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES ('lan','LAN','lan')`,
  ).run();
  const ifLan = db.prepare("SELECT id FROM interfaces WHERE pfsense_name='lan'").get().id;
  db.prepare(`INSERT INTO devices (mac, hostname, nickname, current_ip, interface_id, is_online, first_seen_at, last_seen_at, device_type_guess) VALUES
    ('aa:00:00:00:00:01','tv-living',NULL,'10.0.0.10',?,1,?,?,'Smart TV'),
    ('aa:00:00:00:00:02','phone',NULL,'10.0.0.11',?,1,?,?,NULL),
    ('aa:00:00:00:00:03','silent',NULL,'10.0.0.12',?,1,?,?,NULL)`).run(
    ifLan,
    now,
    now,
    ifLan,
    now,
    now,
    ifLan,
    now,
    now,
  );
  const tv = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:01'").get().id;
  const phone = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:02'").get().id;
  db.prepare(
    `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
  ).run(tv, now - 60, 80_000_000, 4_000_000);
  db.prepare(
    `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
  ).run(phone, now - 60, 1_000_000, 100_000);
}

describe('GET /fragments/top-talkers', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    seed(db);
  });

  it('renders top talkers in descending bytes order', async () => {
    const res = await request(makeApp(db)).get('/fragments/top-talkers');
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    const rows = $('table.top-talkers tbody tr');
    expect(rows.length).toBe(2);
    expect($(rows[0]).text()).toContain('tv-living');
    expect($(rows[1]).text()).toContain('phone');
  });

  it('clicking a row swaps the detail panel via hx-get', async () => {
    const res = await request(makeApp(db)).get('/fragments/top-talkers');
    const $ = cheerio.load(res.text);
    const firstRow = $('table.top-talkers tbody tr').first();
    expect(firstRow.attr('hx-get')).toMatch(/^\/fragments\/device\/\d+$/);
    expect(firstRow.attr('hx-target')).toBe('#detail-panel');
  });

  it('accepts range=7d and range=30d, default is 24h', async () => {
    for (const r of ['24h', '7d', '30d']) {
      const res = await request(makeApp(db)).get(`/fragments/top-talkers?range=${r}`);
      expect(res.status).toBe(200);
      const $ = cheerio.load(res.text);
      expect($(`button.action.primary`).filter((_, el) => $(el).text().trim() === r).length).toBe(
        1,
      );
    }
  });

  it('rejects unknown range values by falling back to 24h', async () => {
    const res = await request(makeApp(db)).get('/fragments/top-talkers?range=garbage');
    const $ = cheerio.load(res.text);
    expect($('button.action.primary').first().text().trim()).toBe('24h');
  });

  it('renders an empty-state message when no device has bytes in the window', async () => {
    const fresh = new Database(':memory:');
    runMigrations(fresh);
    const res = await request(makeApp(fresh)).get('/fragments/top-talkers');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No traffic yet');
  });
});
