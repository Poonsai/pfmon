import { describe, it, expect } from 'vitest';
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

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('GET /fragments/alerts', () => {
  it('renders empty when no new devices and last poll succeeded', async () => {
    const db = setup();
    db.prepare(`INSERT INTO poll_log (ts, success) VALUES (?, 1)`).run(
      Math.floor(Date.now() / 1000),
    );
    const res = await request(makeApp(db)).get('/fragments/alerts');
    expect(res.status).toBe(200);
    expect(res.text.trim()).toBe('');
  });

  it('renders a yellow banner when there are new devices', async () => {
    const db = setup();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO devices (mac, vendor, hostname, current_ip, is_online, first_seen_at, last_seen_at, new_until_seen_at)
                VALUES ('aa:bb:cc:dd:ee:99', 'Espressif', 'unknown', '10.20.0.99', 1, ?, ?, ?)`).run(
      now,
      now,
      now,
    );
    const res = await request(makeApp(db)).get('/fragments/alerts');
    const $ = cheerio.load(res.text);
    expect($('.alerts-banner').length).toBe(1);
    expect($('.alerts-banner').hasClass('error')).toBe(false);
    expect(res.text).toMatch(/unknown|10\.20\.0\.99|Espressif/);
  });

  it('renders a red banner when last poll failed', async () => {
    const db = setup();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO poll_log (ts, success, error_msg) VALUES (?, 0, 'fetch failed')`).run(
      now,
    );
    const res = await request(makeApp(db)).get('/fragments/alerts');
    const $ = cheerio.load(res.text);
    expect($('.alerts-banner.error').length).toBe(1);
    expect(res.text).toMatch(/fetch failed/);
  });
});
