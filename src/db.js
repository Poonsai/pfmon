import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function openDb(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function splitStatements(sql) {
  return sql
    .split(/;\s*\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));
}

function runStatements(db, sql) {
  for (const stmt of splitStatements(sql)) {
    if (stmt.toUpperCase().startsWith('PRAGMA')) {
      db.pragma(stmt.replace(/^PRAGMA\s+/i, ''));
      continue;
    }
    db.prepare(stmt).run();
  }
}

export function runMigrations(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `).run();
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => r.version),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const tx = db.transaction((file) => {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) return;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    runStatements(db, sql);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      version,
      Math.floor(Date.now() / 1000),
    );
  });
  for (const f of files) tx(f);
}
