import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { buildPageRouter } from '../src/routes/page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, '..', 'src', 'views'));
  app.use(buildPageRouter({ db }));
  return app;
}

describe('GET / VLAN options', () => {
  it('renders <option> elements for each non-WAN interface', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES
      ('wan','WAN','wan'),
      ('lan','LAN','lan'),
      ('vlan20','IoT','vlan'),
      ('vlan30','Guest','vlan')`).run();
    const res = await request(makeApp(db)).get('/');
    const $ = cheerio.load(res.text);
    const opts = $('select[name="vlan"] option')
      .toArray()
      .map((o) => $(o).text());
    expect(opts).toContain('VLAN: All');
    expect(opts).toContain('LAN');
    expect(opts).toContain('IoT');
    expect(opts).toContain('Guest');
    expect(opts).not.toContain('WAN');
  });
});
