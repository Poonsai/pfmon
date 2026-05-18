# pfmon Plan 1: Foundation and Ingestion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of pfmon — a Node.js + Express service that polls a pfSense REST API every 30s, ingests device/interface/traffic/firewall data into SQLite, fires ntfy.sh alerts for new devices, and exposes `/api/health`. No user-facing dashboard in this plan; that comes in Plan 2.

**Architecture:** Single Docker container running Node 20. Inside: an Express app currently exposing only `/api/health`, a node-cron scheduler that orchestrates a 30-second poll, and SQLite (WAL mode) at `/data/pfmon.db`. The poller fetches from pfSense via `fetch()` with `X-API-Key` auth, builds a per-MAC snapshot, reconciles against the DB inside a single transaction, fires ntfy.sh pushes for new devices (after a grace period), runs hourly + daily rollups, and logs each tick to `poll_log`.

**Tech Stack:** Node 20 (ESM), Express 5, better-sqlite3, node-cron, vitest, supertest, Husky 9, @commitlint/cli, undici (for TLS-configurable fetch agent).

**End-of-plan milestone:** `docker compose up -d` against a real pfSense (with `PFSENSE_API_KEY` set) fills `data/pfmon.db` with devices, interfaces, uptime events, traffic samples, and (optionally) firewall blocks and geo tallies. `curl http://localhost:8080/api/health` returns 200. CI is green. The next plan adds the web dashboard.

---

## Phase A — Project scaffolding

### Task A1: Initialize `package.json` and install dependencies

**Files:**
- Create: `package.json`

- [ ] **Step 1: Initialize npm project**

Run from project root:

```bash
npm init -y
```

- [ ] **Step 2: Replace `package.json` with ESM-aware Node 20 config**

```json
{
  "name": "pfmon",
  "version": "0.1.0",
  "description": "Self-hosted pfSense network device monitor dashboard",
  "type": "module",
  "main": "src/index.js",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "start": "node src/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "fetch-data": "node scripts/fetch-data.js",
    "prepare": "husky"
  },
  "keywords": ["pfsense", "network", "monitoring", "dashboard"],
  "author": "",
  "license": "MIT"
}
```

- [ ] **Step 3: Install runtime dependencies**

```bash
npm install express@^5 better-sqlite3 node-cron undici
```

- [ ] **Step 4: Install dev dependencies**

```bash
npm install -D vitest supertest cheerio husky @commitlint/cli @commitlint/config-conventional
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: scaffold package.json with Express, sqlite, vitest"
```

---

### Task A2: Add `LICENSE` (MIT)

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Write the MIT license**

Create `LICENSE`:

```
MIT License

Copyright (c) 2026 Poonsai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

### Task A3: Create `.env.example`

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Write the env template**

```env
PFSENSE_URL=https://pfsense.lan
PFSENSE_API_KEY=replace_me
PFSENSE_VERIFY_TLS=true
POLL_INTERVAL_SECONDS=30
NTFY_TOPIC_URL=
NEW_DEVICE_GRACE_MINUTES=5
DB_PATH=/data/pfmon.db
PORT=8080
LOG_LEVEL=info
WAN_INTERFACE_NAME=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add .env.example with all config knobs"
```

---

### Task A4: Minimal Express entrypoint with `/api/health`

**Files:**
- Create: `src/index.js`
- Create: `src/health.js`

- [ ] **Step 1: Create `src/health.js`**

```js
export function buildHealthRouter() {
  return (req, res) => {
    res.json({ status: 'ok', version: process.env.npm_package_version });
  };
}
```

- [ ] **Step 2: Create `src/index.js`**

```js
import express from 'express';
import { buildHealthRouter } from './health.js';

const app = express();
const port = Number(process.env.PORT ?? 8080);

app.get('/api/health', buildHealthRouter());

const server = app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'http listening', port }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', msg: 'shutdown', signal }));
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

- [ ] **Step 3: Boot locally and probe**

```bash
node src/index.js &
SERVER_PID=$!
sleep 1
curl -s http://localhost:8080/api/health
kill $SERVER_PID
```

Expected stdout: `{"status":"ok","version":"0.1.0"}`

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: minimal Express server with /api/health endpoint"
```

---

### Task A5: Add vitest + a route test for `/api/health`

**Files:**
- Create: `vitest.config.js`
- Create: `tests/health.test.js`

- [ ] **Step 1: Write `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 2: Write the failing test `tests/health.test.js`**

```js
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { buildHealthRouter } from '../src/health.js';

describe('GET /api/health', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.get('/api/health', buildHealthRouter());
  });
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
```

- [ ] **Step 3: Run the test**

```bash
npm test
```

Expected: 1 test passed.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.js tests/
git commit -m "test: route test for /api/health"
```

---

### Task A6: Husky + commitlint to enforce Conventional Commits

**Files:**
- Create: `commitlint.config.cjs`
- Create: `.husky/commit-msg`

- [ ] **Step 1: Initialize Husky**

```bash
npx husky init
rm .husky/pre-commit
```

- [ ] **Step 2: Create `commitlint.config.cjs`**

```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
```

- [ ] **Step 3: Create `.husky/commit-msg`**

File content (single line):

```
npx --no -- commitlint --edit "$1"
```

Then make it executable:

```bash
chmod +x .husky/commit-msg
```

- [ ] **Step 4: Verify enforcement**

```bash
git commit --allow-empty -m "broken commit message"
```

Expected: commitlint exits non-zero with an error.

- [ ] **Step 5: Commit (using valid Conventional message)**

```bash
git add commitlint.config.cjs .husky/
git commit -m "chore: enforce Conventional Commits via Husky + commitlint"
```

---

### Task A7: `.dockerignore` and multi-stage `Dockerfile`

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
.git
.github
data
*.db
*.db-shm
*.db-wal
.env
.env.*
*.log
coverage
tests
docs
.superpowers
.husky
.vscode
.idea
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

RUN apk add --no-cache curl ca-certificates \
 && node scripts/fetch-data.js \
 && apk del curl

FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S pfmon && adduser -S pfmon -G pfmon \
 && mkdir -p /data && chown pfmon:pfmon /data

COPY --from=builder --chown=pfmon:pfmon /build/node_modules ./node_modules
COPY --from=builder --chown=pfmon:pfmon /build/src ./src
COPY --from=builder --chown=pfmon:pfmon /build/scripts ./scripts
COPY --from=builder --chown=pfmon:pfmon /build/data ./data
COPY --chown=pfmon:pfmon package.json ./

USER pfmon
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/api/health || exit 1

CMD ["node", "src/index.js"]
```

- [ ] **Step 3: Commit (build will not yet succeed without scripts/fetch-data.js — added in Task C1)**

```bash
git add Dockerfile .dockerignore
git commit -m "build: multi-stage Dockerfile with non-root pfmon user"
```

---

### Task A8: `docker-compose.yml`

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  pfmon:
    build: .
    image: ghcr.io/poonsai/pfmon:latest
    container_name: pfmon
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    environment:
      PFSENSE_URL: ${PFSENSE_URL}
      PFSENSE_API_KEY: ${PFSENSE_API_KEY}
      PFSENSE_VERIFY_TLS: ${PFSENSE_VERIFY_TLS:-true}
      POLL_INTERVAL_SECONDS: ${POLL_INTERVAL_SECONDS:-30}
      NTFY_TOPIC_URL: ${NTFY_TOPIC_URL:-}
      NEW_DEVICE_GRACE_MINUTES: ${NEW_DEVICE_GRACE_MINUTES:-5}
      DB_PATH: /data/pfmon.db
      PORT: 8080
      LOG_LEVEL: ${LOG_LEVEL:-info}
      WAN_INTERFACE_NAME: ${WAN_INTERFACE_NAME:-}
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "build: docker-compose with env wiring"
```

---

### Task A9: CI workflow `.github/workflows/ci.yml`

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the CI workflow**

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test

  docker-build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build image (no push)
        uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          load: true
          tags: pfmon:ci
      - name: Smoke test
        run: |
          docker run -d --name pfmon-ci -p 8080:8080 pfmon:ci
          for i in 1 2 3 4 5 6 7 8 9 10; do
            sleep 1
            if curl -sf http://localhost:8080/api/health > /dev/null; then
              echo "healthcheck ok"
              exit 0
            fi
          done
          docker logs pfmon-ci
          exit 1
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add test + docker build smoke workflow"
git push
```

- [ ] **Step 3: Verify CI runs**

Open https://github.com/Poonsai/pfmon/actions and confirm the workflow runs. The `docker-build` job will fail until later tasks land the data-fetch script and the rest of the source files.

---

## Phase B — Database layer

### Task B1: SQL migration `001_init.sql`

**Files:**
- Create: `src/migrations/001_init.sql`

Includes user-facing tables plus two helper tables (`device_counter_state`, `interface_counter_state`) that store the previous tick's raw byte totals for delta computation in the reconciliation step.

- [ ] **Step 1: Write the full schema**

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS interfaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pfsense_name TEXT NOT NULL UNIQUE,
  friendly_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('wan','lan','opt','vlan')),
  vlan_tag INTEGER,
  ipv4_subnet TEXT,
  ipv6_prefix TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac TEXT NOT NULL UNIQUE,
  vendor TEXT,
  hostname TEXT,
  nickname TEXT,
  notes TEXT,
  device_type_guess TEXT,
  current_ip TEXT,
  current_ipv6 TEXT,
  interface_id INTEGER REFERENCES interfaces(id) ON DELETE SET NULL,
  current_lease_type TEXT,
  current_lease_expires_at INTEGER,
  is_online INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  new_until_seen_at INTEGER,
  alerted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen_at);

CREATE TABLE IF NOT EXISTS device_tags (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (device_id, tag)
);

CREATE TABLE IF NOT EXISTS uptime_events (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('online','offline'))
);
CREATE INDEX IF NOT EXISTS idx_uptime_device_ts ON uptime_events(device_id, ts);

CREATE TABLE IF NOT EXISTS traffic_samples (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  states_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_traffic_samples_device_ts ON traffic_samples(device_id, ts);

CREATE TABLE IF NOT EXISTS traffic_hourly (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  hour_bucket INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  peak_rx_rate INTEGER,
  peak_tx_rate INTEGER,
  PRIMARY KEY (device_id, hour_bucket)
);

CREATE TABLE IF NOT EXISTS traffic_daily (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  day_bucket INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  peak_rx_rate INTEGER,
  peak_tx_rate INTEGER,
  PRIMARY KEY (device_id, day_bucket)
);

CREATE TABLE IF NOT EXISTS interface_traffic_samples (
  interface_id INTEGER NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER
);
CREATE INDEX IF NOT EXISTS idx_interface_traffic_samples ON interface_traffic_samples(interface_id, ts);

CREATE TABLE IF NOT EXISTS interface_traffic_hourly (
  interface_id INTEGER NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
  hour_bucket INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  peak_rx_rate INTEGER,
  peak_tx_rate INTEGER,
  PRIMARY KEY (interface_id, hour_bucket)
);

CREATE TABLE IF NOT EXISTS interface_traffic_daily (
  interface_id INTEGER NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
  day_bucket INTEGER NOT NULL,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  peak_rx_rate INTEGER,
  peak_tx_rate INTEGER,
  PRIMARY KEY (interface_id, day_bucket)
);

CREATE TABLE IF NOT EXISTS firewall_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  src_ip TEXT,
  src_port INTEGER,
  dst_ip TEXT,
  dst_port INTEGER,
  proto TEXT,
  direction TEXT,
  dedupe_hash TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_fwblocks_device_ts ON firewall_blocks(device_id, ts);

CREATE TABLE IF NOT EXISTS geo_connections (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (device_id, country_code)
);

CREATE TABLE IF NOT EXISTS poll_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  success INTEGER NOT NULL,
  duration_ms INTEGER,
  error_msg TEXT
);
CREATE INDEX IF NOT EXISTS idx_poll_log_ts ON poll_log(ts);

CREATE TABLE IF NOT EXISTS device_counter_state (
  device_id INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  rx_total INTEGER NOT NULL,
  tx_total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS interface_counter_state (
  interface_id INTEGER PRIMARY KEY REFERENCES interfaces(id) ON DELETE CASCADE,
  rx_total INTEGER NOT NULL,
  tx_total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Commit**

```bash
git add src/migrations/001_init.sql
git commit -m "feat: initial SQLite schema covering devices, traffic, blocks, geo, counters"
```

---

### Task B2: `db.js` connection + statement-split migration runner

**Files:**
- Create: `src/db.js`
- Create: `tests/db.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
      if (existsSync(p + '-shm')) rmSync(p + '-shm');
      if (existsSync(p + '-wal')) rmSync(p + '-wal');
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
    expect(rows.map(r => r.version)).toContain('001_init');
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- tests/db.test.js
```

- [ ] **Step 3: Implement `src/db.js`**

The migration runner splits the SQL file on semicolons (none of our migration SQL contains semicolons inside string literals) and runs each statement individually via `prepare(...).run()`.

```js
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
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
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
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  const tx = db.transaction((file) => {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) return;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    runStatements(db, sql);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(version, Math.floor(Date.now() / 1000));
  });
  for (const f of files) tx(f);
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/db.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/db.test.js
git commit -m "feat: db connection with WAL + statement-split migrations runner"
```

---

## Phase C — pfSense client and utility modules

### Task C1: Data-fetch script `scripts/fetch-data.js`

**Files:**
- Create: `scripts/fetch-data.js`

Downloads the IEEE OUI table and the db-ip Lite Country DB at build time. The OUI and GeoIP modules read those files at runtime.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

const OUI_URL = 'https://standards-oui.ieee.org/oui/oui.csv';
const OUI_PATH = join(DATA_DIR, 'oui.csv');

const now = new Date();
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const yyyy = lastMonth.getFullYear();
const mm = String(lastMonth.getMonth() + 1).padStart(2, '0');
const GEO_URL = `https://download.db-ip.com/free/dbip-country-lite-${yyyy}-${mm}.csv.gz`;
const GEO_PATH = join(DATA_DIR, 'dbip-country-lite.csv');

async function downloadGz(url, outPath) {
  console.log(`[fetch-data] GET ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  await pipeline(res.body, createGunzip(), createWriteStream(outPath));
  console.log(`[fetch-data] wrote ${outPath}`);
}

async function download(url, outPath) {
  console.log(`[fetch-data] GET ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  await pipeline(res.body, createWriteStream(outPath));
  console.log(`[fetch-data] wrote ${outPath}`);
}

if (existsSync(OUI_PATH) && existsSync(GEO_PATH)) {
  console.log('[fetch-data] data files already present, skipping');
  process.exit(0);
}

await download(OUI_URL, OUI_PATH);
await downloadGz(GEO_URL, GEO_PATH);
console.log('[fetch-data] done');
```

- [ ] **Step 2: Smoke-run locally**

```bash
node scripts/fetch-data.js
ls -lah data/oui.csv data/dbip-country-lite.csv
```

Expected: `data/oui.csv` ~10MB; `data/dbip-country-lite.csv` ~3MB.

- [ ] **Step 3: Verify Docker builder stage succeeds**

```bash
docker build --target builder -t pfmon:builder-check .
```

Expected: build completes.

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-data.js
git commit -m "build: fetch-data script for OUI + db-ip Lite Country DB"
```

---

### Task C2: `src/poller/oui.js` (MAC vendor lookup)

**Files:**
- Create: `src/poller/oui.js`
- Create: `tests/oui.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { loadOui, lookupVendor } from '../src/poller/oui.js';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('oui', () => {
  it('looks up vendor by MAC prefix', () => {
    const fixture = join(tmpdir(), `oui-${Date.now()}.csv`);
    writeFileSync(fixture,
      'Registry,Assignment,Organization Name,Organization Address\n' +
      'MA-L,001CB3,Apple Inc.,1 Infinite Loop\n' +
      'MA-L,28EF01,Espressif Inc.,addr\n'
    );
    const map = loadOui(fixture);
    expect(lookupVendor(map, '00:1c:b3:aa:bb:cc')).toBe('Apple Inc.');
    expect(lookupVendor(map, '28-EF-01-11-22-33')).toBe('Espressif Inc.');
    expect(lookupVendor(map, '11:22:33:44:55:66')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/oui.test.js
```

- [ ] **Step 3: Implement `src/poller/oui.js`**

```js
import { readFileSync } from 'node:fs';

export function loadOui(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = parseCsvLine(line);
    if (parts.length < 3) continue;
    const assignment = parts[1].toUpperCase().replace(/[^0-9A-F]/g, '');
    if (assignment.length !== 6) continue;
    map.set(assignment, parts[2]);
  }
  return map;
}

export function lookupVendor(map, mac) {
  if (!mac) return null;
  const prefix = mac.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 6);
  if (prefix.length !== 6) return null;
  return map.get(prefix) ?? null;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else { cur += c; }
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') { inQuote = true; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out;
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/oui.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/poller/oui.js tests/oui.test.js
git commit -m "feat: MAC vendor (OUI) lookup module"
```

---

### Task C3: `src/poller/geoip.js` (offline IP-to-country lookup)

**Files:**
- Create: `src/poller/geoip.js`
- Create: `tests/geoip.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { loadGeoIp, lookupCountry } from '../src/poller/geoip.js';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('geoip', () => {
  it('looks up country by IPv4', () => {
    const fixture = join(tmpdir(), `geo-${Date.now()}.csv`);
    writeFileSync(fixture,
      '8.8.8.0,8.8.8.255,US\n' +
      '1.1.1.0,1.1.1.255,AU\n' +
      '192.0.2.0,192.0.2.255,XX\n'
    );
    const idx = loadGeoIp(fixture);
    expect(lookupCountry(idx, '8.8.8.8')).toBe('US');
    expect(lookupCountry(idx, '1.1.1.42')).toBe('AU');
    expect(lookupCountry(idx, '203.0.113.5')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/geoip.test.js
```

- [ ] **Step 3: Implement `src/poller/geoip.js`**

```js
import { readFileSync } from 'node:fs';

function ipv4ToNum(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

export function loadGeoIp(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const ranges = [];
  for (const line of lines) {
    if (!line) continue;
    const [start, end, cc] = line.split(',');
    const s = ipv4ToNum(start);
    const e = ipv4ToNum(end);
    if (s == null || e == null || !cc) continue;
    ranges.push([s, e, cc.replace(/[^A-Za-z]/g, '').toUpperCase()]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

export function lookupCountry(ranges, ip) {
  const n = ipv4ToNum(ip);
  if (n == null) return null;
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e, cc] = ranges[mid];
    if (n < s) hi = mid - 1;
    else if (n > e) lo = mid + 1;
    else return cc;
  }
  return null;
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/geoip.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/poller/geoip.js tests/geoip.test.js
git commit -m "feat: offline IPv4-to-country lookup via binary search on sorted ranges"
```

---

### Task C4: `src/poller/rules.js` (device-type guesser)

**Files:**
- Create: `src/poller/rules.js`
- Create: `tests/rules.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { guessDeviceType } from '../src/poller/rules.js';

describe('rules.guessDeviceType', () => {
  it('returns iPhone for Apple vendor + iphone hostname', () => {
    expect(guessDeviceType({ vendor: 'Apple Inc.', hostname: 'iphone-jane' })).toBe('iPhone');
  });
  it('returns Mac for Apple + macbook hostname', () => {
    expect(guessDeviceType({ vendor: 'Apple Inc.', hostname: 'macbook-air' })).toBe('Mac');
  });
  it('returns IoT (ESP) for Espressif vendor', () => {
    expect(guessDeviceType({ vendor: 'Espressif Inc.', hostname: 'esp-xxxx' })).toBe('IoT (ESP)');
  });
  it('returns Echo for Amazon + echo hostname', () => {
    expect(guessDeviceType({ vendor: 'Amazon Technologies Inc.', hostname: 'echo-dot' })).toBe('Echo');
  });
  it('returns Unknown when no rule matches', () => {
    expect(guessDeviceType({ vendor: 'NoSuch Corp', hostname: 'random-host' })).toBe('Unknown');
  });
  it('handles missing hostname', () => {
    expect(guessDeviceType({ vendor: 'Espressif Inc.', hostname: null })).toBe('IoT (ESP)');
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/rules.test.js
```

- [ ] **Step 3: Implement `src/poller/rules.js`**

```js
const RULES = [
  { match: ({ v, h }) => /apple/i.test(v) && /iphone/i.test(h), type: 'iPhone' },
  { match: ({ v, h }) => /apple/i.test(v) && /ipad/i.test(h), type: 'iPad' },
  { match: ({ v, h }) => /apple/i.test(v) && /macbook|imac|mac-?mini|mac\b/i.test(h), type: 'Mac' },
  { match: ({ v, h }) => /apple/i.test(v) && /watch/i.test(h), type: 'Apple Watch' },
  { match: ({ v, h }) => /apple/i.test(v) && /tv\b/i.test(h), type: 'Apple TV' },
  { match: ({ v }) => /espressif/i.test(v), type: 'IoT (ESP)' },
  { match: ({ v, h }) => /amazon/i.test(v) && /echo/i.test(h), type: 'Echo' },
  { match: ({ v, h }) => /amazon/i.test(v) && /fire/i.test(h), type: 'Fire TV' },
  { match: ({ v }) => /google/i.test(v), type: 'Google device' },
  { match: ({ v }) => /raspberry pi/i.test(v), type: 'Raspberry Pi' },
  { match: ({ v }) => /(ubiquiti|unifi)/i.test(v), type: 'UniFi' },
  { match: ({ v }) => /(hp|hewlett.?packard)/i.test(v), type: 'Printer or HP device' },
  { match: ({ v }) => /(samsung|lg|sony|vizio|tcl|hisense)/i.test(v), type: 'Smart TV' },
  { match: ({ v }) => /(roku|chromecast)/i.test(v), type: 'Streamer' },
  { match: ({ v }) => /(synology|qnap)/i.test(v), type: 'NAS' },
  { match: ({ v }) => /sonos/i.test(v), type: 'Sonos' },
  { match: ({ v }) => /irobot/i.test(v), type: 'Robot vacuum' },
];

export function guessDeviceType({ vendor, hostname }) {
  const ctx = { v: vendor ?? '', h: hostname ?? '' };
  for (const rule of RULES) {
    if (rule.match(ctx)) return rule.type;
  }
  return 'Unknown';
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/rules.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/poller/rules.js tests/rules.test.js
git commit -m "feat: device-type rule engine"
```

---

### Task C5: `src/poller/pfsense.js` HTTP client

**Files:**
- Create: `src/poller/pfsense.js`
- Create: `tests/pfsense.test.js`

The client wraps each pfRest endpoint; all requests include `X-API-Key`. The function name `call` is used internally (a generic HTTP wrapper, not shell).

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createPfsenseClient } from '../src/poller/pfsense.js';

let server, baseUrl;

beforeAll(() => new Promise((resolve) => {
  const app = express();
  app.use((req, res, next) => {
    if (req.headers['x-api-key'] !== 'test-key') return res.status(401).json({ error: 'unauth' });
    next();
  });
  app.get('/api/v2/diagnostics/arp_table', (req, res) =>
    res.json({ data: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.42', hostname: 'tv', interface: 'lan' }] }));
  app.get('/api/v2/interface', (req, res) =>
    res.json({ data: [
      { if: 'wan', descr: 'WAN' },
      { if: 'lan', descr: 'LAN', ipv4_address: '10.0.0.1', ipv4_subnet: '24' },
    ] }));
  app.get('/api/v2/status/interfaces', (req, res) =>
    res.json({ data: [{ name: 'wan', inbytes: 100, outbytes: 50 }, { name: 'lan', inbytes: 999, outbytes: 888 }] }));
  server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));

afterAll(() => new Promise((r) => server.close(r)));

describe('pfsense client', () => {
  it('sends X-API-Key header', async () => {
    const c = createPfsenseClient({ baseUrl, apiKey: 'wrong-key', verifyTls: true });
    await expect(c.fetchArpTable()).rejects.toThrow(/401/);
  });

  it('returns normalized ARP rows', async () => {
    const c = createPfsenseClient({ baseUrl, apiKey: 'test-key', verifyTls: true });
    const rows = await c.fetchArpTable();
    expect(rows).toEqual([{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.42', hostname: 'tv', interface: 'lan' }]);
  });

  it('returns interface list', async () => {
    const c = createPfsenseClient({ baseUrl, apiKey: 'test-key', verifyTls: true });
    const ifaces = await c.fetchInterfaces();
    expect(ifaces.find(i => i.if === 'wan')).toBeTruthy();
  });

  it('returns interface stats', async () => {
    const c = createPfsenseClient({ baseUrl, apiKey: 'test-key', verifyTls: true });
    const stats = await c.fetchInterfaceStats();
    expect(stats.find(s => s.name === 'wan').inbytes).toBe(100);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/pfsense.test.js
```

- [ ] **Step 3: Implement `src/poller/pfsense.js`**

```js
import { Agent, fetch as undiciFetch } from 'undici';

const ENDPOINTS = {
  arp: '/api/v2/diagnostics/arp_table',
  dhcpLeases: '/api/v2/services/dhcp_server/leases',
  firewallStates: '/api/v2/firewall/states',
  interfaces: '/api/v2/interface',
  interfaceStats: '/api/v2/status/interfaces',
  ndp: '/api/v2/diagnostics/ndp_table',
  filterLog: '/api/v2/diagnostics/log/firewall',
};

export function createPfsenseClient({ baseUrl, apiKey, verifyTls, timeoutMs = 10_000 }) {
  if (!baseUrl) throw new Error('PFSENSE_URL required');
  if (!apiKey) throw new Error('PFSENSE_API_KEY required');

  const dispatcher = verifyTls === false
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;

  async function call(path) {
    const url = baseUrl.replace(/\/$/, '') + path;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await undiciFetch(url, {
        headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
        signal: controller.signal,
        dispatcher,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`pfRest ${path} -> ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      return json.data ?? json;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    fetchArpTable: () => call(ENDPOINTS.arp),
    fetchDhcpLeases: () => call(ENDPOINTS.dhcpLeases),
    fetchFirewallStates: () => call(ENDPOINTS.firewallStates),
    fetchInterfaces: () => call(ENDPOINTS.interfaces),
    fetchInterfaceStats: () => call(ENDPOINTS.interfaceStats),
    fetchNdpTable: () => call(ENDPOINTS.ndp),
    fetchFilterLogBlocks: async () => {
      try { return await call(ENDPOINTS.filterLog); }
      catch (e) {
        if (/404/.test(e.message)) return [];
        throw e;
      }
    },
  };
}
```

> **Note on endpoint paths:** these match pfRest v2 conventions but exact paths may differ on your pfRest version. After your first end-to-end run (Task E5), adjust paths in the `ENDPOINTS` constant if any endpoint returns 404. Filter-log already falls back to `[]` on 404 per the spec.

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/pfsense.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/poller/pfsense.js tests/pfsense.test.js
git commit -m "feat: pfRest HTTP client with X-API-Key auth and configurable TLS verify"
```

---

## Phase D — Snapshot and reconciliation

### Task D1: `src/poller/snapshot.js` — merge pfSense sources by MAC

**Files:**
- Create: `src/poller/snapshot.js`
- Create: `tests/snapshot.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { buildSnapshot } from '../src/poller/snapshot.js';

const FAKE_OUI = new Map([['AABBCC', 'TestCorp']]);

function ipToNum(ip) {
  return ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
}

describe('buildSnapshot', () => {
  it('merges ARP + leases + NDP into one row per MAC', () => {
    const snap = buildSnapshot({
      arp: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.42', hostname: 'tv', interface: 'lan' }],
      dhcpLeases: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.42', hostname: 'tv', type: 'dynamic', expires: 1700000000 }],
      ndp: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: 'fe80::1' }],
      firewallStates: [
        { src: '10.0.0.42', dst: '8.8.8.8', bytes_in: 100, bytes_out: 200 },
        { src: '10.0.0.42', dst: '1.1.1.1', bytes_in: 50, bytes_out: 50 },
      ],
      interfaces: [{ pfsense_name: 'lan', ipv4_subnet: '10.0.0.0/24' }],
      ouiMap: FAKE_OUI,
      geoRanges: [[ipToNum('8.8.8.0'), ipToNum('8.8.8.255'), 'US']],
    });
    const d = snap.devices['aa:bb:cc:dd:ee:ff'];
    expect(d.ip).toBe('10.0.0.42');
    expect(d.ipv6).toBe('fe80::1');
    expect(d.vendor).toBe('TestCorp');
    expect(d.interface).toBe('lan');
    expect(d.lease_type).toBe('dynamic');
    expect(d.states_count).toBe(2);
    expect(d.rx_bytes_total).toBe(150);
    expect(d.tx_bytes_total).toBe(250);
    expect(d.countries).toEqual({ US: 1 });
  });

  it('handles a device known only via ARP', () => {
    const snap = buildSnapshot({
      arp: [{ mac: 'AA:BB:CC:11:22:33', ip: '10.0.0.5', hostname: null, interface: 'lan' }],
      dhcpLeases: [], ndp: [], firewallStates: [],
      interfaces: [{ pfsense_name: 'lan', ipv4_subnet: '10.0.0.0/24' }],
      ouiMap: FAKE_OUI, geoRanges: [],
    });
    expect(snap.devices['aa:bb:cc:11:22:33'].vendor).toBe('TestCorp');
    expect(snap.devices['aa:bb:cc:11:22:33'].lease_type).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/snapshot.test.js
```

- [ ] **Step 3: Implement `src/poller/snapshot.js`**

```js
import { lookupVendor } from './oui.js';
import { lookupCountry } from './geoip.js';
import { guessDeviceType } from './rules.js';

function normMac(mac) {
  return (mac ?? '').toLowerCase().trim();
}

function ipInSubnet(ip, cidr) {
  if (!ip || !cidr) return false;
  const [base, bits] = cidr.split('/');
  const mask = (0xffffffff << (32 - Number(bits))) >>> 0;
  const n = (ip.split('.').reduce((a, p) => a * 256 + Number(p), 0)) >>> 0;
  const b = (base.split('.').reduce((a, p) => a * 256 + Number(p), 0)) >>> 0;
  return (n & mask) === (b & mask);
}

export function buildSnapshot({ arp, dhcpLeases, ndp, firewallStates, interfaces, ouiMap, geoRanges }) {
  const devices = {};
  function ensure(mac) {
    const key = normMac(mac);
    if (!devices[key]) {
      devices[key] = {
        mac: key,
        vendor: lookupVendor(ouiMap, key),
        hostname: null,
        ip: null,
        ipv6: null,
        interface: null,
        lease_type: null,
        lease_expires_at: null,
        states_count: 0,
        rx_bytes_total: 0,
        tx_bytes_total: 0,
        countries: {},
      };
    }
    return devices[key];
  }

  for (const row of arp ?? []) {
    if (!row.mac) continue;
    const d = ensure(row.mac);
    d.ip = row.ip ?? d.ip;
    d.hostname = row.hostname ?? d.hostname;
    d.interface = row.interface ?? d.interface;
  }
  for (const row of dhcpLeases ?? []) {
    if (!row.mac) continue;
    const d = ensure(row.mac);
    d.hostname = row.hostname ?? d.hostname;
    d.ip = row.ip ?? d.ip;
    d.lease_type = row.type ?? d.lease_type;
    d.lease_expires_at = row.expires ?? d.lease_expires_at;
  }
  for (const row of ndp ?? []) {
    if (!row.mac) continue;
    const d = ensure(row.mac);
    d.ipv6 = row.ip ?? d.ipv6;
  }

  const ifByIp = (ip) => (interfaces ?? []).find(i => ipInSubnet(ip, i.ipv4_subnet))?.pfsense_name ?? null;

  for (const d of Object.values(devices)) {
    if (!d.interface && d.ip) d.interface = ifByIp(d.ip);
    d.device_type_guess = guessDeviceType({ vendor: d.vendor, hostname: d.hostname });
  }

  for (const st of firewallStates ?? []) {
    const dev = Object.values(devices).find(d => d.ip === st.src);
    if (!dev) continue;
    dev.states_count += 1;
    dev.rx_bytes_total += Number(st.bytes_in ?? 0);
    dev.tx_bytes_total += Number(st.bytes_out ?? 0);
    const cc = lookupCountry(geoRanges ?? [], st.dst);
    if (cc) dev.countries[cc] = (dev.countries[cc] ?? 0) + 1;
  }

  return { devices };
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/snapshot.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/poller/snapshot.js tests/snapshot.test.js
git commit -m "feat: snapshot builder merges pfSense sources into per-MAC rows"
```

---

### Task D2: `src/poller/reconcile.js` — `syncInterfaces`

**Files:**
- Create: `src/poller/reconcile.js`
- Create: `tests/reconcile-interfaces.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it } from 'vitest';
import { expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { syncInterfaces } from '../src/poller/reconcile.js';

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('reconcile.syncInterfaces', () => {
  it('inserts new interfaces and updates existing rows', () => {
    const db = fresh();
    syncInterfaces(db, [
      { pfsense_name: 'wan', friendly_name: 'WAN', kind: 'wan', vlan_tag: null, ipv4_subnet: null, ipv6_prefix: null },
      { pfsense_name: 'lan', friendly_name: 'LAN', kind: 'lan', vlan_tag: null, ipv4_subnet: '10.0.0.0/24', ipv6_prefix: null },
    ]);
    const rows = db.prepare('SELECT pfsense_name, kind FROM interfaces ORDER BY pfsense_name').all();
    expect(rows).toEqual([
      { pfsense_name: 'lan', kind: 'lan' },
      { pfsense_name: 'wan', kind: 'wan' },
    ]);
    syncInterfaces(db, [
      { pfsense_name: 'lan', friendly_name: 'Home LAN', kind: 'lan', vlan_tag: null, ipv4_subnet: '10.0.0.0/24', ipv6_prefix: null },
    ]);
    const lan = db.prepare("SELECT friendly_name FROM interfaces WHERE pfsense_name='lan'").get();
    expect(lan.friendly_name).toBe('Home LAN');
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/reconcile-interfaces.test.js
```

- [ ] **Step 3: Create initial `src/poller/reconcile.js`**

```js
export function syncInterfaces(db, interfaces) {
  const upsert = db.prepare(`
    INSERT INTO interfaces (pfsense_name, friendly_name, kind, vlan_tag, ipv4_subnet, ipv6_prefix)
    VALUES (@pfsense_name, @friendly_name, @kind, @vlan_tag, @ipv4_subnet, @ipv6_prefix)
    ON CONFLICT(pfsense_name) DO UPDATE SET
      friendly_name = excluded.friendly_name,
      kind = excluded.kind,
      vlan_tag = excluded.vlan_tag,
      ipv4_subnet = excluded.ipv4_subnet,
      ipv6_prefix = excluded.ipv6_prefix
  `);
  const tx = db.transaction((rows) => { for (const r of rows) upsert.run(r); });
  tx(interfaces);
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/reconcile-interfaces.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/poller/reconcile.js tests/reconcile-interfaces.test.js
git commit -m "feat: reconcile.syncInterfaces upsert"
```

---

### Task D3: Extend reconcile — device upsert + uptime transitions

**Files:**
- Modify: `src/poller/reconcile.js`
- Create: `tests/reconcile-devices.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { syncInterfaces, reconcileDevices } from '../src/poller/reconcile.js';

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  syncInterfaces(db, [{ pfsense_name: 'lan', friendly_name: 'LAN', kind: 'lan', vlan_tag: null, ipv4_subnet: '10.0.0.0/24', ipv6_prefix: null }]);
  return db;
}

function mkDev(overrides = {}) {
  return {
    mac: 'aa:bb:cc:dd:ee:ff',
    vendor: 'TestCorp',
    hostname: 'tv',
    ip: '10.0.0.42',
    ipv6: null,
    interface: 'lan',
    lease_type: 'dynamic',
    lease_expires_at: null,
    states_count: 0,
    rx_bytes_total: 0,
    tx_bytes_total: 0,
    device_type_guess: 'Unknown',
    countries: {},
    ...overrides,
  };
}

describe('reconcile.reconcileDevices', () => {
  it('inserts a new device and flags it as NEW', () => {
    const db = fresh();
    const now = 1_700_000_000;
    const result = reconcileDevices(db, {
      snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': mkDev() } },
      now,
      staleAfterSec: 300,
    });
    expect(result.newDeviceIds).toHaveLength(1);
    const row = db.prepare("SELECT * FROM devices WHERE mac='aa:bb:cc:dd:ee:ff'").get();
    expect(row.first_seen_at).toBe(now);
    expect(row.last_seen_at).toBe(now);
    expect(row.new_until_seen_at).toBe(now);
    expect(row.is_online).toBe(1);
  });

  it('updates last_seen and records online transition when a device returns', () => {
    const db = fresh();
    reconcileDevices(db, { snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': mkDev() } }, now: 1000, staleAfterSec: 300 });
    reconcileDevices(db, { snapshot: { devices: {} }, now: 2000, staleAfterSec: 300 });
    const offline = db.prepare("SELECT is_online FROM devices WHERE mac='aa:bb:cc:dd:ee:ff'").get();
    expect(offline.is_online).toBe(0);
    const events1 = db.prepare('SELECT status FROM uptime_events ORDER BY ts').all().map(r => r.status);
    expect(events1).toEqual(['online', 'offline']);

    reconcileDevices(db, { snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': mkDev() } }, now: 3000, staleAfterSec: 300 });
    const events2 = db.prepare('SELECT status FROM uptime_events ORDER BY ts').all().map(r => r.status);
    expect(events2).toEqual(['online', 'offline', 'online']);
  });

  it('keeps a device "online" if its last_seen is within staleAfterSec', () => {
    const db = fresh();
    reconcileDevices(db, { snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': mkDev() } }, now: 1000, staleAfterSec: 300 });
    reconcileDevices(db, { snapshot: { devices: {} }, now: 1200, staleAfterSec: 300 });
    const row = db.prepare("SELECT is_online FROM devices WHERE mac='aa:bb:cc:dd:ee:ff'").get();
    expect(row.is_online).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/reconcile-devices.test.js
```

- [ ] **Step 3: Append to `src/poller/reconcile.js`**

```js
export function reconcileDevices(db, { snapshot, now, staleAfterSec }) {
  const newDeviceIds = [];

  const selByMac = db.prepare('SELECT id, is_online, first_seen_at, alerted_at FROM devices WHERE mac = ?');
  const selIface = db.prepare('SELECT id FROM interfaces WHERE pfsense_name = ?');
  const insDev = db.prepare(`
    INSERT INTO devices (mac, vendor, hostname, current_ip, current_ipv6, interface_id,
      current_lease_type, current_lease_expires_at, device_type_guess,
      is_online, first_seen_at, last_seen_at, new_until_seen_at)
    VALUES (@mac, @vendor, @hostname, @ip, @ipv6, @interface_id,
      @lease_type, @lease_expires_at, @device_type_guess,
      1, @now, @now, @now)
  `);
  const updDev = db.prepare(`
    UPDATE devices SET
      vendor = COALESCE(@vendor, vendor),
      hostname = COALESCE(@hostname, hostname),
      current_ip = @ip,
      current_ipv6 = COALESCE(@ipv6, current_ipv6),
      interface_id = COALESCE(@interface_id, interface_id),
      current_lease_type = COALESCE(@lease_type, current_lease_type),
      current_lease_expires_at = COALESCE(@lease_expires_at, current_lease_expires_at),
      device_type_guess = COALESCE(@device_type_guess, device_type_guess),
      last_seen_at = @now,
      is_online = 1
    WHERE id = @id
  `);
  const markOffline = db.prepare('UPDATE devices SET is_online = 0 WHERE id = ? AND is_online = 1');
  const insUptime = db.prepare('INSERT INTO uptime_events (device_id, ts, status) VALUES (?, ?, ?)');
  const findStale = db.prepare('SELECT id FROM devices WHERE is_online = 1 AND last_seen_at < ?');

  const tx = db.transaction(() => {
    for (const [mac, dev] of Object.entries(snapshot.devices)) {
      const interface_id = dev.interface ? (selIface.get(dev.interface)?.id ?? null) : null;
      const existing = selByMac.get(mac);
      if (!existing) {
        const info = insDev.run({
          mac, vendor: dev.vendor, hostname: dev.hostname, ip: dev.ip, ipv6: dev.ipv6,
          interface_id, lease_type: dev.lease_type, lease_expires_at: dev.lease_expires_at,
          device_type_guess: dev.device_type_guess, now,
        });
        const id = info.lastInsertRowid;
        insUptime.run(id, now, 'online');
        newDeviceIds.push({ id, mac });
      } else {
        updDev.run({
          id: existing.id,
          vendor: dev.vendor, hostname: dev.hostname, ip: dev.ip, ipv6: dev.ipv6,
          interface_id, lease_type: dev.lease_type, lease_expires_at: dev.lease_expires_at,
          device_type_guess: dev.device_type_guess, now,
        });
        if (existing.is_online === 0) insUptime.run(existing.id, now, 'online');
      }
    }
    const cutoff = now - staleAfterSec;
    const stale = findStale.all(cutoff);
    for (const { id } of stale) {
      markOffline.run(id);
      insUptime.run(id, now, 'offline');
    }
  });
  tx();
  return { newDeviceIds };
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/reconcile-devices.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/poller/reconcile.js tests/reconcile-devices.test.js
git commit -m "feat: device upserts + uptime transitions"
```

---

### Task D4: Extend reconcile — traffic samples + interface traffic samples

**Files:**
- Modify: `src/poller/reconcile.js`
- Create: `tests/reconcile-traffic.test.js`

The counter-state tables already exist from migration 001_init.sql; this task only writes to them.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { syncInterfaces, reconcileDevices, recordTrafficSamples, recordInterfaceTrafficSamples } from '../src/poller/reconcile.js';

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  syncInterfaces(db, [
    { pfsense_name: 'wan', friendly_name: 'WAN', kind: 'wan', vlan_tag: null, ipv4_subnet: null, ipv6_prefix: null },
    { pfsense_name: 'lan', friendly_name: 'LAN', kind: 'lan', vlan_tag: null, ipv4_subnet: '10.0.0.0/24', ipv6_prefix: null },
  ]);
  return db;
}

function dev(overrides) {
  return { mac: 'aa:bb:cc:dd:ee:ff', vendor: 'X', hostname: 'h', ip: '10.0.0.42', ipv6: null, interface: 'lan',
    lease_type: null, lease_expires_at: null, device_type_guess: 'Unknown', countries: {}, ...overrides };
}

describe('reconcile traffic', () => {
  it('records the byte-delta from the previous sample for each device', () => {
    const db = fresh();
    reconcileDevices(db, { snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': dev({ rx_bytes_total: 1000, tx_bytes_total: 500, states_count: 3 }) } }, now: 1000, staleAfterSec: 300 });
    recordTrafficSamples(db, { snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': dev({ rx_bytes_total: 1000, tx_bytes_total: 500, states_count: 3 }) } }, now: 1000 });
    const rows1 = db.prepare('SELECT rx_bytes, tx_bytes, states_count FROM traffic_samples ORDER BY ts').all();
    expect(rows1).toEqual([{ rx_bytes: 0, tx_bytes: 0, states_count: 3 }]);

    recordTrafficSamples(db, { snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': dev({ rx_bytes_total: 1500, tx_bytes_total: 700, states_count: 5 }) } }, now: 1030 });
    const rows2 = db.prepare('SELECT rx_bytes, tx_bytes, states_count FROM traffic_samples ORDER BY ts').all();
    expect(rows2[1]).toEqual({ rx_bytes: 500, tx_bytes: 200, states_count: 5 });
  });

  it('records interface counters with deltas', () => {
    const db = fresh();
    recordInterfaceTrafficSamples(db, { stats: [{ name: 'wan', inbytes: 100, outbytes: 50 }], now: 1000 });
    recordInterfaceTrafficSamples(db, { stats: [{ name: 'wan', inbytes: 1100, outbytes: 250 }], now: 1030 });
    const rows = db.prepare('SELECT rx_bytes, tx_bytes FROM interface_traffic_samples ORDER BY ts').all();
    expect(rows[1]).toEqual({ rx_bytes: 1000, tx_bytes: 200 });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/reconcile-traffic.test.js
```

- [ ] **Step 3: Append to `src/poller/reconcile.js`**

```js
export function recordTrafficSamples(db, { snapshot, now }) {
  const selDev = db.prepare('SELECT id FROM devices WHERE mac = ?');
  const selPrev = db.prepare('SELECT rx_total, tx_total FROM device_counter_state WHERE device_id = ?');
  const upsertPrev = db.prepare(`
    INSERT INTO device_counter_state (device_id, rx_total, tx_total) VALUES (?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET rx_total = excluded.rx_total, tx_total = excluded.tx_total
  `);
  const insSample = db.prepare(`
    INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const [mac, d] of Object.entries(snapshot.devices)) {
      const devRow = selDev.get(mac);
      if (!devRow) continue;
      const prev = selPrev.get(devRow.id);
      const rxDelta = prev ? Math.max(0, d.rx_bytes_total - prev.rx_total) : 0;
      const txDelta = prev ? Math.max(0, d.tx_bytes_total - prev.tx_total) : 0;
      upsertPrev.run(devRow.id, d.rx_bytes_total, d.tx_bytes_total);
      insSample.run(devRow.id, now, rxDelta, txDelta, d.states_count ?? 0);
    }
  });
  tx();
}

export function recordInterfaceTrafficSamples(db, { stats, now }) {
  const selIface = db.prepare('SELECT id FROM interfaces WHERE pfsense_name = ?');
  const selPrev = db.prepare('SELECT rx_total, tx_total FROM interface_counter_state WHERE interface_id = ?');
  const upsertPrev = db.prepare(`
    INSERT INTO interface_counter_state (interface_id, rx_total, tx_total) VALUES (?, ?, ?)
    ON CONFLICT(interface_id) DO UPDATE SET rx_total = excluded.rx_total, tx_total = excluded.tx_total
  `);
  const insSample = db.prepare(`
    INSERT INTO interface_traffic_samples (interface_id, ts, rx_bytes, tx_bytes) VALUES (?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const s of stats ?? []) {
      const iface = selIface.get(s.name);
      if (!iface) continue;
      const prev = selPrev.get(iface.id);
      const rx = Number(s.inbytes ?? 0);
      const txTotal = Number(s.outbytes ?? 0);
      const rxDelta = prev ? Math.max(0, rx - prev.rx_total) : 0;
      const txDelta = prev ? Math.max(0, txTotal - prev.tx_total) : 0;
      upsertPrev.run(iface.id, rx, txTotal);
      insSample.run(iface.id, now, rxDelta, txDelta);
    }
  });
  tx();
}
```

> `Math.max(0, delta)` swallows counter rollovers (pfSense reboot etc.) — the next sample shows a 0 delta instead of a negative one. Correct behavior for charting.

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/reconcile-traffic.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/poller/reconcile.js tests/reconcile-traffic.test.js
git commit -m "feat: traffic + interface traffic samples with delta computation"
```

---

### Task D5: Extend reconcile — geo_connections + firewall_blocks

**Files:**
- Modify: `src/poller/reconcile.js`
- Create: `tests/reconcile-security.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { syncInterfaces, reconcileDevices, recordGeoConnections, recordFirewallBlocks } from '../src/poller/reconcile.js';

function dev(overrides = {}) {
  return { mac: 'aa:bb:cc:dd:ee:ff', vendor: 'X', hostname: 'h', ip: '10.0.0.42', ipv6: null, interface: 'lan',
    lease_type: null, lease_expires_at: null, device_type_guess: 'Unknown',
    rx_bytes_total: 0, tx_bytes_total: 0, states_count: 0, countries: {}, ...overrides };
}

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  syncInterfaces(db, [{ pfsense_name: 'lan', friendly_name: 'LAN', kind: 'lan', vlan_tag: null, ipv4_subnet: '10.0.0.0/24', ipv6_prefix: null }]);
  reconcileDevices(db, { snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': dev() } }, now: 1000, staleAfterSec: 300 });
  return db;
}

describe('reconcile security tables', () => {
  it('upserts geo_connections per device + country', () => {
    const db = setup();
    recordGeoConnections(db, { snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': dev({ countries: { US: 3, NL: 1 } }) } }, now: 2000 });
    const rows = db.prepare('SELECT country_code, hit_count FROM geo_connections ORDER BY country_code').all();
    expect(rows).toEqual([{ country_code: 'NL', hit_count: 1 }, { country_code: 'US', hit_count: 3 }]);
    recordGeoConnections(db, { snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': dev({ countries: { US: 2 } }) } }, now: 3000 });
    const us = db.prepare("SELECT hit_count, last_seen_at FROM geo_connections WHERE country_code='US'").get();
    expect(us.hit_count).toBe(5);
    expect(us.last_seen_at).toBe(3000);
  });

  it('inserts firewall_blocks de-duplicated by dedupe_hash', () => {
    const db = setup();
    const block = { ts: 1234, src_ip: '10.0.0.42', src_port: 5555, dst_ip: '8.8.8.8', dst_port: 53, proto: 'udp', direction: 'out' };
    recordFirewallBlocks(db, { blocks: [block] });
    recordFirewallBlocks(db, { blocks: [block, block] });
    const count = db.prepare('SELECT COUNT(*) as c FROM firewall_blocks').get().c;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/reconcile-security.test.js
```

- [ ] **Step 3: Append to `src/poller/reconcile.js`**

```js
import { createHash } from 'node:crypto';

export function recordGeoConnections(db, { snapshot, now }) {
  const selDev = db.prepare('SELECT id FROM devices WHERE mac = ?');
  const upsert = db.prepare(`
    INSERT INTO geo_connections (device_id, country_code, last_seen_at, hit_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(device_id, country_code) DO UPDATE SET
      hit_count = hit_count + excluded.hit_count,
      last_seen_at = excluded.last_seen_at
  `);
  const tx = db.transaction(() => {
    for (const [mac, d] of Object.entries(snapshot.devices)) {
      const row = selDev.get(mac);
      if (!row) continue;
      for (const [cc, n] of Object.entries(d.countries ?? {})) {
        upsert.run(row.id, cc, now, n);
      }
    }
  });
  tx();
}

export function recordFirewallBlocks(db, { blocks }) {
  const selDevByIp = db.prepare('SELECT id FROM devices WHERE current_ip = ?');
  const ins = db.prepare(`
    INSERT OR IGNORE INTO firewall_blocks
      (ts, device_id, src_ip, src_port, dst_ip, dst_port, proto, direction, dedupe_hash)
    VALUES (@ts, @device_id, @src_ip, @src_port, @dst_ip, @dst_port, @proto, @direction, @dedupe_hash)
  `);
  const tx = db.transaction(() => {
    for (const b of blocks ?? []) {
      const dev = b.src_ip ? selDevByIp.get(b.src_ip) : null;
      const dedupe = createHash('sha256')
        .update(`${b.ts}|${b.src_ip ?? ''}|${b.src_port ?? ''}|${b.dst_ip ?? ''}|${b.dst_port ?? ''}|${b.proto ?? ''}`)
        .digest('hex');
      ins.run({
        ts: Number(b.ts ?? Math.floor(Date.now() / 1000)),
        device_id: dev?.id ?? null,
        src_ip: b.src_ip ?? null,
        src_port: b.src_port ?? null,
        dst_ip: b.dst_ip ?? null,
        dst_port: b.dst_port ?? null,
        proto: b.proto ?? null,
        direction: b.direction ?? null,
        dedupe_hash: dedupe,
      });
    }
  });
  tx();
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/reconcile-security.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/poller/reconcile.js tests/reconcile-security.test.js
git commit -m "feat: geo_connections upserts + firewall_blocks with dedupe"
```

---

## Phase E — Alerts, retention, rollups, orchestrator

### Task E1: `src/poller/alerts.js` (ntfy with grace period)

**Files:**
- Create: `src/poller/alerts.js`
- Create: `tests/alerts.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { maybeFireNewDeviceAlerts } from '../src/poller/alerts.js';

let server, topicUrl, received;

beforeAll(() => new Promise((resolve) => {
  received = [];
  const app = express();
  app.use(express.text({ type: '*/*' }));
  app.post('/topic', (req, res) => {
    received.push({ body: req.body, headers: req.headers });
    res.send('ok');
  });
  server = app.listen(0, () => { topicUrl = `http://127.0.0.1:${server.address().port}/topic`; resolve(); });
}));
afterAll(() => new Promise((r) => server.close(r)));

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const now = 1_000_000;
  db.prepare(`INSERT INTO devices (mac, vendor, hostname, current_ip, is_online, first_seen_at, last_seen_at, new_until_seen_at)
              VALUES ('aa:bb:cc:dd:ee:ff','Espressif','iot1','10.20.0.99', 1, ?, ?, ?)`).run(now, now, now);
  return { db, now };
}

describe('maybeFireNewDeviceAlerts', () => {
  it('does not fire before grace period elapses', async () => {
    const { db, now } = setup();
    await maybeFireNewDeviceAlerts(db, { topicUrl, now: now + 60, graceSec: 300 });
    expect(received).toHaveLength(0);
  });

  it('fires once after grace period and sets alerted_at', async () => {
    const { db, now } = setup();
    await maybeFireNewDeviceAlerts(db, { topicUrl, now: now + 400, graceSec: 300 });
    expect(received).toHaveLength(1);
    expect(received[0].body).toMatch(/iot1|10\.20\.0\.99|aa:bb:cc:dd:ee:ff/);
    received.length = 0;
    await maybeFireNewDeviceAlerts(db, { topicUrl, now: now + 500, graceSec: 300 });
    expect(received).toHaveLength(0);
  });

  it('is a no-op when topicUrl is empty', async () => {
    const { db, now } = setup();
    await maybeFireNewDeviceAlerts(db, { topicUrl: '', now: now + 400, graceSec: 300 });
    expect(received).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/alerts.test.js
```

- [ ] **Step 3: Implement `src/poller/alerts.js`**

```js
export async function maybeFireNewDeviceAlerts(db, { topicUrl, now, graceSec }) {
  if (!topicUrl) return;
  const candidates = db.prepare(`
    SELECT d.id, d.mac, d.vendor, d.hostname, d.current_ip, i.pfsense_name AS interface_name
    FROM devices d
    LEFT JOIN interfaces i ON i.id = d.interface_id
    WHERE d.alerted_at IS NULL AND d.first_seen_at <= ?
  `).all(now - graceSec);

  const markAlerted = db.prepare('UPDATE devices SET alerted_at = ? WHERE id = ?');

  for (const dev of candidates) {
    const body = `New device on network\nvendor=${dev.vendor ?? '?'}\nhostname=${dev.hostname ?? '?'}\nip=${dev.current_ip ?? '?'}\nmac=${dev.mac}\nvlan=${dev.interface_name ?? '?'}`;
    try {
      const res = await fetch(topicUrl, {
        method: 'POST',
        headers: { 'Title': 'pfmon: new device', 'Content-Type': 'text/plain' },
        body,
      });
      if (!res.ok) {
        console.log(JSON.stringify({ level: 'warn', msg: 'ntfy non-2xx', status: res.status }));
        continue;
      }
      markAlerted.run(now, dev.id);
    } catch (e) {
      console.log(JSON.stringify({ level: 'warn', msg: 'ntfy error', error: String(e) }));
    }
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/alerts.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/poller/alerts.js tests/alerts.test.js
git commit -m "feat: ntfy.sh alerts for new devices with grace period"
```

---

### Task E2: `src/poller/retention.js` (prune + rollups)

**Files:**
- Create: `src/poller/retention.js`
- Create: `tests/retention.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { syncInterfaces, reconcileDevices } from '../src/poller/reconcile.js';
import { pruneOldRows, rollupHourly, rollupDaily } from '../src/poller/retention.js';

function dev() {
  return { mac: 'aa:bb:cc:dd:ee:ff', vendor: 'X', hostname: 'h', ip: '10.0.0.42', ipv6: null, interface: 'lan',
    lease_type: null, lease_expires_at: null, device_type_guess: 'Unknown',
    rx_bytes_total: 0, tx_bytes_total: 0, states_count: 0, countries: {} };
}

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  syncInterfaces(db, [{ pfsense_name: 'lan', friendly_name: 'LAN', kind: 'lan', vlan_tag: null, ipv4_subnet: '10.0.0.0/24', ipv6_prefix: null }]);
  reconcileDevices(db, { snapshot: { devices: { 'aa:bb:cc:dd:ee:ff': dev() } }, now: 1000, staleAfterSec: 300 });
  return db;
}

describe('retention', () => {
  it('prunes traffic_samples older than 7d and poll_log older than 7d', () => {
    const db = setup();
    const dev_id = db.prepare("SELECT id FROM devices LIMIT 1").get().id;
    const now = 1_000_000;
    db.prepare('INSERT INTO traffic_samples VALUES (?, ?, 0, 0, 0)').run(dev_id, now - 30 * 86400);
    db.prepare('INSERT INTO traffic_samples VALUES (?, ?, 0, 0, 0)').run(dev_id, now);
    db.prepare('INSERT INTO poll_log (ts, success) VALUES (?, 1)').run(now - 30 * 86400);
    db.prepare('INSERT INTO poll_log (ts, success) VALUES (?, 1)').run(now);
    pruneOldRows(db, { now });
    expect(db.prepare('SELECT COUNT(*) c FROM traffic_samples').get().c).toBe(1);
    expect(db.prepare('SELECT COUNT(*) c FROM poll_log').get().c).toBe(1);
  });

  it('rolls hourly aggregates from traffic_samples', () => {
    const db = setup();
    const dev_id = db.prepare("SELECT id FROM devices LIMIT 1").get().id;
    const hour = Math.floor(1_700_000_000 / 3600) * 3600;
    db.prepare('INSERT INTO traffic_samples VALUES (?, ?, 100, 50, 1)').run(dev_id, hour + 100);
    db.prepare('INSERT INTO traffic_samples VALUES (?, ?, 200, 75, 2)').run(dev_id, hour + 200);
    rollupHourly(db, { now: hour + 3700 });
    const row = db.prepare('SELECT rx_bytes, tx_bytes FROM traffic_hourly WHERE device_id = ?').get(dev_id);
    expect(row).toEqual({ rx_bytes: 300, tx_bytes: 125 });
  });

  it('rolls daily aggregates from traffic_hourly', () => {
    const db = setup();
    const dev_id = db.prepare("SELECT id FROM devices LIMIT 1").get().id;
    const day = Math.floor(1_700_000_000 / 86400) * 86400;
    db.prepare('INSERT INTO traffic_hourly VALUES (?, ?, 100, 50, 10, 5)').run(dev_id, day);
    db.prepare('INSERT INTO traffic_hourly VALUES (?, ?, 200, 75, 20, 8)').run(dev_id, day + 3600);
    rollupDaily(db, { now: day + 86400 + 100 });
    const row = db.prepare('SELECT rx_bytes, tx_bytes, peak_rx_rate FROM traffic_daily WHERE device_id = ?').get(dev_id);
    expect(row).toEqual({ rx_bytes: 300, tx_bytes: 125, peak_rx_rate: 20 });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/retention.test.js
```

- [ ] **Step 3: Implement `src/poller/retention.js`**

```js
const SEC_DAY = 86400;
const SEC_HOUR = 3600;

export function pruneOldRows(db, { now }) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM traffic_samples WHERE ts < ?').run(now - 7 * SEC_DAY);
    db.prepare('DELETE FROM interface_traffic_samples WHERE ts < ?').run(now - 7 * SEC_DAY);
    db.prepare('DELETE FROM traffic_hourly WHERE hour_bucket < ?').run(now - 90 * SEC_DAY);
    db.prepare('DELETE FROM interface_traffic_hourly WHERE hour_bucket < ?').run(now - 90 * SEC_DAY);
    db.prepare('DELETE FROM firewall_blocks WHERE ts < ?').run(now - 7 * SEC_DAY);
    db.prepare('DELETE FROM poll_log WHERE ts < ?').run(now - 7 * SEC_DAY);
  });
  tx();
}

export function rollupHourly(db, { now }) {
  const cutoff = Math.floor(now / SEC_HOUR) * SEC_HOUR;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO traffic_hourly (device_id, hour_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
      SELECT device_id, (ts / 3600) * 3600 AS hour_bucket,
             SUM(rx_bytes), SUM(tx_bytes), MAX(rx_bytes), MAX(tx_bytes)
      FROM traffic_samples
      WHERE ts < ?
      GROUP BY device_id, hour_bucket
      ON CONFLICT(device_id, hour_bucket) DO UPDATE SET
        rx_bytes = excluded.rx_bytes,
        tx_bytes = excluded.tx_bytes,
        peak_rx_rate = excluded.peak_rx_rate,
        peak_tx_rate = excluded.peak_tx_rate
    `).run(cutoff);
    db.prepare(`
      INSERT INTO interface_traffic_hourly (interface_id, hour_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
      SELECT interface_id, (ts / 3600) * 3600,
             SUM(rx_bytes), SUM(tx_bytes), MAX(rx_bytes), MAX(tx_bytes)
      FROM interface_traffic_samples
      WHERE ts < ?
      GROUP BY interface_id, (ts / 3600) * 3600
      ON CONFLICT(interface_id, hour_bucket) DO UPDATE SET
        rx_bytes = excluded.rx_bytes,
        tx_bytes = excluded.tx_bytes,
        peak_rx_rate = excluded.peak_rx_rate,
        peak_tx_rate = excluded.peak_tx_rate
    `).run(cutoff);
  });
  tx();
}

export function rollupDaily(db, { now }) {
  const cutoff = Math.floor(now / SEC_DAY) * SEC_DAY;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO traffic_daily (device_id, day_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
      SELECT device_id, (hour_bucket / 86400) * 86400,
             SUM(rx_bytes), SUM(tx_bytes), MAX(peak_rx_rate), MAX(peak_tx_rate)
      FROM traffic_hourly
      WHERE hour_bucket < ?
      GROUP BY device_id, (hour_bucket / 86400) * 86400
      ON CONFLICT(device_id, day_bucket) DO UPDATE SET
        rx_bytes = excluded.rx_bytes,
        tx_bytes = excluded.tx_bytes,
        peak_rx_rate = excluded.peak_rx_rate,
        peak_tx_rate = excluded.peak_tx_rate
    `).run(cutoff);
    db.prepare(`
      INSERT INTO interface_traffic_daily (interface_id, day_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
      SELECT interface_id, (hour_bucket / 86400) * 86400,
             SUM(rx_bytes), SUM(tx_bytes), MAX(peak_rx_rate), MAX(peak_tx_rate)
      FROM interface_traffic_hourly
      WHERE hour_bucket < ?
      GROUP BY interface_id, (hour_bucket / 86400) * 86400
      ON CONFLICT(interface_id, day_bucket) DO UPDATE SET
        rx_bytes = excluded.rx_bytes,
        tx_bytes = excluded.tx_bytes,
        peak_rx_rate = excluded.peak_rx_rate,
        peak_tx_rate = excluded.peak_tx_rate
    `).run(cutoff);
  });
  tx();
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- tests/retention.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/poller/retention.js tests/retention.test.js
git commit -m "feat: retention prune + hourly + daily rollups"
```

---

### Task E3: `src/poller/index.js` orchestrator + `interfaces.js` normalizer

**Files:**
- Create: `src/poller/interfaces.js`
- Create: `src/poller/index.js`
- Create: `tests/poller-orchestrator.test.js`

- [ ] **Step 1: Create `src/poller/interfaces.js`**

```js
function classifyKind(iface) {
  const name = (iface.if ?? iface.descr ?? '').toLowerCase();
  if (name === 'wan' || /wan/.test(name)) return 'wan';
  if (/vlan/.test(name) || iface.tag) return 'vlan';
  if (name === 'lan') return 'lan';
  return 'opt';
}

function subnet(iface) {
  if (iface.ipv4_address && iface.ipv4_subnet) {
    return `${iface.ipv4_address.replace(/\.\d+$/, '.0')}/${iface.ipv4_subnet}`;
  }
  return null;
}

export function normalizeInterfaces(payload, { wanOverride } = {}) {
  return (payload ?? []).map(i => ({
    pfsense_name: i.if ?? i.name,
    friendly_name: i.descr ?? i.if ?? i.name,
    kind: wanOverride && (i.if === wanOverride) ? 'wan' : classifyKind(i),
    vlan_tag: i.tag ? Number(i.tag) : null,
    ipv4_subnet: subnet(i),
    ipv6_prefix: i.ipv6_prefix ?? null,
  })).filter(i => i.pfsense_name);
}
```

- [ ] **Step 2: Write the failing orchestrator test**

```js
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { runOnePoll } from '../src/poller/index.js';

function fakeClient() {
  return {
    fetchArpTable: async () => [{ mac: 'AA:BB:CC:DD:EE:FF', ip: '10.0.0.42', hostname: 'tv', interface: 'lan' }],
    fetchDhcpLeases: async () => [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.42', type: 'dynamic', hostname: 'tv', expires: 9_999_999 }],
    fetchNdpTable: async () => [],
    fetchFirewallStates: async () => [{ src: '10.0.0.42', dst: '8.8.8.8', bytes_in: 100, bytes_out: 50 }],
    fetchInterfaces: async () => [{ if: 'wan', descr: 'WAN' }, { if: 'lan', descr: 'LAN', ipv4_address: '10.0.0.1', ipv4_subnet: '24' }],
    fetchInterfaceStats: async () => [{ name: 'wan', inbytes: 1000, outbytes: 500 }, { name: 'lan', inbytes: 2000, outbytes: 1000 }],
    fetchFilterLogBlocks: async () => [],
  };
}

describe('runOnePoll', () => {
  it('runs a full tick end-to-end and writes data + poll_log', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const result = await runOnePoll({
      db, client: fakeClient(),
      ouiMap: new Map([['AABBCC', 'TestCorp']]),
      geoRanges: [],
      now: 1_000_000, staleAfterSec: 300,
    });
    expect(result.success).toBe(true);
    expect(db.prepare("SELECT COUNT(*) c FROM devices").get().c).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM interfaces").get().c).toBe(2);
    expect(db.prepare("SELECT COUNT(*) c FROM poll_log WHERE success=1").get().c).toBe(1);
  });

  it('records a poll_log failure row on error and does not crash', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const broken = { ...fakeClient(), fetchArpTable: async () => { throw new Error('boom'); } };
    const result = await runOnePoll({
      db, client: broken, ouiMap: new Map(), geoRanges: [], now: 1_000_000, staleAfterSec: 300,
    });
    expect(result.success).toBe(false);
    const row = db.prepare("SELECT success, error_msg FROM poll_log").get();
    expect(row.success).toBe(0);
    expect(row.error_msg).toMatch(/boom/);
  });
});
```

- [ ] **Step 3: Run to confirm fail**

```bash
npm test -- tests/poller-orchestrator.test.js
```

- [ ] **Step 4: Implement `src/poller/index.js`**

```js
import cron from 'node-cron';
import { buildSnapshot } from './snapshot.js';
import { normalizeInterfaces } from './interfaces.js';
import {
  syncInterfaces, reconcileDevices,
  recordTrafficSamples, recordInterfaceTrafficSamples,
  recordGeoConnections, recordFirewallBlocks,
} from './reconcile.js';
import { maybeFireNewDeviceAlerts } from './alerts.js';
import { pruneOldRows, rollupHourly, rollupDaily } from './retention.js';

export async function runOnePoll({ db, client, ouiMap, geoRanges, now, staleAfterSec, ntfyTopicUrl, graceSec, wanOverride }) {
  const start = Date.now();
  try {
    const [arp, dhcpLeases, ndp, firewallStates, rawInterfaces, interfaceStats, filterLogBlocks] = await Promise.all([
      client.fetchArpTable(),
      client.fetchDhcpLeases(),
      client.fetchNdpTable(),
      client.fetchFirewallStates(),
      client.fetchInterfaces(),
      client.fetchInterfaceStats(),
      client.fetchFilterLogBlocks(),
    ]);

    const interfaces = normalizeInterfaces(rawInterfaces, { wanOverride });
    syncInterfaces(db, interfaces);

    const snapshot = buildSnapshot({
      arp, dhcpLeases, ndp, firewallStates, interfaces, ouiMap, geoRanges,
    });

    reconcileDevices(db, { snapshot, now, staleAfterSec });
    recordTrafficSamples(db, { snapshot, now });
    recordInterfaceTrafficSamples(db, { stats: interfaceStats, now });
    recordGeoConnections(db, { snapshot, now });
    recordFirewallBlocks(db, { blocks: filterLogBlocks });

    await maybeFireNewDeviceAlerts(db, { topicUrl: ntfyTopicUrl, now, graceSec });

    const duration = Date.now() - start;
    db.prepare('INSERT INTO poll_log (ts, success, duration_ms) VALUES (?, 1, ?)').run(now, duration);
    return { success: true, duration_ms: duration };
  } catch (e) {
    const duration = Date.now() - start;
    db.prepare('INSERT INTO poll_log (ts, success, duration_ms, error_msg) VALUES (?, 0, ?, ?)')
      .run(now, duration, String(e?.message ?? e));
    return { success: false, error: String(e?.message ?? e) };
  }
}

export function startScheduler({ db, client, ouiMap, geoRanges, intervalSec, staleAfterSec, ntfyTopicUrl, graceSec, wanOverride }) {
  let consecutiveFails = 0;
  let nextRunAt = Date.now();

  async function tick() {
    if (Date.now() < nextRunAt) return;
    const now = Math.floor(Date.now() / 1000);
    const result = await runOnePoll({ db, client, ouiMap, geoRanges, now, staleAfterSec, ntfyTopicUrl, graceSec, wanOverride });
    if (result.success) {
      consecutiveFails = 0;
      nextRunAt = Date.now() + intervalSec * 1000;
    } else {
      consecutiveFails += 1;
      const backoffSec = consecutiveFails < 3 ? intervalSec : Math.min(300, intervalSec * 2 ** Math.min(4, consecutiveFails - 2));
      nextRunAt = Date.now() + backoffSec * 1000;
      console.log(JSON.stringify({ level: 'warn', msg: 'poll failed', consecutiveFails, backoffSec }));
    }
  }

  const fastTask = cron.schedule('*/5 * * * * *', tick);
  const hourlyTask = cron.schedule('0 * * * *', () => rollupHourly(db, { now: Math.floor(Date.now() / 1000) }));
  const dailyTask = cron.schedule('5 0 * * *', () => {
    const now = Math.floor(Date.now() / 1000);
    rollupDaily(db, { now });
    pruneOldRows(db, { now });
  });

  return {
    stop: () => { fastTask.stop(); hourlyTask.stop(); dailyTask.stop(); },
  };
}
```

- [ ] **Step 5: Run all tests, confirm pass**

```bash
npm test
```

Expected: every suite green.

- [ ] **Step 6: Commit**

```bash
git add src/poller/ tests/poller-orchestrator.test.js
git commit -m "feat: poller orchestrator with cron schedule + exponential backoff"
```

---

### Task E4: Wire the poller into `src/index.js`

**Files:**
- Modify: `src/index.js`
- Create: `src/config.js`

- [ ] **Step 1: Write `src/config.js`**

```js
export function loadConfig() {
  const required = (name) => {
    const v = process.env[name];
    if (!v) { console.error(`missing env: ${name}`); process.exit(2); }
    return v;
  };
  return {
    pfsenseUrl: required('PFSENSE_URL'),
    pfsenseApiKey: required('PFSENSE_API_KEY'),
    pfsenseVerifyTls: (process.env.PFSENSE_VERIFY_TLS ?? 'true') !== 'false',
    pollIntervalSec: Number(process.env.POLL_INTERVAL_SECONDS ?? 30),
    ntfyTopicUrl: process.env.NTFY_TOPIC_URL ?? '',
    newDeviceGraceMinutes: Number(process.env.NEW_DEVICE_GRACE_MINUTES ?? 5),
    dbPath: process.env.DB_PATH ?? '/data/pfmon.db',
    port: Number(process.env.PORT ?? 8080),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    wanInterfaceName: process.env.WAN_INTERFACE_NAME || null,
    ouiPath: process.env.OUI_PATH ?? new URL('../data/oui.csv', import.meta.url).pathname,
    geoIpPath: process.env.GEOIP_PATH ?? new URL('../data/dbip-country-lite.csv', import.meta.url).pathname,
  };
}
```

- [ ] **Step 2: Rewrite `src/index.js`**

```js
import express from 'express';
import { buildHealthRouter } from './health.js';
import { loadConfig } from './config.js';
import { openDb, runMigrations } from './db.js';
import { loadOui } from './poller/oui.js';
import { loadGeoIp } from './poller/geoip.js';
import { createPfsenseClient } from './poller/pfsense.js';
import { runOnePoll, startScheduler } from './poller/index.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
runMigrations(db);

const ouiMap = loadOui(cfg.ouiPath);
const geoRanges = loadGeoIp(cfg.geoIpPath);

const client = createPfsenseClient({
  baseUrl: cfg.pfsenseUrl,
  apiKey: cfg.pfsenseApiKey,
  verifyTls: cfg.pfsenseVerifyTls,
});

console.log(JSON.stringify({ level: 'info', msg: 'running initial sync poll' }));
const first = await runOnePoll({
  db, client, ouiMap, geoRanges,
  now: Math.floor(Date.now() / 1000),
  staleAfterSec: cfg.pollIntervalSec * 10,
  ntfyTopicUrl: cfg.ntfyTopicUrl,
  graceSec: cfg.newDeviceGraceMinutes * 60,
  wanOverride: cfg.wanInterfaceName,
});
console.log(JSON.stringify({ level: 'info', msg: 'initial poll done', ...first }));

const sched = startScheduler({
  db, client, ouiMap, geoRanges,
  intervalSec: cfg.pollIntervalSec,
  staleAfterSec: cfg.pollIntervalSec * 10,
  ntfyTopicUrl: cfg.ntfyTopicUrl,
  graceSec: cfg.newDeviceGraceMinutes * 60,
  wanOverride: cfg.wanInterfaceName,
});

const app = express();
app.get('/api/health', buildHealthRouter());

const server = app.listen(cfg.port, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'http listening', port: cfg.port }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', msg: 'shutdown', signal }));
  sched.stop();
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

- [ ] **Step 3: Local smoke test (no pfSense needed)**

```bash
PFSENSE_URL=http://127.0.0.1:1 PFSENSE_API_KEY=x DB_PATH=./data/test.db \
OUI_PATH=./data/oui.csv GEOIP_PATH=./data/dbip-country-lite.csv \
POLL_INTERVAL_SECONDS=5 NEW_DEVICE_GRACE_MINUTES=0 \
node src/index.js &
SERVER_PID=$!
sleep 3
curl -sf http://localhost:8080/api/health
kill $SERVER_PID
```

Expected: `{"status":"ok",...}`; `data/test.db` contains a failed poll_log row.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.js src/config.js
git commit -m "feat: wire poller orchestrator into Express bootstrap with initial sync"
```

---

### Task E5: End-to-end Docker smoke

**Files:**
- (none new)

- [ ] **Step 1: Build the image**

```bash
docker build -t pfmon:dev .
```

- [ ] **Step 2: Sanity run with an unreachable pfSense**

```bash
docker run --rm -d --name pfmon-smoke -p 8080:8080 \
  -e PFSENSE_URL=http://127.0.0.1:1 \
  -e PFSENSE_API_KEY=test \
  -e PFSENSE_VERIFY_TLS=false \
  -e POLL_INTERVAL_SECONDS=10 \
  -v "$(pwd)/data:/data" \
  pfmon:dev
sleep 4
curl -sf http://localhost:8080/api/health
docker logs pfmon-smoke | head -20
docker stop pfmon-smoke
```

Expected: healthcheck 200; logs show failed pfSense poll plus ongoing server; SQLite file under `./data/` exists.

- [ ] **Step 3: Optional — run against your real pfSense**

```bash
docker run -d --name pfmon -p 8080:8080 \
  -e PFSENSE_URL=https://pfsense.lan \
  -e PFSENSE_API_KEY="$REAL_KEY" \
  -e PFSENSE_VERIFY_TLS=true \
  -e POLL_INTERVAL_SECONDS=30 \
  -v "$(pwd)/data:/data" \
  pfmon:dev

sleep 35
docker logs pfmon | tail -20
```

To inspect the DB:

```bash
docker exec -it pfmon sh -c "ls -la /data && \
  node -e \"const D = require('better-sqlite3'); const db = new D('/data/pfmon.db'); \
  console.log('interfaces:', db.prepare('SELECT pfsense_name, kind, ipv4_subnet FROM interfaces').all()); \
  console.log('devices:', db.prepare('SELECT COUNT(*) AS n FROM devices').get()); \
  console.log('poll_log tail:', db.prepare('SELECT ts, success, duration_ms, error_msg FROM poll_log ORDER BY ts DESC LIMIT 3').all());\""
```

If any pfSense endpoint returns 404, adjust the `ENDPOINTS` constant in `src/poller/pfsense.js`, rebuild, and re-run.

- [ ] **Step 4: Commit any endpoint-path fixes (if needed) and push**

```bash
git add src/poller/pfsense.js
git commit -m "fix: align pfRest endpoint paths to actual API version"
git push
```

---

## Self-review

Spec coverage:

- **Section 1 (Overview/Goals)** — data ingestion goal met by end of plan.
- **Section 2 (Architecture)** — single container with Express + poller + SQLite delivered (Tasks A4, A7, E3, E4).
- **Section 3 (Data scope)** — essentials + identity + traffic + security + network + uptime captured (Tasks C2-C5, D1-D5, E1).
- **Section 4 (Schema)** — full schema migrated in Task B1, including the user-facing tables and counter-state helper tables.
- **Section 5 (Polling cycle)** — auth via X-API-Key, transactional reconciliation, backoff implemented (Tasks C5, D2-D5, E3, E4).
- **Section 6 (Frontend)** — out of scope for this plan; deferred to Plan 2.
- **Section 7 (Configuration)** — all env vars threaded through `src/config.js` (Task E4) and `.env.example` (Task A3).
- **Section 8 (Deployment)** — Dockerfile, compose, healthcheck, non-root user (Tasks A7, A8).
- **Section 9 (Versioning & release)** — Conventional Commits enforced via commitlint (Task A6); release-please workflow comes in Plan 3.
- **Section 10 (Testing)** — vitest + supertest + fixture servers used throughout; CI smoke in Task A9.
- **Section 11 (File layout)** — matches paths used in this plan.

No placeholder text. Type consistency: snapshot shape `{ mac, vendor, hostname, ip, ipv6, interface, lease_type, lease_expires_at, states_count, rx_bytes_total, tx_bytes_total, device_type_guess, countries }` is the same across `snapshot.js`, `reconcile.js`, `alerts.js`, and `index.js`. The `reconcileDevices`, `recordTrafficSamples`, `recordInterfaceTrafficSamples`, `recordGeoConnections`, `recordFirewallBlocks`, `syncInterfaces` names match between definition and use.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-pfmon-01-foundation-and-ingestion.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
