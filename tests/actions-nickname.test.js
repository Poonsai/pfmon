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

describe('PATCH /devices/:id/nickname', () => {
  it('updates the nickname and returns the new <dd> fragment', async () => {
    const { db, id } = setup();
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/nickname`)
      .type('form')
      .send({ nickname: 'living-room-tv' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('living-room-tv');
    const row = db.prepare('SELECT nickname FROM devices WHERE id = ?').get(id);
    expect(row.nickname).toBe('living-room-tv');
  });

  it('clears the nickname when blank', async () => {
    const { db, id } = setup();
    db.prepare('UPDATE devices SET nickname = ? WHERE id = ?').run('old', id);
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/nickname`)
      .type('form')
      .send({ nickname: '' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT nickname FROM devices WHERE id = ?').get(id);
    expect(row.nickname).toBeNull();
  });

  it('returns 404 for missing device', async () => {
    const { db } = setup();
    const res = await request(makeApp(db))
      .patch(`/devices/99999/nickname`)
      .type('form')
      .send({ nickname: 'x' });
    expect(res.status).toBe(404);
  });
});
