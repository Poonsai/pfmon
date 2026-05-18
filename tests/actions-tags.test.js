import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { buildActionsRouter } from '../src/routes/actions.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO devices (mac, is_online, first_seen_at, last_seen_at) VALUES ('a',1,?,?)`).run(now, now);
  return { db, id: db.prepare("SELECT id FROM devices WHERE mac='a'").get().id };
}

function makeApp(db) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(buildActionsRouter({ db }));
  return app;
}

describe('device tags', () => {
  it('POST adds a new tag and returns the updated tag list HTML', async () => {
    const { db, id } = setup();
    const res = await request(makeApp(db)).post(`/devices/${id}/tags`).type('form').send({ tag: 'iot' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('iot');
    const tags = db.prepare('SELECT tag FROM device_tags WHERE device_id = ?').all(id).map(r => r.tag);
    expect(tags).toContain('iot');
  });

  it('POST rejects empty tags', async () => {
    const { db, id } = setup();
    const res = await request(makeApp(db)).post(`/devices/${id}/tags`).type('form').send({ tag: '   ' });
    expect(res.status).toBe(400);
  });

  it('POST is idempotent (no duplicates)', async () => {
    const { db, id } = setup();
    await request(makeApp(db)).post(`/devices/${id}/tags`).type('form').send({ tag: 'iot' });
    await request(makeApp(db)).post(`/devices/${id}/tags`).type('form').send({ tag: 'iot' });
    const count = db.prepare('SELECT COUNT(*) c FROM device_tags WHERE device_id = ?').get(id).c;
    expect(count).toBe(1);
  });

  it('DELETE removes a tag and returns empty fragment', async () => {
    const { db, id } = setup();
    db.prepare(`INSERT INTO device_tags VALUES (?, 'iot')`).run(id);
    const res = await request(makeApp(db)).delete(`/devices/${id}/tags/iot`);
    expect(res.status).toBe(200);
    expect(res.text.trim()).toBe('');
    const tags = db.prepare('SELECT tag FROM device_tags WHERE device_id = ?').all(id);
    expect(tags).toEqual([]);
  });
});
