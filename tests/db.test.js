import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, runMigrations } from '../src/db.js';

const tmpPath = () => join(tmpdir(), `pfmon-test-${Date.now()}-${Math.random()}.db`);

describe('db', () => {
  const created = [];
  afterEach(() => {
    for (const p of created) {
      if (existsSync(p)) rmSync(p);
      if (existsSync(`${p}-shm`)) rmSync(`${p}-shm`);
      if (existsSync(`${p}-wal`)) rmSync(`${p}-wal`);
    }
    created.length = 0;
  });

  it('opens a database in WAL mode', () => {
    const path = tmpPath();
    created.push(path);
    const db = openDb(path);
    const mode = db.pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');
    db.close();
  });

  it('runs migrations and records the version', () => {
    const path = tmpPath();
    created.push(path);
    const db = openDb(path);
    runMigrations(db);
    const rows = db.prepare('SELECT version FROM schema_migrations').all();
    expect(rows.map((r) => r.version)).toContain('001_init');
    db.close();
  });

  it('is idempotent when migrations are run twice', () => {
    const path = tmpPath();
    created.push(path);
    const db = openDb(path);
    runMigrations(db);
    const firstCount = db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get().c;
    runMigrations(db);
    const secondCount = db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get().c;
    expect(secondCount).toBe(firstCount);
    expect(firstCount).toBeGreaterThan(0);
    db.close();
  });

  it('migration 002 adds daily_budget_bytes column and budget_alerts table', () => {
    const path = tmpPath();
    created.push(path);
    const db = openDb(path);
    runMigrations(db);
    const cols = db
      .prepare('PRAGMA table_info(devices)')
      .all()
      .map((c) => c.name);
    expect(cols).toContain('daily_budget_bytes');
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='budget_alerts'",
      )
      .all();
    expect(tables.length).toBe(1);
    const baCols = db
      .prepare('PRAGMA table_info(budget_alerts)')
      .all()
      .map((c) => c.name);
    expect(baCols).toEqual(expect.arrayContaining(['device_id', 'day_bucket', 'alerted_at']));
    db.close();
  });
});
