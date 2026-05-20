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
    `INSERT INTO interfaces (pfsense_name, friendly_name, kind, ipv4_subnet) VALUES ('lan','LAN','lan','10.0.0.0/24')`,
  ).run();
  const ifLan = db.prepare("SELECT id FROM interfaces WHERE pfsense_name='lan'").get().id;
  const info = db
    .prepare(`INSERT INTO devices
    (mac, vendor, hostname, nickname, notes, device_type_guess, current_ip, current_ipv6, interface_id,
     current_lease_type, current_lease_expires_at, is_online, first_seen_at, last_seen_at)
    VALUES ('aa:bb:cc:dd:ee:01', 'LG', 'living-room-tv', NULL, 'WebOS TV', 'Smart TV',
      '10.0.0.42', 'fe80::1', ?, 'dynamic', ?, 1, ?, ?)
  `)
    .run(ifLan, now + 3600, now - 86400 * 30, now);
  const id = info.lastInsertRowid;
  db.prepare(`INSERT INTO device_tags VALUES (?, 'iot'), (?, 'tv')`).run(id, id);
  db.prepare(`INSERT INTO geo_connections VALUES (?, 'US', ?, 42), (?, 'KR', ?, 8)`).run(
    id,
    now,
    id,
    now - 3600,
  );
  return { db, id };
}

describe('GET /fragments/device/:id', () => {
  let db, id;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    ({ id } = seed(db));
  });

  it('returns 404 for missing device', async () => {
    const res = await request(makeApp(db)).get('/fragments/device/99999');
    expect(res.status).toBe(404);
  });

  it('renders nickname-or-hostname title and all key fields', async () => {
    const res = await request(makeApp(db)).get(`/fragments/device/${id}`);
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    expect($('h2').text()).toContain('living-room-tv');
    expect(res.text).toContain('10.0.0.42');
    expect(res.text).toContain('aa:bb:cc:dd:ee:01');
    expect(res.text).toContain('LG');
    expect(res.text).toContain('Smart TV');
    expect(res.text).toContain('iot');
    expect(res.text).toContain('tv');
    expect(res.text).toContain('US');
  });

  it('uses nickname as title when present', async () => {
    db.prepare(`UPDATE devices SET nickname='TV in living room' WHERE id = ?`).run(id);
    const res = await request(makeApp(db)).get(`/fragments/device/${id}`);
    const $ = cheerio.load(res.text);
    expect($('h2').text()).toContain('TV in living room');
  });

  it('includes current-hour samples in today/week totals before the rollup has fired', async () => {
    // No rollup yet — only raw samples exist for the device.
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(id, now - 60, 4_000_000, 1_000_000);
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(id, now - 30, 6_000_000, 1_000_000);
    expect(db.prepare('SELECT COUNT(*) c FROM traffic_hourly').get().c).toBe(0);

    const res = await request(makeApp(db)).get(`/fragments/device/${id}`);
    expect(res.status).toBe(200);
    // Today rx = 10 MB. Should appear somewhere in the rendered detail page.
    expect(res.text).toMatch(/9\.5 MB/);
  });

  it('converts the latest sample delta into a per-second rate for the "/s" label', async () => {
    // Regression: the bandwidth-now field rendered raw sample deltas labeled
    // "/s", which lies — a sample's rx_bytes/tx_bytes is bytes-this-interval,
    // not bytes-per-second. Two samples 30s apart with 600B / 300B in the
    // latest one should render as 20 B/s down and 10 B/s up.
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, 0, 0, 0)`,
    ).run(id, now - 30);
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(id, now, 600, 300);

    const res = await request(makeApp(db)).get(`/fragments/device/${id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Down: 20 B/s');
    expect(res.text).toContain('Up: 10 B/s');
  });

  it('renders a Wake button wired to the wake endpoint', async () => {
    const res = await request(makeApp(db)).get(`/fragments/device/${id}`);
    const $ = cheerio.load(res.text);
    const btn = $(`button[hx-post="/devices/${id}/wake"]`);
    expect(btn.length).toBe(1);
    expect(btn.text().toLowerCase()).toContain('wake');
    expect($('.wake-status').length).toBe(1);
  });
});
