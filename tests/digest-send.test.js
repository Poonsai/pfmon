import Database from 'better-sqlite3';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { maybeSendDigest } from '../src/poller/digest.js';

let okServer, okTopicUrl, received;

beforeAll(async () => {
  received = [];
  await new Promise((resolve) => {
    const app = express();
    app.use(express.text({ type: '*/*' }));
    app.post('/topic', (req, res) => {
      received.push({ body: req.body, headers: req.headers });
      res.send('ok');
    });
    okServer = app.listen(0, () => {
      okTopicUrl = `http://127.0.0.1:${okServer.address().port}/topic`;
      resolve();
    });
  });
});
afterAll(async () => {
  await new Promise((r) => okServer.close(r));
});

function seeded() {
  const db = new Database(':memory:');
  runMigrations(db);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO devices (mac, hostname, current_ip, is_online, first_seen_at, last_seen_at)
     VALUES ('aa','tv','10.0.0.1',1,?,?)`,
  ).run(now - 3600, now);
  return { db, now };
}

function hourOf(now) {
  return new Date(now * 1000).getHours();
}

describe('maybeSendDigest', () => {
  it('skips when digestHour is null', async () => {
    received.length = 0;
    const { db, now } = seeded();
    await maybeSendDigest(db, { topicUrl: okTopicUrl, now, digestHour: null });
    expect(received).toHaveLength(0);
  });

  it('skips when topicUrl is empty', async () => {
    received.length = 0;
    const { db, now } = seeded();
    await maybeSendDigest(db, { topicUrl: '', now, digestHour: hourOf(now) });
    expect(received).toHaveLength(0);
  });

  it('skips when current hour does not match digestHour', async () => {
    received.length = 0;
    const { db, now } = seeded();
    const wrongHour = (hourOf(now) + 1) % 24;
    await maybeSendDigest(db, { topicUrl: okTopicUrl, now, digestHour: wrongHour });
    expect(received).toHaveLength(0);
  });

  it('sends a digest when hour matches and digest is non-empty', async () => {
    received.length = 0;
    const { db, now } = seeded();
    await maybeSendDigest(db, { topicUrl: okTopicUrl, now, digestHour: hourOf(now) });
    expect(received).toHaveLength(1);
    expect(received[0].body).toMatch(/pfmon daily digest/);
    expect(received[0].body).toMatch(/tv/);
    const rows = db.prepare('SELECT * FROM digest_log').all();
    expect(rows.length).toBe(1);
  });

  it('does not re-send if a digest row already exists for today', async () => {
    received.length = 0;
    const { db, now } = seeded();
    const dayBucket = Math.floor(now / 86400) * 86400;
    db.prepare('INSERT INTO digest_log (day_bucket, sent_at, summary) VALUES (?, ?, ?)').run(
      dayBucket,
      now - 60,
      'already',
    );
    await maybeSendDigest(db, { topicUrl: okTopicUrl, now, digestHour: hourOf(now) });
    expect(received).toHaveLength(0);
  });

  it('skips when hasContent is false even if hour matches', async () => {
    received.length = 0;
    const db = new Database(':memory:');
    runMigrations(db);
    const now = Math.floor(Date.now() / 1000);
    await maybeSendDigest(db, { topicUrl: okTopicUrl, now, digestHour: hourOf(now) });
    expect(received).toHaveLength(0);
    const rows = db.prepare('SELECT * FROM digest_log').all();
    expect(rows.length).toBe(0);
  });
});
