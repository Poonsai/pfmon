import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { buildActionsRouter } from '../src/routes/actions.js';

function makeApp(db) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(buildActionsRouter({ db }));
  return app;
}

describe('POST /devices/:id/dismiss-new', () => {
  it('clears new_until_seen_at and returns empty body', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO devices (mac, is_online, first_seen_at, last_seen_at, new_until_seen_at) VALUES ('a',1,?,?,?)`).run(now, now, now);
    const id = db.prepare("SELECT id FROM devices WHERE mac='a'").get().id;
    const res = await request(makeApp(db)).post(`/devices/${id}/dismiss-new`);
    expect(res.status).toBe(200);
    expect(res.text.trim()).toBe('');
    expect(db.prepare('SELECT new_until_seen_at FROM devices WHERE id=?').get(id).new_until_seen_at).toBeNull();
  });
});
