# pfmon Plan 2: Web Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user-facing web dashboard on top of the data ingestion foundation delivered in Plan 1. End state: opening `http://<host>:8080/` in a browser shows a master/detail device list, a network-wide WAN bandwidth chart, a new-device alerts banner, and per-device detail including uptime/traffic charts. Light + dark themes with a header toggle. All interactivity via HTMX fragment swaps; no SPA build step.

**Architecture:** Express renders a single shell page at `/`. Inside the shell, HTMX polls fragment endpoints every 30s (`/fragments/alerts`, `/fragments/wan-summary`, `/fragments/device-list`, `/fragments/device/:id`). Inline edits go through PATCH/POST/DELETE endpoints that return the updated fragment HTML. Charts are server-rendered inline SVG — no JS chart library. Themes are pure CSS variables toggled via `[data-theme]` attribute; preference saved to `localStorage` with an inline anti-FOUC script in `<head>`.

**Tech stack additions:** EJS (templates), no other runtime deps. Dev: cheerio (already installed in Plan 1) for HTML structure assertions in tests.

**End-of-plan milestone:** `docker compose up -d` against a real pfSense plus `curl http://localhost:8080/` returns the page shell. Loading in a browser shows live device data, WAN chart, alerts banner, theme toggle works, inline edits persist. All HTMX endpoints have unit/route tests. CI green.

**Out of scope for this plan:** Authentication (LAN-trust only per spec). Release automation (Plan 3).

---

## Phase A — Page shell and static assets

### Task A1: Install EJS and add view engine setup

**Files:**
- Modify: `package.json` (add `ejs` runtime dep)
- Modify: `src/index.js` (configure view engine + static dir)

- [ ] **Step 1: Install ejs**

```bash
npm install ejs
```

- [ ] **Step 2: Edit `src/index.js` to register EJS and static serving**

Find this block at the top of `src/index.js`:

```js
const app = express();
app.get('/api/health', buildHealthRouter());
```

Replace it with:

```js
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use('/static', express.static(join(__dirname, 'static')));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', buildHealthRouter());
```

The two new imports (`fileURLToPath`, `dirname`, `join`) should go alongside the other imports at the top of the file; don't duplicate them if they already exist after Plan 1.

- [ ] **Step 3: Boot to confirm no regression**

```bash
PFSENSE_URL=http://127.0.0.1:1 PFSENSE_API_KEY=x \
  OUI_PATH=./data/oui.csv GEOIP_PATH=./data/dbip-country-lite.csv \
  DB_PATH=./data/test.db POLL_INTERVAL_SECONDS=30 PORT=8085 \
  node src/index.js &
SERVER_PID=$!
sleep 2
curl -sf http://localhost:8085/api/health
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
rm -f data/test.db data/test.db-shm data/test.db-wal
```

Expected: healthcheck still returns 200.

- [ ] **Step 4: Run test suite**

```bash
npm test
```

Expected: all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/index.js
git commit -m "feat: register EJS view engine + static file serving"
```

---

### Task A2: Theme tokens — `src/static/pfmon.css`

**Files:**
- Create: `src/static/pfmon.css`

- [ ] **Step 1: Write the base stylesheet with CSS variables**

```css
:root {
  color-scheme: light dark;
}

html[data-theme="light"],
html:not([data-theme]) {
  --bg: #ffffff;
  --bg-elevated: #fafbfc;
  --bg-row-hover: #f3f4f6;
  --bg-selected: #dbeafe;
  --bg-header: #1e293b;
  --fg: #0f172a;
  --fg-on-header: #ffffff;
  --fg-muted: #64748b;
  --fg-dim: #94a3b8;
  --border: #e5e7eb;
  --border-strong: #d1d5db;
  --accent: #2563eb;
  --accent-bg: #dbeafe;
  --danger: #dc2626;
  --danger-bg: #fee2e2;
  --danger-strong: #991b1b;
  --warning: #f59e0b;
  --warning-bg: #fef3c7;
  --warning-strong: #92400e;
  --success: #22c55e;
}

html[data-theme="dark"] {
  --bg: #0b1220;
  --bg-elevated: #0f172a;
  --bg-row-hover: #1e293b;
  --bg-selected: #1e3a8a;
  --bg-header: #020617;
  --fg: #e2e8f0;
  --fg-on-header: #f1f5f9;
  --fg-muted: #94a3b8;
  --fg-dim: #64748b;
  --border: #1e293b;
  --border-strong: #334155;
  --accent: #60a5fa;
  --accent-bg: #1e3a8a;
  --danger: #f87171;
  --danger-bg: #450a0a;
  --danger-strong: #fecaca;
  --warning: #fcd34d;
  --warning-bg: #422006;
  --warning-strong: #fbbf24;
  --success: #4ade80;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  background: var(--bg);
  color: var(--fg);
}

.header {
  background: var(--bg-header);
  color: var(--fg-on-header);
  padding: 10px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.header .meta {
  font-size: 12px;
  color: var(--fg-dim);
}

.theme-toggle {
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--fg-on-header);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.theme-toggle:hover { background: var(--bg-row-hover); }

.alerts-banner {
  background: var(--warning-bg);
  border-bottom: 1px solid var(--warning);
  color: var(--warning-strong);
  padding: 8px 16px;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.alerts-banner.error {
  background: var(--danger-bg);
  border-bottom-color: var(--danger);
  color: var(--danger-strong);
}

.wan-summary {
  padding: 14px 16px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
}

.controls {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.controls input,
.controls select {
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg);
  color: var(--fg);
  font-size: 12px;
}

.controls input { flex: 1; min-width: 180px; }

.master-detail {
  display: flex;
  min-height: 420px;
}

.master {
  flex: 0.55;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  max-height: calc(100vh - 220px);
}

.detail {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  max-height: calc(100vh - 220px);
}

table.device-list {
  width: 100%;
  border-collapse: collapse;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

table.device-list thead th {
  background: var(--bg-row-hover);
  border-bottom: 1px solid var(--border-strong);
  text-align: left;
  padding: 6px 10px;
  font-weight: 600;
  position: sticky;
  top: 0;
}

table.device-list tbody tr {
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

table.device-list tbody tr:hover { background: var(--bg-row-hover); }
table.device-list tbody tr.selected { background: var(--bg-selected); border-left: 3px solid var(--accent); }
table.device-list tbody tr.new-device { background: var(--danger-bg); border-left: 3px solid var(--danger); color: var(--danger-strong); }
table.device-list tbody tr.offline { color: var(--fg-dim); }

table.device-list td { padding: 6px 10px; }

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
  background: var(--success);
}

.status-dot.offline { background: var(--fg-dim); }
.status-dot.new { background: var(--danger); }

.badge {
  display: inline-block;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 3px;
  background: var(--danger);
  color: white;
  margin-left: 4px;
}

.tag-chip {
  display: inline-block;
  background: var(--accent-bg);
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  margin-right: 4px;
  margin-bottom: 2px;
}

.tag-chip button {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0 0 0 4px;
  font-size: 12px;
}

.detail h2 { margin: 0 0 4px 0; font-size: 18px; }
.detail .subtitle { color: var(--fg-muted); font-size: 12px; margin-bottom: 14px; }
.detail dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; }
.detail dt { color: var(--fg-muted); font-size: 12px; }
.detail dd { margin: 0; font-size: 13px; word-break: break-all; }
.detail .inline-edit { background: transparent; border: 1px dashed var(--border-strong); color: var(--fg); padding: 0 4px; font-family: inherit; font-size: inherit; }
.detail textarea.inline-edit { width: 100%; min-height: 60px; resize: vertical; }

.chart-block {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.chart-block .label {
  font-size: 11px;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

button.action {
  padding: 3px 10px;
  border: 1px solid var(--border-strong);
  background: var(--bg);
  color: var(--fg);
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
}

button.action:hover { background: var(--bg-row-hover); }
button.action.primary { background: var(--accent); color: white; border-color: var(--accent); }

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
```

- [ ] **Step 2: Commit**

```bash
git add src/static/pfmon.css
git commit -m "feat: theme tokens and base stylesheet with light + dark variants"
```

---

### Task A3: Vendor `htmx.min.js` (no CDN at runtime)

**Files:**
- Create: `src/static/htmx.min.js` (downloaded, not hand-written)

We pin HTMX 2.x at build time. No CDN at runtime so the dashboard works offline.

- [ ] **Step 1: Download HTMX 2.x**

```bash
curl -fLo src/static/htmx.min.js https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js
```

Verify the file is non-empty (~50KB):

```bash
ls -lh src/static/htmx.min.js
```

- [ ] **Step 2: Commit**

```bash
git add src/static/htmx.min.js
git commit -m "build: vendor HTMX 2.0.4 client (avoid runtime CDN dep)"
```

---

### Task A4: Theme toggle script — `src/static/theme.js`

**Files:**
- Create: `src/static/theme.js`

This is the anti-FOUC inline script logic, but kept as a standalone file. Plan A5 will inline it in the layout template's `<head>`.

- [ ] **Step 1: Write the toggle**

```js
(function () {
  const KEY = 'pfmon-theme';
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }
  function preferred() {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  apply(preferred());
  window.pfmonToggleTheme = function () {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
  };
})();
```

- [ ] **Step 2: Commit**

```bash
git add src/static/theme.js
git commit -m "feat: theme toggle script with localStorage + prefers-color-scheme"
```

---

### Task A5: Layout template `src/views/layout.ejs` + GET / route

**Files:**
- Create: `src/views/layout.ejs`
- Create: `src/routes/page.js`
- Modify: `src/index.js` (mount page router)
- Create: `tests/page-shell.test.js`

- [ ] **Step 1: Write the failing test `tests/page-shell.test.js`**

```js
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPageRouter } from '../src/routes/page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, '..', 'src', 'views'));
  app.use(buildPageRouter());
  return app;
}

describe('GET /', () => {
  it('returns HTML 200 with the page shell', async () => {
    const res = await request(makeApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    const $ = cheerio.load(res.text);
    expect($('header.header h1').text()).toMatch(/pfmon/i);
    expect($('[data-fragment="device-list"]').length).toBe(1);
    expect($('[data-fragment="wan-summary"]').length).toBe(1);
    expect($('[data-fragment="alerts"]').length).toBe(1);
    expect($('#detail-panel').length).toBe(1);
    expect($('button.theme-toggle').length).toBe(1);
  });

  it('includes anti-FOUC inline theme script in head before stylesheet', async () => {
    const res = await request(makeApp()).get('/');
    const $ = cheerio.load(res.text);
    const head = $('head').html() ?? '';
    const inlineIdx = head.indexOf('data-theme');
    const cssIdx = head.indexOf('pfmon.css');
    expect(inlineIdx).toBeGreaterThan(-1);
    expect(cssIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeLessThan(cssIdx);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- tests/page-shell.test.js
```

- [ ] **Step 3: Write `src/views/layout.ejs`**

```ejs
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>pfmon</title>
  <script>
    (function () {
      var key = 'pfmon-theme';
      var stored = null;
      try { stored = localStorage.getItem(key); } catch (e) {}
      var theme = (stored === 'light' || stored === 'dark')
        ? stored
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', theme);
    })();
  </script>
  <link rel="stylesheet" href="/static/pfmon.css">
  <script src="/static/htmx.min.js" defer></script>
  <script src="/static/theme.js" defer></script>
</head>
<body>
  <header class="header">
    <h1>pfmon</h1>
    <span class="meta" hx-get="/fragments/header-meta" hx-trigger="load, every 30s" hx-swap="innerHTML"></span>
    <button class="theme-toggle" type="button" onclick="pfmonToggleTheme()">Light / Dark</button>
  </header>

  <div data-fragment="alerts" hx-get="/fragments/alerts" hx-trigger="load, every 30s" hx-swap="innerHTML"></div>

  <div data-fragment="wan-summary" hx-get="/fragments/wan-summary" hx-trigger="load, every 30s" hx-swap="innerHTML"></div>

  <form class="controls" hx-get="/fragments/device-list" hx-target="[data-fragment='device-list']" hx-trigger="input changed delay:300ms, change">
    <input type="search" name="q" placeholder="Search name, IP, MAC, vendor, tag...">
    <select name="status">
      <option value="">All status</option>
      <option value="online">Online</option>
      <option value="offline">Offline</option>
      <option value="new">New</option>
    </select>
    <select name="vlan">
      <option value="">VLAN: All</option>
    </select>
    <select name="sort">
      <option value="last_seen">Sort: last seen</option>
      <option value="name">Name</option>
      <option value="ip">IP</option>
      <option value="bytes_today">Bytes today</option>
    </select>
  </form>

  <div class="master-detail">
    <div class="master" data-fragment="device-list" hx-get="/fragments/device-list" hx-trigger="load, every 30s" hx-swap="innerHTML"></div>
    <div class="detail" id="detail-panel">
      <p class="subtitle">Select a device to see details.</p>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 4: Write `src/routes/page.js`**

```js
import express from 'express';

export function buildPageRouter() {
  const router = express.Router();
  router.get('/', (req, res) => {
    res.render('layout');
  });
  return router;
}
```

- [ ] **Step 5: Mount in `src/index.js`**

After the line `app.get('/api/health', buildHealthRouter());`, add:

```js
import { buildPageRouter } from './routes/page.js';
app.use(buildPageRouter());
```

(Import at top of file, not inline. The example above is illustrative.)

- [ ] **Step 6: Run tests**

```bash
npm test -- tests/page-shell.test.js
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/views/ src/routes/ src/index.js tests/page-shell.test.js
git commit -m "feat: page shell layout with HTMX wiring and anti-FOUC theme script"
```

---

## Phase B — Read fragments

### Task B1: Header meta fragment

**Files:**
- Create: `src/routes/fragments.js`
- Create: `src/views/fragments/header-meta.ejs`
- Create: `tests/fragment-header-meta.test.js`
- Modify: `src/index.js` (mount fragments router)

The header meta shows `<n> devices · <m> online · <v> VLANs · data <s>s old`.

- [ ] **Step 1: Write the failing test `tests/fragment-header-meta.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { buildFragmentsRouter } from '../src/routes/fragments.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, '..', 'src', 'views'));
  app.use(buildFragmentsRouter({ db }));
  return app;
}

describe('GET /fragments/header-meta', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  it('returns counts and freshness', async () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO interfaces (pfsense_name, kind) VALUES ('lan','lan'),('wan','wan'),('vlan10','vlan')`).run();
    db.prepare(`INSERT INTO devices (mac, is_online, first_seen_at, last_seen_at) VALUES
      ('a', 1, ?, ?), ('b', 1, ?, ?), ('c', 0, ?, ?)`).run(now, now, now, now, now - 3600, now - 3600);
    db.prepare(`INSERT INTO poll_log (ts, success, duration_ms) VALUES (?, 1, 10)`).run(now - 5);

    const res = await request(makeApp(db)).get('/fragments/header-meta');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/3 devices/);
    expect(res.text).toMatch(/2 online/);
    expect(res.text).toMatch(/1 VLAN/);
    expect(res.text).toMatch(/data \d+s old/);
  });

  it('says "never polled" when poll_log is empty', async () => {
    const res = await request(makeApp(db)).get('/fragments/header-meta');
    expect(res.text).toMatch(/never polled/i);
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm test -- tests/fragment-header-meta.test.js
```

- [ ] **Step 3: Create `src/routes/fragments.js`**

```js
import express from 'express';

export function buildFragmentsRouter({ db }) {
  const router = express.Router();

  router.get('/fragments/header-meta', (req, res) => {
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM devices) AS total,
        (SELECT COUNT(*) FROM devices WHERE is_online = 1) AS online,
        (SELECT COUNT(*) FROM interfaces WHERE kind = 'vlan') AS vlans
    `).get();
    const lastPoll = db.prepare('SELECT ts FROM poll_log WHERE success = 1 ORDER BY ts DESC LIMIT 1').get();
    const freshness = lastPoll ? (Math.floor(Date.now() / 1000) - lastPoll.ts) : null;
    res.render('fragments/header-meta', { ...counts, freshness });
  });

  return router;
}
```

- [ ] **Step 4: Create `src/views/fragments/header-meta.ejs`**

```ejs
<%= total %> devices &middot; <%= online %> online &middot; <%= vlans %> VLAN<%= vlans === 1 ? '' : 's' %> &middot; <% if (freshness === null) { %>never polled<% } else { %>data <%= freshness %>s old<% } %>
```

- [ ] **Step 5: Mount fragments router in `src/index.js`**

```js
import { buildFragmentsRouter } from './routes/fragments.js';
app.use(buildFragmentsRouter({ db }));
```

(Place after the page router mount.)

- [ ] **Step 6: Tests pass**

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/routes/fragments.js src/views/fragments/ src/index.js tests/fragment-header-meta.test.js
git commit -m "feat: header-meta fragment with device counts and poll freshness"
```

---

### Task B2: Device list fragment with search / status / VLAN / sort

**Files:**
- Modify: `src/routes/fragments.js`
- Create: `src/views/fragments/device-list.ejs`
- Create: `tests/fragment-device-list.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { buildFragmentsRouter } from '../src/routes/fragments.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, '..', 'src', 'views'));
  app.use(buildFragmentsRouter({ db }));
  return app;
}

function seed(db) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO interfaces (pfsense_name, friendly_name, kind, ipv4_subnet) VALUES
    ('lan','LAN','lan','10.0.0.0/24'),
    ('vlan20','IoT','vlan','10.20.0.0/24')`).run();
  const ifLan = db.prepare("SELECT id FROM interfaces WHERE pfsense_name='lan'").get().id;
  const ifIot = db.prepare("SELECT id FROM interfaces WHERE pfsense_name='vlan20'").get().id;
  db.prepare(`INSERT INTO devices
    (mac, vendor, hostname, nickname, current_ip, interface_id, is_online, first_seen_at, last_seen_at, new_until_seen_at)
    VALUES
    ('aa:bb:cc:dd:ee:01', 'LG', 'living-room-tv', NULL, '10.0.0.42', ?, 1, ?, ?, NULL),
    ('aa:bb:cc:dd:ee:02', 'Apple Inc.', NULL, 'jane-iphone', '10.0.0.51', ?, 1, ?, ?, NULL),
    ('aa:bb:cc:dd:ee:03', 'Espressif', 'unknown', NULL, '10.20.0.99', ?, 1, ?, ?, ?),
    ('aa:bb:cc:dd:ee:04', 'Amazon', 'echo-dot', NULL, '10.20.0.31', ?, 0, ?, ?, NULL)
  `).run(ifLan, now, now, ifLan, now, now, ifIot, now, now, now, ifIot, now - 7200, now - 7200);
  return db;
}

describe('GET /fragments/device-list', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    seed(db);
  });

  it('renders all devices by default', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list');
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    expect($('table.device-list tbody tr').length).toBe(4);
  });

  it('filters by status=online', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list?status=online');
    const $ = cheerio.load(res.text);
    expect($('table.device-list tbody tr').length).toBe(3);
  });

  it('filters by status=new', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list?status=new');
    const $ = cheerio.load(res.text);
    expect($('table.device-list tbody tr').length).toBe(1);
    expect($('table.device-list tbody tr').first().hasClass('new-device')).toBe(true);
  });

  it('filters by VLAN', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list?vlan=vlan20');
    const $ = cheerio.load(res.text);
    expect($('table.device-list tbody tr').length).toBe(2);
  });

  it('searches across nickname/hostname/ip/mac/vendor', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list?q=jane');
    const $ = cheerio.load(res.text);
    expect($('table.device-list tbody tr').length).toBe(1);
  });

  it('uses nickname when present, hostname otherwise', async () => {
    const res = await request(makeApp(db)).get('/fragments/device-list');
    expect(res.text).toContain('jane-iphone');
    expect(res.text).toContain('living-room-tv');
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm test -- tests/fragment-device-list.test.js
```

- [ ] **Step 3: Add to `src/routes/fragments.js`**

Insert this route into `buildFragmentsRouter` (after the header-meta route, before `return router`):

```js
  router.get('/fragments/device-list', (req, res) => {
    const { q = '', status = '', vlan = '', sort = 'last_seen' } = req.query;
    const SEC = (n) => Math.floor(Date.now() / 1000) - n;

    const where = ['1=1'];
    const params = {};

    if (status === 'online') where.push('d.is_online = 1');
    else if (status === 'offline') where.push('d.is_online = 0');
    else if (status === 'new') where.push('d.new_until_seen_at IS NOT NULL');

    if (vlan) {
      where.push('i.pfsense_name = @vlan');
      params.vlan = vlan;
    }

    if (q) {
      where.push(`(
        COALESCE(d.nickname,'') LIKE @qLike OR
        COALESCE(d.hostname,'') LIKE @qLike OR
        COALESCE(d.current_ip,'') LIKE @qLike OR
        d.mac LIKE @qLike OR
        COALESCE(d.vendor,'') LIKE @qLike OR
        EXISTS (SELECT 1 FROM device_tags t WHERE t.device_id = d.id AND t.tag LIKE @qLike)
      )`);
      params.qLike = `%${q}%`;
    }

    let orderBy = 'd.last_seen_at DESC';
    if (sort === 'name') orderBy = "COALESCE(d.nickname, d.hostname, '') COLLATE NOCASE";
    else if (sort === 'ip') orderBy = "d.current_ip";
    else if (sort === 'bytes_today') {
      orderBy = `(SELECT COALESCE(SUM(rx_bytes + tx_bytes), 0)
                  FROM traffic_hourly th
                  WHERE th.device_id = d.id AND th.hour_bucket >= @todayStart) DESC`;
      params.todayStart = SEC(24 * 3600);
    }

    const rows = db.prepare(`
      SELECT d.id, d.mac, d.vendor, d.hostname, d.nickname, d.current_ip,
             d.is_online, d.last_seen_at, d.new_until_seen_at,
             i.pfsense_name AS interface_name, i.friendly_name AS interface_friendly,
             (SELECT COALESCE(SUM(rx_bytes + tx_bytes), 0)
              FROM traffic_hourly th
              WHERE th.device_id = d.id AND th.hour_bucket >= @bytesTodayStart) AS bytes_today
      FROM devices d
      LEFT JOIN interfaces i ON i.id = d.interface_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
    `).all({ ...params, bytesTodayStart: SEC(24 * 3600) });

    const vlans = db.prepare(`SELECT pfsense_name, friendly_name FROM interfaces WHERE kind != 'wan' ORDER BY pfsense_name`).all();

    res.render('fragments/device-list', {
      rows,
      vlans,
      now: Math.floor(Date.now() / 1000),
      query: { q, status, vlan, sort },
      formatRelative,
      formatBytes,
    });
  });
```

Also add the formatter helpers at the top of `src/routes/fragments.js` (outside `buildFragmentsRouter`):

```js
function formatRelative(ts, now) {
  if (!ts) return '-';
  const dt = now - ts;
  if (dt < 60) return 'now';
  if (dt < 3600) return `${Math.floor(dt / 60)}m`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h`;
  return `${Math.floor(dt / 86400)}d`;
}

function formatBytes(n) {
  if (!n) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}
```

- [ ] **Step 4: Create `src/views/fragments/device-list.ejs`**

```ejs
<table class="device-list">
  <thead>
    <tr>
      <th>Name</th>
      <th>IP</th>
      <th>VLAN</th>
      <th>Down today</th>
      <th>Last</th>
    </tr>
  </thead>
  <tbody>
    <% if (rows.length === 0) { %>
      <tr><td colspan="5" class="subtitle" style="padding: 12px; text-align: center;">No devices match.</td></tr>
    <% } %>
    <% rows.forEach(function(d) {
        const isNew = d.new_until_seen_at !== null;
        const rowCls = isNew ? 'new-device' : (d.is_online ? '' : 'offline');
        const dotCls = isNew ? 'new' : (d.is_online ? '' : 'offline');
        const display = d.nickname || d.hostname || `(${d.mac.slice(0, 8)}...)`;
    %>
      <tr class="<%= rowCls %>"
          hx-get="/fragments/device/<%= d.id %>"
          hx-target="#detail-panel"
          hx-swap="innerHTML"
          hx-on::after-request="document.querySelectorAll('table.device-list tbody tr.selected').forEach(r=>r.classList.remove('selected')); this.classList.add('selected')">
        <td>
          <span class="status-dot <%= dotCls %>"></span>
          <%= display %><% if (isNew) { %><span class="badge">NEW</span><% } %>
        </td>
        <td><%= d.current_ip || '-' %></td>
        <td><%= d.interface_friendly || d.interface_name || '-' %></td>
        <td><%= formatBytes(d.bytes_today) %></td>
        <td><%= formatRelative(d.last_seen_at, now) %></td>
      </tr>
    <% }); %>
  </tbody>
</table>
```

- [ ] **Step 5: Tests pass**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/fragments.js src/views/fragments/device-list.ejs tests/fragment-device-list.test.js
git commit -m "feat: device list fragment with search, status, VLAN, sort filters"
```

---

### Task B3: Alerts banner fragment

**Files:**
- Modify: `src/routes/fragments.js`
- Create: `src/views/fragments/alerts.ejs`
- Create: `tests/fragment-alerts.test.js`

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { buildFragmentsRouter } from '../src/routes/fragments.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, '..', 'src', 'views'));
  app.use(buildFragmentsRouter({ db }));
  return app;
}

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('GET /fragments/alerts', () => {
  it('renders empty when no new devices and last poll succeeded', async () => {
    const db = setup();
    db.prepare(`INSERT INTO poll_log (ts, success) VALUES (?, 1)`).run(Math.floor(Date.now() / 1000));
    const res = await request(makeApp(db)).get('/fragments/alerts');
    expect(res.status).toBe(200);
    expect(res.text.trim()).toBe('');
  });

  it('renders a yellow banner when there are new devices', async () => {
    const db = setup();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO devices (mac, vendor, hostname, current_ip, is_online, first_seen_at, last_seen_at, new_until_seen_at)
                VALUES ('aa:bb:cc:dd:ee:99', 'Espressif', 'unknown', '10.20.0.99', 1, ?, ?, ?)`).run(now, now, now);
    const res = await request(makeApp(db)).get('/fragments/alerts');
    const $ = cheerio.load(res.text);
    expect($('.alerts-banner').length).toBe(1);
    expect($('.alerts-banner').hasClass('error')).toBe(false);
    expect(res.text).toMatch(/unknown|10\.20\.0\.99|Espressif/);
  });

  it('renders a red banner when last poll failed', async () => {
    const db = setup();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO poll_log (ts, success, error_msg) VALUES (?, 0, 'fetch failed')`).run(now);
    const res = await request(makeApp(db)).get('/fragments/alerts');
    const $ = cheerio.load(res.text);
    expect($('.alerts-banner.error').length).toBe(1);
    expect(res.text).toMatch(/fetch failed/);
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm test -- tests/fragment-alerts.test.js
```

- [ ] **Step 3: Add to `src/routes/fragments.js`**

Inside `buildFragmentsRouter` before `return router`:

```js
  router.get('/fragments/alerts', (req, res) => {
    const newDevices = db.prepare(`
      SELECT d.id, d.mac, d.vendor, d.hostname, d.current_ip, i.pfsense_name AS interface_name
      FROM devices d
      LEFT JOIN interfaces i ON i.id = d.interface_id
      WHERE d.new_until_seen_at IS NOT NULL
      ORDER BY d.first_seen_at DESC
    `).all();
    const lastPoll = db.prepare('SELECT success, error_msg, ts FROM poll_log ORDER BY ts DESC LIMIT 1').get();
    const pollFailed = lastPoll && lastPoll.success === 0;
    res.render('fragments/alerts', { newDevices, pollFailed, pollError: lastPoll?.error_msg ?? null });
  });
```

- [ ] **Step 4: Create `src/views/fragments/alerts.ejs`**

```ejs
<% if (pollFailed) { %>
  <div class="alerts-banner error">
    <span><strong>Last poll failed:</strong> <%= pollError || 'unknown error' %></span>
  </div>
<% } %>
<% newDevices.forEach(function(d) { %>
  <div class="alerts-banner">
    <span>
      <strong>New device</strong> &mdash;
      <%= d.hostname || d.vendor || d.mac %> (<%= d.current_ip %><% if (d.interface_name) { %> on <%= d.interface_name %><% } %>)
    </span>
    <button class="action"
            hx-post="/devices/<%= d.id %>/dismiss-new"
            hx-target="closest .alerts-banner"
            hx-swap="outerHTML">Dismiss</button>
  </div>
<% }); %>
```

- [ ] **Step 5: Tests pass**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/fragments.js src/views/fragments/alerts.ejs tests/fragment-alerts.test.js
git commit -m "feat: alerts banner fragment for new devices and poll failures"
```

---

### Task B4: WAN summary fragment with embedded SVG chart

**Files:**
- Modify: `src/routes/fragments.js`
- Create: `src/views/fragments/wan-summary.ejs`
- Create: `src/charts/wan-chart.js` (server-side SVG builder)
- Create: `tests/fragment-wan-summary.test.js`
- Create: `tests/wan-chart.test.js`

- [ ] **Step 1: Failing test for the SVG chart builder `tests/wan-chart.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { renderWanChartSvg } from '../src/charts/wan-chart.js';

describe('renderWanChartSvg', () => {
  it('returns an empty placeholder when no samples', () => {
    const svg = renderWanChartSvg({ samples: [], width: 600, height: 80 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('No data');
  });

  it('renders two stacked polygons for down + up when samples exist', () => {
    const now = Math.floor(Date.now() / 1000);
    const samples = Array.from({ length: 24 }, (_, i) => ({
      ts: now - (24 - i) * 3600,
      rx_bytes: 1000 * (i + 1),
      tx_bytes: 200 * (i + 1),
    }));
    const svg = renderWanChartSvg({ samples, width: 600, height: 80 });
    const polys = svg.match(/<polygon/g) ?? [];
    expect(polys.length).toBe(2);
    expect(svg).toContain('viewBox="0 0 600 80"');
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm test -- tests/wan-chart.test.js
```

- [ ] **Step 3: Implement `src/charts/wan-chart.js`**

```js
function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

export function renderWanChartSvg({ samples, width = 600, height = 80, downColor = '#3b82f6', upColor = '#ef4444' }) {
  if (!samples || samples.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      <text x="50%" y="50%" text-anchor="middle" font-size="11" fill="#64748b">No data yet</text>
    </svg>`;
  }
  const maxRx = Math.max(...samples.map(s => s.rx_bytes), 1);
  const maxTx = Math.max(...samples.map(s => s.tx_bytes), 1);
  const max = Math.max(maxRx, maxTx);
  const n = samples.length;
  const stepX = width / Math.max(n - 1, 1);
  function toPoints(key) {
    const points = samples.map((s, i) => {
      const x = i * stepX;
      const y = height - (s[key] / max) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `${points.join(' ')} ${width},${height} 0,${height}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    <polygon points="${toPoints('rx_bytes')}" fill="${escapeXml(downColor)}" opacity="0.55"/>
    <polygon points="${toPoints('tx_bytes')}" fill="${escapeXml(upColor)}" opacity="0.55"/>
  </svg>`;
}
```

- [ ] **Step 4: Failing test for the route `tests/fragment-wan-summary.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { buildFragmentsRouter } from '../src/routes/fragments.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, '..', 'src', 'views'));
  app.use(buildFragmentsRouter({ db }));
  return app;
}

function seed(db) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES ('wan', 'WAN', 'wan')`).run();
  const wanId = db.prepare("SELECT id FROM interfaces WHERE pfsense_name='wan'").get().id;
  const dayStart = now - 24 * 3600;
  for (let i = 0; i < 24; i++) {
    const hour = dayStart + i * 3600;
    db.prepare(`INSERT INTO interface_traffic_hourly (interface_id, hour_bucket, rx_bytes, tx_bytes, peak_rx_rate, peak_tx_rate)
                VALUES (?, ?, ?, ?, ?, ?)`).run(wanId, hour, 1000 * (i + 1), 200 * (i + 1), 100, 30);
  }
}

describe('GET /fragments/wan-summary', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    seed(db);
  });

  it('renders today/week/month totals and an inline SVG', async () => {
    const res = await request(makeApp(db)).get('/fragments/wan-summary');
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    expect($('.wan-summary').length).toBe(1);
    expect($('.wan-summary svg').length).toBe(1);
    expect(res.text).toMatch(/today/i);
    expect(res.text).toMatch(/week/i);
    expect(res.text).toMatch(/month/i);
  });

  it('handles missing WAN interface gracefully', async () => {
    const empty = new Database(':memory:');
    runMigrations(empty);
    const res = await request(makeApp(empty)).get('/fragments/wan-summary');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/no wan/i);
  });
});
```

- [ ] **Step 5: Run → fail**

```bash
npm test -- tests/fragment-wan-summary.test.js
```

- [ ] **Step 6: Add to `src/routes/fragments.js`**

Add the import at the top:

```js
import { renderWanChartSvg } from '../charts/wan-chart.js';
```

Insert route inside `buildFragmentsRouter`:

```js
  router.get('/fragments/wan-summary', (req, res) => {
    const range = req.query.range === '7d' ? '7d' : (req.query.range === '30d' ? '30d' : '24h');
    const rangeSec = range === '24h' ? 24 * 3600 : (range === '7d' ? 7 * 86400 : 30 * 86400);
    const now = Math.floor(Date.now() / 1000);

    const wan = db.prepare(`SELECT id, friendly_name FROM interfaces WHERE kind = 'wan' LIMIT 1`).get();
    if (!wan) {
      return res.render('fragments/wan-summary', { wan: null });
    }

    const samples = db.prepare(`
      SELECT hour_bucket AS ts, rx_bytes, tx_bytes
      FROM interface_traffic_hourly
      WHERE interface_id = ? AND hour_bucket >= ?
      ORDER BY hour_bucket
    `).all(wan.id, now - rangeSec);

    function totalSince(since) {
      const r = db.prepare(`
        SELECT COALESCE(SUM(rx_bytes), 0) AS rx, COALESCE(SUM(tx_bytes), 0) AS tx
        FROM interface_traffic_hourly
        WHERE interface_id = ? AND hour_bucket >= ?
      `).get(wan.id, since);
      return { rx: r.rx, tx: r.tx };
    }
    const today = totalSince(now - 24 * 3600);
    const week = totalSince(now - 7 * 86400);
    const month = totalSince(now - 30 * 86400);

    const chartSvg = renderWanChartSvg({ samples, width: 800, height: 90 });
    res.render('fragments/wan-summary', { wan, today, week, month, range, chartSvg, formatBytes });
  });
```

- [ ] **Step 7: Create `src/views/fragments/wan-summary.ejs`**

```ejs
<div class="wan-summary">
  <% if (!wan) { %>
    <p class="subtitle">No WAN interface detected yet. Waiting for poller to discover it.</p>
  <% } else { %>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px;">
      <div>
        <div style="font-size:10px;color:var(--fg-muted);text-transform:uppercase;letter-spacing:0.5px;">WAN &mdash; total internet traffic</div>
        <div style="font-size:18px;font-weight:bold;margin-top:2px;">Down: <%= formatBytes(today.rx) %> &middot; Up: <%= formatBytes(today.tx) %> <span style="font-size:11px;color:var(--fg-muted);font-weight:normal;">today</span></div>
        <div style="font-size:11px;color:var(--fg-muted);">This week: <%= formatBytes(week.rx) %> / <%= formatBytes(week.tx) %> &middot; This month: <%= formatBytes(month.rx) %> / <%= formatBytes(month.tx) %></div>
      </div>
      <div style="display:flex;gap:4px;font-size:11px;">
        <% ['24h','7d','30d'].forEach(function(r) { %>
          <button class="action <%= r === range ? 'primary' : '' %>"
                  hx-get="/fragments/wan-summary?range=<%= r %>"
                  hx-target="[data-fragment='wan-summary']"
                  hx-swap="innerHTML"><%= r %></button>
        <% }); %>
      </div>
    </div>
    <%- chartSvg %>
  <% } %>
</div>
```

- [ ] **Step 8: Tests pass**

```bash
npm test
```

- [ ] **Step 9: Commit**

```bash
git add src/charts/ src/routes/fragments.js src/views/fragments/wan-summary.ejs tests/wan-chart.test.js tests/fragment-wan-summary.test.js
git commit -m "feat: WAN summary fragment with today/week/month totals and 24h SVG chart"
```

---

### Task B5: Device detail fragment

**Files:**
- Modify: `src/routes/fragments.js`
- Create: `src/views/fragments/device-detail.ejs`
- Create: `src/charts/uptime-sparkline.js`
- Create: `src/charts/device-traffic-chart.js`
- Create: `tests/fragment-device-detail.test.js`
- Create: `tests/uptime-sparkline.test.js`
- Create: `tests/device-traffic-chart.test.js`

- [ ] **Step 1: Failing test for uptime sparkline `tests/uptime-sparkline.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { renderUptimeSparklineSvg } from '../src/charts/uptime-sparkline.js';

describe('renderUptimeSparklineSvg', () => {
  it('renders a single green bar when device is online the whole window', () => {
    const now = 1_700_000_000;
    const events = [{ ts: now - 86400, status: 'online' }];
    const svg = renderUptimeSparklineSvg({ events, windowStart: now - 86400, windowEnd: now, isOnlineNow: true });
    expect(svg).toContain('<rect');
    expect(svg).toMatch(/fill="[^"]*green|22c55e[^"]*"/i);
  });

  it('renders alternating segments for transitions', () => {
    const now = 1_700_000_000;
    const events = [
      { ts: now - 86400, status: 'online' },
      { ts: now - 43200, status: 'offline' },
      { ts: now - 21600, status: 'online' },
    ];
    const svg = renderUptimeSparklineSvg({ events, windowStart: now - 86400, windowEnd: now, isOnlineNow: true });
    const rects = svg.match(/<rect/g) ?? [];
    expect(rects.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm test -- tests/uptime-sparkline.test.js
```

- [ ] **Step 3: Implement `src/charts/uptime-sparkline.js`**

```js
const ONLINE = '#22c55e';
const OFFLINE = '#cbd5e1';

export function renderUptimeSparklineSvg({ events, windowStart, windowEnd, isOnlineNow, width = 400, height = 14 }) {
  const span = Math.max(windowEnd - windowStart, 1);
  if (!events || events.length === 0) {
    const color = isOnlineNow ? ONLINE : OFFLINE;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="${color}"/>
    </svg>`;
  }
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const segments = [];
  let cursor = windowStart;
  let currentStatus = sorted[0].status === 'online' ? 'offline' : 'online';
  for (const e of sorted) {
    if (e.ts < windowStart) { currentStatus = e.status; continue; }
    if (e.ts > windowEnd) break;
    if (e.ts > cursor) {
      segments.push({ start: cursor, end: e.ts, status: currentStatus });
    }
    cursor = e.ts;
    currentStatus = e.status;
  }
  if (cursor < windowEnd) {
    segments.push({ start: cursor, end: windowEnd, status: currentStatus });
  }
  const rects = segments.map((s) => {
    const x = ((s.start - windowStart) / span) * width;
    const w = ((s.end - s.start) / span) * width;
    const color = s.status === 'online' ? ONLINE : OFFLINE;
    return `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${height}" fill="${color}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">${rects}</svg>`;
}
```

- [ ] **Step 4: Failing test for device-traffic chart `tests/device-traffic-chart.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { renderDeviceTrafficSvg } from '../src/charts/device-traffic-chart.js';

describe('renderDeviceTrafficSvg', () => {
  it('renders placeholder text when no samples', () => {
    expect(renderDeviceTrafficSvg({ samples: [] })).toContain('No data');
  });
  it('renders stacked polygons for rx/tx', () => {
    const samples = Array.from({ length: 24 }, (_, i) => ({ ts: i * 3600, rx_bytes: 100 * (i + 1), tx_bytes: 30 * (i + 1) }));
    const svg = renderDeviceTrafficSvg({ samples });
    expect(svg.match(/<polygon/g)?.length).toBe(2);
  });
});
```

- [ ] **Step 5: Implement `src/charts/device-traffic-chart.js`**

```js
import { renderWanChartSvg } from './wan-chart.js';

export function renderDeviceTrafficSvg({ samples, width = 400, height = 50 }) {
  return renderWanChartSvg({ samples, width, height });
}
```

(Same algorithm. Different default dimensions. Re-using the WAN chart renderer keeps a single source of truth.)

- [ ] **Step 6: Failing test for the detail route `tests/fragment-device-detail.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { buildFragmentsRouter } from '../src/routes/fragments.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, '..', 'src', 'views'));
  app.use(buildFragmentsRouter({ db }));
  return app;
}

function seed(db) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO interfaces (pfsense_name, friendly_name, kind, ipv4_subnet) VALUES ('lan','LAN','lan','10.0.0.0/24')`).run();
  const ifLan = db.prepare("SELECT id FROM interfaces WHERE pfsense_name='lan'").get().id;
  const info = db.prepare(`INSERT INTO devices
    (mac, vendor, hostname, nickname, notes, device_type_guess, current_ip, current_ipv6, interface_id,
     current_lease_type, current_lease_expires_at, is_online, first_seen_at, last_seen_at)
    VALUES ('aa:bb:cc:dd:ee:01', 'LG', 'living-room-tv', NULL, 'WebOS TV', 'Smart TV',
      '10.0.0.42', 'fe80::1', ?, 'dynamic', ?, 1, ?, ?)
  `).run(ifLan, now + 3600, now - 86400 * 30, now);
  const id = info.lastInsertRowid;
  db.prepare(`INSERT INTO device_tags VALUES (?, 'iot'), (?, 'tv')`).run(id, id);
  db.prepare(`INSERT INTO geo_connections VALUES (?, 'US', ?, 42), (?, 'KR', ?, 8)`).run(id, now, id, now - 3600);
  return { db, id };
}

describe('GET /fragments/device/:id', () => {
  let db, id;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    ({ id } = seed(db));
  });

  it('returns 404 for missing device', async () => {
    const res = await request(makeApp(db)).get('/fragments/device/99999');
    expect(res.status).toBe(404);
  });

  it('renders nickname-or-hostname title and all key fields', async () => {
    const res = await request(makeApp(db)).get(`/fragments/device/${id}`);
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    expect($('h2').text()).toContain('living-room-tv');
    expect(res.text).toContain('10.0.0.42');
    expect(res.text).toContain('aa:bb:cc:dd:ee:01');
    expect(res.text).toContain('LG');
    expect(res.text).toContain('Smart TV');
    expect(res.text).toContain('iot');
    expect(res.text).toContain('tv');
    expect(res.text).toContain('US');
  });

  it('uses nickname as title when present', async () => {
    db.prepare(`UPDATE devices SET nickname='TV in living room' WHERE id = ?`).run(id);
    const res = await request(makeApp(db)).get(`/fragments/device/${id}`);
    const $ = cheerio.load(res.text);
    expect($('h2').text()).toContain('TV in living room');
  });
});
```

- [ ] **Step 7: Run → fail**

```bash
npm test -- tests/fragment-device-detail.test.js
```

- [ ] **Step 8: Add to `src/routes/fragments.js`**

Imports at top:

```js
import { renderUptimeSparklineSvg } from '../charts/uptime-sparkline.js';
import { renderDeviceTrafficSvg } from '../charts/device-traffic-chart.js';
```

Route inside `buildFragmentsRouter`:

```js
  router.get('/fragments/device/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).send('bad id');
    const dev = db.prepare(`
      SELECT d.*, i.pfsense_name AS interface_name, i.friendly_name AS interface_friendly
      FROM devices d
      LEFT JOIN interfaces i ON i.id = d.interface_id
      WHERE d.id = ?
    `).get(id);
    if (!dev) return res.status(404).send('not found');

    const now = Math.floor(Date.now() / 1000);
    const tags = db.prepare('SELECT tag FROM device_tags WHERE device_id = ? ORDER BY tag').all(id).map(r => r.tag);
    const todayBytes = db.prepare(`
      SELECT COALESCE(SUM(rx_bytes), 0) AS rx, COALESCE(SUM(tx_bytes), 0) AS tx
      FROM traffic_hourly WHERE device_id = ? AND hour_bucket >= ?
    `).get(id, now - 24 * 3600);
    const weekBytes = db.prepare(`
      SELECT COALESCE(SUM(rx_bytes), 0) AS rx, COALESCE(SUM(tx_bytes), 0) AS tx
      FROM traffic_hourly WHERE device_id = ? AND hour_bucket >= ?
    `).get(id, now - 7 * 86400);
    const monthBytes = db.prepare(`
      SELECT COALESCE(SUM(rx_bytes), 0) AS rx, COALESCE(SUM(tx_bytes), 0) AS tx
      FROM traffic_daily WHERE device_id = ? AND day_bucket >= ?
    `).get(id, now - 30 * 86400);
    const allTimeBytes = db.prepare(`
      SELECT COALESCE(SUM(rx_bytes), 0) AS rx, COALESCE(SUM(tx_bytes), 0) AS tx
      FROM traffic_daily WHERE device_id = ?
    `).get(id);
    const lastSample = db.prepare(`
      SELECT rx_bytes, tx_bytes, states_count
      FROM traffic_samples
      WHERE device_id = ?
      ORDER BY ts DESC LIMIT 1
    `).get(id) ?? { rx_bytes: 0, tx_bytes: 0, states_count: 0 };
    const trafficSamples = db.prepare(`
      SELECT hour_bucket AS ts, rx_bytes, tx_bytes
      FROM traffic_hourly WHERE device_id = ? AND hour_bucket >= ?
      ORDER BY hour_bucket
    `).all(id, now - 24 * 3600);
    const uptimeEvents = db.prepare(`
      SELECT ts, status FROM uptime_events
      WHERE device_id = ? AND ts >= ?
      ORDER BY ts
    `).all(id, now - 24 * 3600);
    const countries = db.prepare(`
      SELECT country_code, hit_count FROM geo_connections
      WHERE device_id = ? ORDER BY hit_count DESC LIMIT 5
    `).all(id);

    const trafficSvg = renderDeviceTrafficSvg({ samples: trafficSamples });
    const uptimeSvg = renderUptimeSparklineSvg({
      events: uptimeEvents,
      windowStart: now - 24 * 3600,
      windowEnd: now,
      isOnlineNow: dev.is_online === 1,
    });

    res.render('fragments/device-detail', {
      dev, tags, todayBytes, weekBytes, monthBytes, allTimeBytes,
      lastSample, countries, trafficSvg, uptimeSvg, now,
      formatBytes, formatRelative,
    });
  });
```

- [ ] **Step 9: Create `src/views/fragments/device-detail.ejs`**

```ejs
<h2><%= dev.nickname || dev.hostname || dev.mac %></h2>
<div class="subtitle">
  <span class="status-dot <%= dev.is_online ? '' : 'offline' %>"></span>
  <%= dev.is_online ? 'online' : 'offline' %> &middot;
  last seen <%= formatRelative(dev.last_seen_at, now) %>
  <% if (dev.interface_friendly || dev.interface_name) { %>
    &middot; <a href="#" hx-get="/fragments/device-list?vlan=<%= dev.interface_name %>" hx-target="[data-fragment='device-list']" hx-swap="innerHTML"><%= dev.interface_friendly || dev.interface_name %></a>
  <% } %>
</div>

<dl>
  <dt>Nickname</dt>
  <dd>
    <form hx-patch="/devices/<%= dev.id %>/nickname" hx-target="closest dd" hx-swap="outerHTML">
      <input type="text" name="nickname" class="inline-edit" value="<%= dev.nickname || '' %>" placeholder="(unset)">
      <button class="action" type="submit">Save</button>
    </form>
  </dd>
  <dt>IP / MAC</dt><dd><%= dev.current_ip || '-' %> &middot; <%= dev.mac %></dd>
  <% if (dev.current_ipv6) { %><dt>IPv6</dt><dd><%= dev.current_ipv6 %></dd><% } %>
  <dt>Vendor / Type</dt><dd><%= dev.vendor || '-' %> &middot; <%= dev.device_type_guess || 'Unknown' %></dd>
  <% if (dev.current_lease_type) { %>
    <dt>DHCP lease</dt><dd><%= dev.current_lease_type %><% if (dev.current_lease_expires_at) { %> &middot; expires <%= formatRelative(dev.current_lease_expires_at, now) %><% } %></dd>
  <% } %>
  <dt>First seen</dt><dd><%= formatRelative(dev.first_seen_at, now) %> ago</dd>
  <dt>Bandwidth now</dt><dd>Down: <%= formatBytes(lastSample.rx_bytes) %>/s &middot; Up: <%= formatBytes(lastSample.tx_bytes) %>/s &middot; <%= lastSample.states_count %> states</dd>
  <dt>Today</dt><dd><strong>Down: <%= formatBytes(todayBytes.rx) %> &middot; Up: <%= formatBytes(todayBytes.tx) %></strong></dd>
  <dt>This week</dt><dd>Down: <%= formatBytes(weekBytes.rx) %> &middot; Up: <%= formatBytes(weekBytes.tx) %></dd>
  <dt>This month</dt><dd>Down: <%= formatBytes(monthBytes.rx) %> &middot; Up: <%= formatBytes(monthBytes.tx) %></dd>
  <dt>All-time</dt><dd>Down: <%= formatBytes(allTimeBytes.rx) %> &middot; Up: <%= formatBytes(allTimeBytes.tx) %></dd>
  <dt>Tags</dt>
  <dd>
    <span class="tag-list">
      <% tags.forEach(function(t) { %>
        <span class="tag-chip"><%= t %>
          <button hx-delete="/devices/<%= dev.id %>/tags/<%= encodeURIComponent(t) %>" hx-target="closest .tag-chip" hx-swap="outerHTML">x</button>
        </span>
      <% }); %>
    </span>
    <form hx-post="/devices/<%= dev.id %>/tags" hx-target="previous .tag-list" hx-swap="innerHTML">
      <input class="inline-edit" type="text" name="tag" placeholder="+tag" style="width: 80px;">
    </form>
  </dd>
  <dt>Notes</dt>
  <dd>
    <form hx-patch="/devices/<%= dev.id %>/notes" hx-target="closest dd" hx-swap="outerHTML">
      <textarea class="inline-edit" name="notes" placeholder="(none)"><%= dev.notes || '' %></textarea>
      <button class="action" type="submit">Save</button>
    </form>
  </dd>
</dl>

<div class="chart-block">
  <div class="label">Bandwidth &mdash; last 24h</div>
  <%- trafficSvg %>
</div>
<div class="chart-block">
  <div class="label">Uptime &mdash; last 24h</div>
  <%- uptimeSvg %>
</div>

<% if (countries.length > 0) { %>
  <div class="chart-block">
    <div class="label">Countries (top 5)</div>
    <div style="font-size: 12px;">
      <% countries.forEach(function(c, i) { %><%= c.country_code %> (<%= c.hit_count %>)<% if (i < countries.length - 1) { %> &middot; <% } %><% }); %>
    </div>
  </div>
<% } %>
```

- [ ] **Step 10: Tests pass**

```bash
npm test
```

- [ ] **Step 11: Commit**

```bash
git add src/charts/ src/routes/fragments.js src/views/fragments/device-detail.ejs tests/uptime-sparkline.test.js tests/device-traffic-chart.test.js tests/fragment-device-detail.test.js
git commit -m "feat: device detail fragment with traffic + uptime SVG charts"
```

---

## Phase C — Write fragments (inline edits)

### Task C1: PATCH nickname

**Files:**
- Create: `src/routes/actions.js`
- Modify: `src/index.js` (mount actions router)
- Create: `tests/actions-nickname.test.js`

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect, beforeEach } from 'vitest';
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
    const res = await request(makeApp(db)).patch(`/devices/${id}/nickname`).type('form').send({ nickname: 'living-room-tv' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('living-room-tv');
    const row = db.prepare('SELECT nickname FROM devices WHERE id = ?').get(id);
    expect(row.nickname).toBe('living-room-tv');
  });

  it('clears the nickname when blank', async () => {
    const { db, id } = setup();
    db.prepare('UPDATE devices SET nickname = ? WHERE id = ?').run('old', id);
    const res = await request(makeApp(db)).patch(`/devices/${id}/nickname`).type('form').send({ nickname: '' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT nickname FROM devices WHERE id = ?').get(id);
    expect(row.nickname).toBeNull();
  });

  it('returns 404 for missing device', async () => {
    const { db } = setup();
    const res = await request(makeApp(db)).patch(`/devices/99999/nickname`).type('form').send({ nickname: 'x' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm test -- tests/actions-nickname.test.js
```

- [ ] **Step 3: Create `src/routes/actions.js`**

```js
import express from 'express';

export function buildActionsRouter({ db }) {
  const router = express.Router();

  router.patch('/devices/:id/nickname', (req, res) => {
    const id = Number(req.params.id);
    const nickname = (req.body?.nickname ?? '').trim();
    const value = nickname.length === 0 ? null : nickname;
    const exists = db.prepare('SELECT 1 FROM devices WHERE id = ?').get(id);
    if (!exists) return res.status(404).send('not found');
    db.prepare('UPDATE devices SET nickname = ? WHERE id = ?').run(value, id);
    res.send(`<dd>
      <form hx-patch="/devices/${id}/nickname" hx-target="closest dd" hx-swap="outerHTML">
        <input type="text" name="nickname" class="inline-edit" value="${escapeHtml(value ?? '')}" placeholder="(unset)">
        <button class="action" type="submit">Save</button>
      </form>
    </dd>`);
  });

  return router;
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
```

- [ ] **Step 4: Mount in `src/index.js`**

```js
import { buildActionsRouter } from './routes/actions.js';
app.use(buildActionsRouter({ db }));
```

- [ ] **Step 5: Tests pass**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/actions.js src/index.js tests/actions-nickname.test.js
git commit -m "feat: PATCH /devices/:id/nickname inline edit"
```

---

### Task C2: PATCH notes

**Files:**
- Modify: `src/routes/actions.js`
- Create: `tests/actions-notes.test.js`

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect, beforeEach } from 'vitest';
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
    const res = await request(makeApp(db)).patch(`/devices/${id}/notes`).type('form').send({ notes: 'Living room' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Living room');
    expect(db.prepare('SELECT notes FROM devices WHERE id=?').get(id).notes).toBe('Living room');
  });

  it('clears notes when blank', async () => {
    const { db, id } = setup();
    db.prepare('UPDATE devices SET notes = ? WHERE id = ?').run('old', id);
    const res = await request(makeApp(db)).patch(`/devices/${id}/notes`).type('form').send({ notes: '' });
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT notes FROM devices WHERE id=?').get(id).notes).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm test -- tests/actions-notes.test.js
```

- [ ] **Step 3: Append to `src/routes/actions.js` (inside `buildActionsRouter`, before `return router`)**

```js
  router.patch('/devices/:id/notes', (req, res) => {
    const id = Number(req.params.id);
    const notes = (req.body?.notes ?? '').trim();
    const value = notes.length === 0 ? null : notes;
    const exists = db.prepare('SELECT 1 FROM devices WHERE id = ?').get(id);
    if (!exists) return res.status(404).send('not found');
    db.prepare('UPDATE devices SET notes = ? WHERE id = ?').run(value, id);
    res.send(`<dd>
      <form hx-patch="/devices/${id}/notes" hx-target="closest dd" hx-swap="outerHTML">
        <textarea class="inline-edit" name="notes" placeholder="(none)">${escapeHtml(value ?? '')}</textarea>
        <button class="action" type="submit">Save</button>
      </form>
    </dd>`);
  });
```

- [ ] **Step 4: Tests pass**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/actions.js tests/actions-notes.test.js
git commit -m "feat: PATCH /devices/:id/notes inline edit"
```

---

### Task C3: POST + DELETE tags

**Files:**
- Modify: `src/routes/actions.js`
- Create: `tests/actions-tags.test.js`

- [ ] **Step 1: Failing test**

```js
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
```

- [ ] **Step 2: Run → fail**

```bash
npm test -- tests/actions-tags.test.js
```

- [ ] **Step 3: Append to `src/routes/actions.js`**

```js
  router.post('/devices/:id/tags', (req, res) => {
    const id = Number(req.params.id);
    const tag = (req.body?.tag ?? '').trim().toLowerCase();
    if (tag.length === 0) return res.status(400).send('empty tag');
    const exists = db.prepare('SELECT 1 FROM devices WHERE id = ?').get(id);
    if (!exists) return res.status(404).send('not found');
    db.prepare('INSERT OR IGNORE INTO device_tags VALUES (?, ?)').run(id, tag);
    const tags = db.prepare('SELECT tag FROM device_tags WHERE device_id = ? ORDER BY tag').all(id).map(r => r.tag);
    const html = tags.map(t => `<span class="tag-chip">${escapeHtml(t)}<button hx-delete="/devices/${id}/tags/${encodeURIComponent(t)}" hx-target="closest .tag-chip" hx-swap="outerHTML">x</button></span>`).join(' ');
    res.send(html);
  });

  router.delete('/devices/:id/tags/:tag', (req, res) => {
    const id = Number(req.params.id);
    const tag = decodeURIComponent(req.params.tag).toLowerCase();
    db.prepare('DELETE FROM device_tags WHERE device_id = ? AND tag = ?').run(id, tag);
    res.send('');
  });
```

- [ ] **Step 4: Tests pass**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/actions.js tests/actions-tags.test.js
git commit -m "feat: POST/DELETE /devices/:id/tags for tag management"
```

---

### Task C4: POST dismiss-new

**Files:**
- Modify: `src/routes/actions.js`
- Create: `tests/actions-dismiss.test.js`

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { buildActionsRouter } from '../src/routes/actions.js';

function makeApp(db) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(buildActionsRouter({ db }));
  return app;
}

describe('POST /devices/:id/dismiss-new', () => {
  it('clears new_until_seen_at and returns empty body', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO devices (mac, is_online, first_seen_at, last_seen_at, new_until_seen_at) VALUES ('a',1,?,?,?)`).run(now, now, now);
    const id = db.prepare("SELECT id FROM devices WHERE mac='a'").get().id;
    const res = await request(makeApp(db)).post(`/devices/${id}/dismiss-new`);
    expect(res.status).toBe(200);
    expect(res.text.trim()).toBe('');
    expect(db.prepare('SELECT new_until_seen_at FROM devices WHERE id=?').get(id).new_until_seen_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm test -- tests/actions-dismiss.test.js
```

- [ ] **Step 3: Append to `src/routes/actions.js`**

```js
  router.post('/devices/:id/dismiss-new', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE devices SET new_until_seen_at = NULL WHERE id = ?').run(id);
    res.send('');
  });
```

- [ ] **Step 4: Tests pass**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/actions.js tests/actions-dismiss.test.js
git commit -m "feat: POST /devices/:id/dismiss-new clears NEW badge"
```

---

## Phase D — VLAN dropdown population + final integration

### Task D1: Populate VLAN dropdown dynamically

**Files:**
- Modify: `src/views/layout.ejs`
- Modify: `src/routes/page.js`
- Create: `tests/page-vlans.test.js`

The VLAN select in the shell was hardcoded to just `<option value="">VLAN: All</option>`. We need it populated from the `interfaces` table at render time.

- [ ] **Step 1: Failing test `tests/page-vlans.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { buildPageRouter } from '../src/routes/page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, '..', 'src', 'views'));
  app.use(buildPageRouter({ db }));
  return app;
}

describe('GET / VLAN options', () => {
  it('renders <option> elements for each non-WAN interface', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES
      ('wan','WAN','wan'),
      ('lan','LAN','lan'),
      ('vlan20','IoT','vlan'),
      ('vlan30','Guest','vlan')`).run();
    const res = await request(makeApp(db)).get('/');
    const $ = cheerio.load(res.text);
    const opts = $('select[name="vlan"] option').toArray().map(o => $(o).text());
    expect(opts).toContain('VLAN: All');
    expect(opts).toContain('LAN');
    expect(opts).toContain('IoT');
    expect(opts).toContain('Guest');
    expect(opts).not.toContain('WAN');
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm test -- tests/page-vlans.test.js
```

- [ ] **Step 3: Modify `src/routes/page.js`**

```js
import express from 'express';

export function buildPageRouter({ db } = {}) {
  const router = express.Router();
  router.get('/', (req, res) => {
    const vlans = db
      ? db.prepare(`SELECT pfsense_name, friendly_name FROM interfaces WHERE kind != 'wan' ORDER BY pfsense_name`).all()
      : [];
    res.render('layout', { vlans });
  });
  return router;
}
```

- [ ] **Step 4: Update `src/views/layout.ejs`**

Replace the existing `<select name="vlan">` block with:

```ejs
    <select name="vlan">
      <option value="">VLAN: All</option>
      <% (typeof vlans !== 'undefined' ? vlans : []).forEach(function(v) { %>
        <option value="<%= v.pfsense_name %>"><%= v.friendly_name || v.pfsense_name %></option>
      <% }); %>
    </select>
```

- [ ] **Step 5: Update mount in `src/index.js`**

The page-router mount now needs `{ db }`:

```js
app.use(buildPageRouter({ db }));
```

- [ ] **Step 6: Tests pass**

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/routes/page.js src/views/layout.ejs src/index.js tests/page-vlans.test.js
git commit -m "feat: populate VLAN dropdown from interfaces table"
```

---

### Task D2: Full Docker smoke + browser sanity

**Files:**
- (none new unless fixes are needed)

This is a verification task.

- [ ] **Step 1: Build and run**

```bash
docker build -t pfmon:dev . 2>&1 | tail -5
docker run --rm -d --name pfmon-smoke -p 8080:8080 \
  -e PFSENSE_URL=http://127.0.0.1:1 \
  -e PFSENSE_API_KEY=test \
  pfmon:dev
sleep 5
```

- [ ] **Step 2: Probe the page shell**

```bash
curl -s http://localhost:8080/ | head -30
curl -sf http://localhost:8080/api/health
curl -s http://localhost:8080/fragments/header-meta
curl -s http://localhost:8080/fragments/device-list
curl -s http://localhost:8080/fragments/wan-summary
curl -s http://localhost:8080/fragments/alerts
```

Each should return either HTML or a "No data yet" placeholder (since pfSense is unreachable).

- [ ] **Step 3: Open in a browser**

`http://localhost:8080/` — sanity check that:
- Page renders without errors
- Theme toggle flips between light + dark
- HTMX polling kicks in (network tab shows requests every 30s)
- A red "Last poll failed" banner appears because pfSense is unreachable

If you can point at a real pfSense, do that too and verify the device list populates.

- [ ] **Step 4: Cleanup**

```bash
docker stop pfmon-smoke
```

- [ ] **Step 5: Run full test suite once more**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit any fixes you needed to make. If none, no commit.**

---

## Self-review

Spec coverage (mapped to spec section 6 — Frontend):
- Page shell rendered once → Task A5
- Header strip + freshness → Task B1
- Alerts banner (yellow/red) → Task B3
- WAN totals + 24h chart + range toggles → Task B4
- Master list with search/filter/sort, VLAN column + filter, NEW badge → Tasks B2 + D1
- Detail panel (all fields, inline edits, totals, charts, geo) → Task B5
- HTMX endpoints (GET fragments, PATCH/POST/DELETE actions) → Phases B + C
- Server-rendered inline SVG charts → Tasks B4, B5
- Light/dark theming with anti-FOUC + localStorage → Tasks A2, A4, A5
- No emojis (text labels + CSS dots + SVG icons only) → throughout

Type/name consistency: `dev` object shape (`id, mac, vendor, hostname, nickname, notes, device_type_guess, current_ip, current_ipv6, interface_id, is_online, first_seen_at, last_seen_at, new_until_seen_at, alerted_at`) is consistent between Plan 1's DB schema and this plan's routes. Fragment route paths match HTMX attributes in `layout.ejs`. The shared formatter helpers (`formatBytes`, `formatRelative`) and chart renderers are imported where used.

No placeholders. No TODOs. Every step has the actual code.

---

## Execution handoff

Plan 2 complete and saved to `docs/superpowers/plans/2026-05-17-pfmon-02-web-dashboard.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review per task. Same workflow as Plan 1.
2. **Inline Execution** — execute tasks in this session with batch checkpoints.

Which approach?
