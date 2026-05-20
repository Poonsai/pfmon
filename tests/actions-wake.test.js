import { createSocket } from 'node:dgram';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { buildActionsRouter } from '../src/routes/actions.js';

describe('POST /devices/:id/wake', () => {
  let db, id, listener, port;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO devices (mac, is_online, first_seen_at, last_seen_at) VALUES ('aa:bb:cc:dd:ee:01',0,?,?)`,
    ).run(now, now);
    id = db.prepare("SELECT id FROM devices WHERE mac='aa:bb:cc:dd:ee:01'").get().id;
    listener = createSocket('udp4');
    await new Promise((resolve) => {
      listener.bind(0, '127.0.0.1', () => {
        port = listener.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise((r) => listener.close(r));
  });

  function makeApp() {
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(buildActionsRouter({ db, wolConfig: { broadcastAddr: '127.0.0.1', port } }));
    return app;
  }

  it('sends a magic packet and returns 200 with a status snippet', async () => {
    const received = new Promise((resolve) => listener.once('message', (msg) => resolve(msg)));
    const res = await request(makeApp()).post(`/devices/${id}/wake`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Magic packet sent');
    const msg = await received;
    expect(msg.length).toBe(102);
    expect(msg[6]).toBe(0xaa);
    expect(msg[11]).toBe(0x01);
  });

  it('returns 404 for an unknown device id', async () => {
    const res = await request(makeApp()).post(`/devices/99999/wake`);
    expect(res.status).toBe(404);
  });

  it('returns 500 when the configured broadcast address is unresolvable', async () => {
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(
      buildActionsRouter({
        db,
        wolConfig: { broadcastAddr: 'not.a.host.example.invalid', port: 9 },
      }),
    );
    const res = await request(app).post(`/devices/${id}/wake`);
    expect(res.status).toBe(500);
  });
});
