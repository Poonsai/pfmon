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
  db.prepare(`INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES ('wan', 'WAN', 'wan')`).run();
  const wanId = db.prepare("SELECT id FROM interfaces WHERE pfsense_name='wan'").get().id;
  const dayStart = now - 24 * 3600;
  for (let i = 0; i < 24; i++) {
    const hour = dayStart + i * 3600;
    db.prepare(`INSERT INTO interface_traffic_hourly (interface_id, hour_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
                VALUES (?, ?, ?, ?, ?, ?)`).run(wanId, hour, 1000 * (i + 1), 200 * (i + 1), 100, 30);
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
});
