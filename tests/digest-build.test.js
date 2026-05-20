import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { buildDigestSummary } from '../src/poller/digest.js';

const NOW = 1_700_000_000;

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('buildDigestSummary', () => {
  it('returns hasContent=false on a freshly-migrated empty database', () => {
    const db = fresh();
    const result = buildDigestSummary(db, { now: NOW });
    expect(result.hasContent).toBe(false);
  });

  it('lists devices first seen in last 24h', () => {
    const db = fresh();
    db.prepare(
      `INSERT INTO devices (mac, hostname, current_ip, is_online, first_seen_at, last_seen_at, device_type_guess)
       VALUES ('a','tv','10.0.0.1',1,?,?,'Smart TV')`,
    ).run(NOW - 3600, NOW);
    const { summary, hasContent } = buildDigestSummary(db, { now: NOW });
    expect(hasContent).toBe(true);
    expect(summary).toMatch(/New devices/);
    expect(summary).toMatch(/tv/);
    expect(summary).toMatch(/Smart TV/);
  });

  it('lists devices that went silent (online flag off, last_seen >24h ago)', () => {
    const db = fresh();
    db.prepare(
      `INSERT INTO devices (mac, hostname, current_ip, is_online, first_seen_at, last_seen_at)
       VALUES ('b','phone','10.0.0.2',0,?,?)`,
    ).run(NOW - 86400 * 7, NOW - 86400 - 3600);
    const { summary, hasContent } = buildDigestSummary(db, { now: NOW });
    expect(hasContent).toBe(true);
    expect(summary).toMatch(/silent|offline/i);
    expect(summary).toMatch(/phone/);
  });

  it('lists top 3 bandwidth movers in last 24h', () => {
    const db = fresh();
    const insDev = db.prepare(
      `INSERT INTO devices (mac, hostname, current_ip, is_online, first_seen_at, last_seen_at) VALUES (?, ?, ?, 1, ?, ?)`,
    );
    const insSample = db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    );
    for (let i = 1; i <= 5; i++) {
      insDev.run(`m${i}`, `dev${i}`, `10.0.0.${i}`, NOW - 86400 * 30, NOW);
      const id = db.prepare('SELECT id FROM devices WHERE mac=?').get(`m${i}`).id;
      insSample.run(id, NOW - 60, (6 - i) * 100_000_000, 0);
    }
    const { summary } = buildDigestSummary(db, { now: NOW });
    expect(summary).toMatch(/dev1/);
    expect(summary).toMatch(/dev2/);
    expect(summary).toMatch(/dev3/);
    expect(summary).not.toMatch(/dev4/);
  });

  it('reports WAN poll failures in the last 24h', () => {
    const db = fresh();
    const ins = db.prepare(
      `INSERT INTO poll_log (ts, success, duration_ms, error_msg) VALUES (?, ?, ?, ?)`,
    );
    for (let i = 0; i < 3; i++) ins.run(NOW - i * 60, 0, 1000, 'boom');
    const { summary, hasContent } = buildDigestSummary(db, { now: NOW });
    expect(hasContent).toBe(true);
    expect(summary).toMatch(/poll failures: 3/i);
  });
});
