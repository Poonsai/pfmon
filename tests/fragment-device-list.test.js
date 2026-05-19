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
  db.prepare(`INSERT INTO interfaces (pfsense_name, friendly_name, kind, ipv4_subnet) VALUES
    ('lan','LAN','lan','10.0.0.0/24'),
    ('vlan20','IoT','vlan','10.20.0.0/24')`).run();
  const ifLan = db.prepare("SELECT id FROM interfaces WHERE pfsense_name='lan'").get().id;
  const ifIot = db.prepare("SELECT id FROM interfaces WHERE pfsense_name='vlan20'").get().id;
  db.prepare(`INSERT INTO devices
    (mac, vendor, hostname, nickname, current_ip, interface_id, is_online, first_seen_at, last_seen_at, new_until_seen_at)
    VALUES
    ('aa:bb:cc:dd:ee:01', 'LG', 'living-room-tv', NULL, '10.0.0.42', ?, 1, ?, ?, NULL),
    ('aa:bb:cc:dd:ee:02', 'Apple Inc.', NULL, 'jane-iphone', '10.0.0.51', ?, 1, ?, ?, NULL),
    ('aa:bb:cc:dd:ee:03', 'Espressif', 'unknown', NULL, '10.20.0.99', ?, 1, ?, ?, ?),
    ('aa:bb:cc:dd:ee:04', 'Amazon', 'echo-dot', NULL, '10.20.0.31', ?, 0, ?, ?, NULL)
  `).run(ifLan, now, now, ifLan, now, now, ifIot, now, now, now, ifIot, now - 7200, now - 7200);
  return db;
}

describe('GET /fragments/device-list', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    seed(db);
  });

  it('renders all devices by default', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list');
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    expect($('table.device-list tbody tr').length).toBe(4);
  });

  it('filters by status=online', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list?status=online');
    const $ = cheerio.load(res.text);
    expect($('table.device-list tbody tr').length).toBe(3);
  });

  it('filters by status=new', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list?status=new');
    const $ = cheerio.load(res.text);
    expect($('table.device-list tbody tr').length).toBe(1);
    expect($('table.device-list tbody tr').first().hasClass('new-device')).toBe(true);
  });

  it('filters by VLAN', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list?vlan=vlan20');
    const $ = cheerio.load(res.text);
    expect($('table.device-list tbody tr').length).toBe(2);
  });

  it('searches across nickname/hostname/ip/mac/vendor', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list?q=jane');
    const $ = cheerio.load(res.text);
    expect($('table.device-list tbody tr').length).toBe(1);
  });

  it('treats SQL LIKE wildcards in the search query as literals', async () => {
    // Regression: q=%25 (URL-encoded %) used to act as a SQL wildcard and
    // match every device. Same for "_" matching any single character.
    // We count device rows by looking for the [hx-get] attribute — the empty
    // "No devices match." placeholder row sits inside <tbody> too.
    const res = await request(makeApp(db)).get('/fragments/device-list?q=%25');
    const $ = cheerio.load(res.text);
    expect($('table.device-list tbody tr[hx-get]').length).toBe(0);
    expect(res.text).toContain('No devices match');

    const res2 = await request(makeApp(db)).get('/fragments/device-list?q=_');
    const $2 = cheerio.load(res2.text);
    expect($2('table.device-list tbody tr[hx-get]').length).toBe(0);
  });

  it('uses nickname when present, hostname otherwise', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list');
    expect(res.text).toContain('jane-iphone');
    expect(res.text).toContain('living-room-tv');
  });

  it('sorts by IP numerically, not lexicographically', async () => {
    // Regression: SQLite ORDER BY on a TEXT column does a string comparison,
    // so "10.0.0.10" used to sort BEFORE "10.0.0.9". The post-fetch JS sort
    // converts each address to a numeric key so the order matches a human's
    // expectation.
    const fresh = new Database(':memory:');
    runMigrations(fresh);
    const now = Math.floor(Date.now() / 1000);
    fresh
      .prepare(
        `INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES ('lan','LAN','lan')`,
      )
      .run();
    const ips = ['10.0.0.10', '10.0.0.9', '10.0.0.2', '10.0.0.100'];
    let macCounter = 1;
    for (const ip of ips) {
      const mac = `aa:bb:cc:dd:ee:${String(macCounter++).padStart(2, '0')}`;
      fresh
        .prepare(
          `INSERT INTO devices (mac, current_ip, is_online, first_seen_at, last_seen_at)
           VALUES (?, ?, 1, ?, ?)`,
        )
        .run(mac, ip, now, now);
    }

    const res = await request(makeApp(fresh)).get('/fragments/device-list?sort=ip');
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    const order = $('table.device-list tbody tr td:nth-child(2)')
      .toArray()
      .map((td) => $(td).text());
    expect(order).toEqual(['10.0.0.2', '10.0.0.9', '10.0.0.10', '10.0.0.100']);
  });

  it('sorts by bytes_today using current-hour samples not yet rolled up', async () => {
    // Add bytes only via traffic_samples (no hourly rollup yet).
    // Give jane-iphone (mac ee:02) a big sample, and echo-dot (ee:04) a tiny one.
    const janeId = db.prepare("SELECT id FROM devices WHERE mac='aa:bb:cc:dd:ee:02'").get().id;
    const echoId = db.prepare("SELECT id FROM devices WHERE mac='aa:bb:cc:dd:ee:04'").get().id;
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(janeId, now - 30, 50_000_000, 5_000_000);
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(echoId, now - 30, 100, 100);

    const res = await request(makeApp(db)).get('/fragments/device-list?sort=bytes_today');
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    const firstRow = $('table.device-list tbody tr').first();
    expect(firstRow.text()).toContain('jane-iphone');
  });

  it('renders the device_type_guess chip when set', async () => {
    db.prepare(`UPDATE devices SET device_type_guess='iPhone' WHERE mac='aa:bb:cc:dd:ee:02'`).run();
    const res = await request(makeApp(db)).get('/fragments/device-list');
    const $ = cheerio.load(res.text);
    const janeRow = $('table.device-list tbody tr').filter((_, el) =>
      $(el).text().includes('jane-iphone'),
    );
    expect(janeRow.find('.type-chip').text().trim()).toBe('iPhone');
  });

  it('omits the type chip when device_type_guess is null or "Unknown"', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list');
    const $ = cheerio.load(res.text);
    const echoRow = $('table.device-list tbody tr').filter((_, el) =>
      $(el).text().includes('echo-dot'),
    );
    expect(echoRow.find('.type-chip').length).toBe(0);
  });
});
