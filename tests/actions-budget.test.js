import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { buildActionsRouter } from '../src/routes/actions.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO devices (mac, is_online, first_seen_at, last_seen_at) VALUES ('a',1,?,?)`,
  ).run(now, now);
  const id = db.prepare("SELECT id FROM devices WHERE mac='a'").get().id;
  return { db, id };
}

function makeApp(db) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(buildActionsRouter({ db }));
  return app;
}

describe('PATCH /devices/:id/budget', () => {
  it('stores MB input as bytes', async () => {
    const { db, id } = setup();
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/budget`)
      .type('form')
      .send({ budget_mb: '500' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT daily_budget_bytes FROM devices WHERE id = ?').get(id);
    expect(row.daily_budget_bytes).toBe(500 * 1024 * 1024);
  });

  it('clears the budget when the value is blank', async () => {
    const { db, id } = setup();
    db.prepare('UPDATE devices SET daily_budget_bytes = ? WHERE id = ?').run(1_000_000_000, id);
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/budget`)
      .type('form')
      .send({ budget_mb: '' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT daily_budget_bytes FROM devices WHERE id = ?').get(id);
    expect(row.daily_budget_bytes).toBeNull();
  });

  it('rejects non-numeric input with 400', async () => {
    const { db, id } = setup();
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/budget`)
      .type('form')
      .send({ budget_mb: 'lots' });
    expect(res.status).toBe(400);
  });

  it('rejects negative numbers with 400', async () => {
    const { db, id } = setup();
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/budget`)
      .type('form')
      .send({ budget_mb: '-5' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for missing device', async () => {
    const { db } = setup();
    const res = await request(makeApp(db))
      .patch(`/devices/99999/budget`)
      .type('form')
      .send({ budget_mb: '100' });
    expect(res.status).toBe(404);
  });
});
