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

describe('PATCH /devices/:id/notes', () => {
  it('updates notes and returns the fragment', async () => {
    const { db, id } = setup();
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/notes`)
      .type('form')
      .send({ notes: 'Living room' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Living room');
    expect(db.prepare('SELECT notes FROM devices WHERE id=?').get(id).notes).toBe('Living room');
  });

  it('clears notes when blank', async () => {
    const { db, id } = setup();
    db.prepare('UPDATE devices SET notes = ? WHERE id = ?').run('old', id);
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/notes`)
      .type('form')
      .send({ notes: '' });
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT notes FROM devices WHERE id=?').get(id).notes).toBeNull();
  });
});
