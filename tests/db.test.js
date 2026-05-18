import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    runMigrations(db);
    const count = db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get().c;
    expect(count).toBe(1);
    db.close();
  });
});
