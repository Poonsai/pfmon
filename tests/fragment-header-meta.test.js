import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
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

describe('GET /fragments/header-meta', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  it('returns counts and freshness', async () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO interfaces (pfsense_name, kind) VALUES ('lan','lan'),('wan','wan'),('vlan10','vlan')`,
    ).run();
    db.prepare(`INSERT INTO devices (mac, is_online, first_seen_at, last_seen_at) VALUES
      ('a', 1, ?, ?), ('b', 1, ?, ?), ('c', 0, ?, ?)`).run(
      now,
      now,
      now,
      now,
      now - 3600,
      now - 3600,
    );
    db.prepare(`INSERT INTO poll_log (ts, success, duration_ms) VALUES (?, 1, 10)`).run(now - 5);

    const res = await request(makeApp(db)).get('/fragments/header-meta');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/3 devices/);
    expect(res.text).toMatch(/2 online/);
    expect(res.text).toMatch(/1 VLAN/);
    expect(res.text).toMatch(/data \d+s old/);
  });

  it('says "never polled" when poll_log is empty', async () => {
    const res = await request(makeApp(db)).get('/fragments/header-meta');
    expect(res.text).toMatch(/never polled/i);
  });
});
