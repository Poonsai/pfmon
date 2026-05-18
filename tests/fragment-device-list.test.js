import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

  it('uses nickname when present, hostname otherwise', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list');
    expect(res.text).toContain('jane-iphone');
    expect(res.text).toContain('living-room-tv');
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
});
