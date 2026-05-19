# Device List Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the main dashboard answer "who's eating my internet?" at a glance, and tell users what each device is without clicking through.

**Architecture:** Two threads of work share the device-list area of the UI. Thread 1 surfaces the already-computed `device_type_guess` (from `src/poller/rules.js`) as a chip in the list and expands the heuristics. Thread 2 adds a network-wide top-talkers fragment above the master/detail, mirroring the existing `wan-summary` fragment's range-button pattern and reusing `deviceBytesSinceSql` from `src/routes/fragments.js`.

**Tech Stack:** Node.js 20, Express 5, better-sqlite3, EJS, HTMX 2, vitest + supertest + cheerio.

**Background the executing engineer needs:**

- `guessDeviceType({vendor, hostname})` in `src/poller/rules.js` is already called by `buildSnapshot` (`src/poller/snapshot.js:118`), and the result flows into `reconcileDevices` (`src/poller/reconcile.js:69, 85`). The `devices.device_type_guess` column is already populated on every poll. The work below only adds **display** and **rule coverage** — no schema or poller changes needed for the type-guess piece.
- All dashboard data queries that mix raw `traffic_samples` with `traffic_hourly` / `traffic_daily` rollups go through `deviceBytesSinceSql` / `deviceBytesAllTimeSql` in `src/routes/fragments.js`. Use those helpers; do not re-derive the rollup-existence partition.
- The form/fragment URL-sync pattern documented in `CLAUDE.md` ("HTMX form state") is unchanged by this plan — the top-talkers fragment is independently auto-refreshed and does not interact with the controls form.
- HTMX 2 auto-refresh uses `hx-trigger="load, every 30s"`. Range buttons mutate the fragment in place with `hx-get="/fragments/top-talkers?range=7d"` and `hx-target="[data-fragment='top-talkers']"`.

---

### Task 1: Surface device-type chip in device-list rows

**Files:**
- Modify: `src/routes/fragments.js:256-267` (add `d.device_type_guess` to SELECT)
- Modify: `src/views/fragments/device-list.ejs:25-29` (render chip)
- Modify: `src/static/pfmon.css` (append a `.type-chip` rule near the existing `.badge` / `.tag-chip` rules)
- Test: `tests/fragment-device-list.test.js` (add assertion)

- [ ] **Step 1: Write the failing test**

Append this test inside the `describe('GET /fragments/device-list', ...)` block in `tests/fragment-device-list.test.js`:

```javascript
  it('renders the device_type_guess chip when set', async () => {
    db.prepare(`UPDATE devices SET device_type_guess='iPhone' WHERE mac='aa:bb:cc:dd:ee:02'`).run();
    const res = await request(makeApp(db)).get('/fragments/device-list');
    const $ = cheerio.load(res.text);
    const janeRow = $('table.device-list tbody tr').filter((_, el) =>
      $(el).text().includes('jane-iphone'),
    );
    expect(janeRow.find('.type-chip').text().trim()).toBe('iPhone');
  });

  it('omits the type chip when device_type_guess is null or "Unknown"', async () => {
    // The seed leaves echo-dot without a type, and guesser returns "Unknown" for
    // unknown vendors — we don't want a chip rendered for either case.
    const res = await request(makeApp(db)).get('/fragments/device-list');
    const $ = cheerio.load(res.text);
    const echoRow = $('table.device-list tbody tr').filter((_, el) =>
      $(el).text().includes('echo-dot'),
    );
    expect(echoRow.find('.type-chip').length).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fragment-device-list.test.js`
Expected: FAIL — both new tests fail because `.type-chip` is not rendered.

- [ ] **Step 3: Add `device_type_guess` to the SELECT**

In `src/routes/fragments.js`, change the device-list SELECT (around line 256-267). Replace:

```javascript
    const rows = db
      .prepare(`
      SELECT d.id, d.mac, d.vendor, d.hostname, d.nickname, d.current_ip,
             d.is_online, d.last_seen_at, d.new_until_seen_at,
             i.pfsense_name AS interface_name, i.friendly_name AS interface_friendly,
             ${bytesTodaySql} AS bytes_today
      FROM devices d
      LEFT JOIN interfaces i ON i.id = d.interface_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
    `)
      .all({ ...params, bytesTodayStart });
```

with:

```javascript
    const rows = db
      .prepare(`
      SELECT d.id, d.mac, d.vendor, d.hostname, d.nickname, d.current_ip,
             d.is_online, d.last_seen_at, d.new_until_seen_at, d.device_type_guess,
             i.pfsense_name AS interface_name, i.friendly_name AS interface_friendly,
             ${bytesTodaySql} AS bytes_today
      FROM devices d
      LEFT JOIN interfaces i ON i.id = d.interface_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
    `)
      .all({ ...params, bytesTodayStart });
```

- [ ] **Step 4: Render the chip in the EJS partial**

In `src/views/fragments/device-list.ejs`, replace lines 26-29:

```ejs
        <td>
          <span class="status-dot <%= dotCls %>"></span>
          <%= display %><% if (isNew) { %><span class="badge">NEW</span><% } %>
        </td>
```

with:

```ejs
        <td>
          <span class="status-dot <%= dotCls %>"></span>
          <%= display %><% if (isNew) { %><span class="badge">NEW</span><% } %><% if (d.device_type_guess && d.device_type_guess !== 'Unknown') { %><span class="type-chip"><%= d.device_type_guess %></span><% } %>
        </td>
```

- [ ] **Step 5: Add `.type-chip` CSS**

Append to `src/static/pfmon.css` right after the existing `.badge` rule (around line 208):

```css
.type-chip {
  display: inline-block;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 500;
  border-radius: 3px;
  background: var(--bg-row-hover);
  color: var(--fg-muted);
  margin-left: 6px;
  vertical-align: middle;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/fragment-device-list.test.js`
Expected: PASS — all device-list tests green (existing 11 + 2 new = 13).

- [ ] **Step 7: Commit**

```bash
git add src/routes/fragments.js src/views/fragments/device-list.ejs src/static/pfmon.css tests/fragment-device-list.test.js
git commit -m "feat(ui): show device-type chip in device list"
```

---

### Task 2: Expand the device-type rule taxonomy

The existing `src/poller/rules.js` covers 17 vendor/hostname patterns. Add common gaps (consoles, common router/AP vendors, Tesla, Ring/Wyze cameras, Nest, common laptop vendors).

**Files:**
- Modify: `src/poller/rules.js`
- Test: `tests/rules.test.js`

- [ ] **Step 1: Write the failing tests**

Append these tests inside the `describe('rules.guessDeviceType', ...)` block in `tests/rules.test.js`:

```javascript
  it('returns PlayStation for Sony Interactive Entertainment vendor', () => {
    expect(guessDeviceType({ vendor: 'Sony Interactive Entertainment Inc.', hostname: 'ps5-living' })).toBe('PlayStation');
  });
  it('returns Xbox for Microsoft vendor + xbox hostname', () => {
    expect(guessDeviceType({ vendor: 'Microsoft Corporation', hostname: 'xbox-series-x' })).toBe('Xbox');
  });
  it('returns Nintendo for Nintendo vendor', () => {
    expect(guessDeviceType({ vendor: 'Nintendo Co., Ltd.', hostname: 'switch' })).toBe('Nintendo');
  });
  it('returns Tesla for Tesla vendor', () => {
    expect(guessDeviceType({ vendor: 'Tesla Motors', hostname: 'model-y' })).toBe('Tesla');
  });
  it('returns Camera for Ring/Wyze/Reolink vendors', () => {
    expect(guessDeviceType({ vendor: 'Ring LLC', hostname: 'doorbell' })).toBe('Camera');
    expect(guessDeviceType({ vendor: 'Wyze Labs Inc.', hostname: 'wyzecam' })).toBe('Camera');
    expect(guessDeviceType({ vendor: 'Reolink', hostname: 'reolink-cam' })).toBe('Camera');
  });
  it('returns Nest for Nest/Google Nest vendor', () => {
    expect(guessDeviceType({ vendor: 'Nest Labs Inc.', hostname: 'thermostat' })).toBe('Nest');
  });
  it('returns Router/AP for common networking vendors', () => {
    expect(guessDeviceType({ vendor: 'TP-LINK TECHNOLOGIES CO.,LTD.', hostname: 'ap-1' })).toBe('Router or AP');
    expect(guessDeviceType({ vendor: 'NETGEAR', hostname: 'router' })).toBe('Router or AP');
    expect(guessDeviceType({ vendor: 'ASUSTek COMPUTER INC.', hostname: 'asus-rt' })).toBe('Router or AP');
  });
  it('returns Laptop/PC for common PC vendors when no other rule matched', () => {
    expect(guessDeviceType({ vendor: 'Dell Inc.', hostname: 'dell-xps' })).toBe('Laptop or PC');
    expect(guessDeviceType({ vendor: 'LENOVO', hostname: 'thinkpad' })).toBe('Laptop or PC');
    expect(guessDeviceType({ vendor: 'Intel Corporate', hostname: 'desktop' })).toBe('Laptop or PC');
  });
  it('still returns Unknown when no rule matches', () => {
    expect(guessDeviceType({ vendor: 'Acme Widgets', hostname: 'widget-42' })).toBe('Unknown');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/rules.test.js`
Expected: FAIL — most new tests fail with assertion mismatches (the existing rules return `'Unknown'` or in some cases the wrong existing label, like `'Smart TV'` for Sony).

- [ ] **Step 3: Extend the RULES array**

Replace the `RULES` array in `src/poller/rules.js` with this expanded version. Order matters — more specific vendor+hostname matches first, then vendor-only fallbacks last. Sony Interactive matches before the broader Sony TV rule so a PS5 doesn't get labeled "Smart TV".

```javascript
const RULES = [
  { match: ({ v, h }) => /apple/i.test(v) && /iphone/i.test(h), type: 'iPhone' },
  { match: ({ v, h }) => /apple/i.test(v) && /ipad/i.test(h), type: 'iPad' },
  { match: ({ v, h }) => /apple/i.test(v) && /macbook|imac|mac-?mini|mac\b/i.test(h), type: 'Mac' },
  { match: ({ v, h }) => /apple/i.test(v) && /watch/i.test(h), type: 'Apple Watch' },
  { match: ({ v, h }) => /apple/i.test(v) && /tv\b/i.test(h), type: 'Apple TV' },
  { match: ({ v }) => /sony interactive entertainment/i.test(v), type: 'PlayStation' },
  { match: ({ v, h }) => /microsoft/i.test(v) && /xbox/i.test(h), type: 'Xbox' },
  { match: ({ v }) => /nintendo/i.test(v), type: 'Nintendo' },
  { match: ({ v }) => /tesla/i.test(v), type: 'Tesla' },
  { match: ({ v }) => /(ring llc|wyze|reolink|hikvision|amcrest|arlo)/i.test(v), type: 'Camera' },
  { match: ({ v }) => /nest labs/i.test(v), type: 'Nest' },
  { match: ({ v }) => /espressif/i.test(v), type: 'IoT (ESP)' },
  { match: ({ v, h }) => /amazon/i.test(v) && /echo/i.test(h), type: 'Echo' },
  { match: ({ v, h }) => /amazon/i.test(v) && /fire/i.test(h), type: 'Fire TV' },
  { match: ({ v }) => /google/i.test(v), type: 'Google device' },
  { match: ({ v }) => /raspberry pi/i.test(v), type: 'Raspberry Pi' },
  { match: ({ v }) => /(ubiquiti|unifi)/i.test(v), type: 'UniFi' },
  { match: ({ v }) => /(tp-?link|netgear|asustek|asus\b|d-?link|linksys|aruba|meraki|mikrotik)/i.test(v), type: 'Router or AP' },
  { match: ({ v }) => /(hp|hewlett.?packard)/i.test(v), type: 'Printer or HP device' },
  { match: ({ v }) => /(samsung|lg|sony|vizio|tcl|hisense)/i.test(v), type: 'Smart TV' },
  { match: ({ v }) => /(roku|chromecast)/i.test(v), type: 'Streamer' },
  { match: ({ v }) => /(synology|qnap)/i.test(v), type: 'NAS' },
  { match: ({ v }) => /sonos/i.test(v), type: 'Sonos' },
  { match: ({ v }) => /irobot/i.test(v), type: 'Robot vacuum' },
  { match: ({ v }) => /(dell|lenovo|intel\s+corporate|acer|asus\b|microsoft)/i.test(v), type: 'Laptop or PC' },
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/rules.test.js`
Expected: PASS — all existing 6 tests still pass, plus the 9 new tests.

- [ ] **Step 5: Commit**

```bash
git add src/poller/rules.js tests/rules.test.js
git commit -m "feat(rules): expand device-type taxonomy with consoles, cameras, routers, laptops"
```

---

### Task 3: Top-talkers query helper

A pure function `getTopTalkers(db, {sinceTs, limit})` that returns the top N devices by bytes (rx+tx) in the window. Uses `deviceBytesSinceSql` so it inherits the rollup-existence partition correctly.

**Files:**
- Modify: `src/routes/fragments.js` (add `getTopTalkers` helper near the other helpers, before `buildFragmentsRouter`)
- Test: `tests/top-talkers-query.test.js` (new file)

- [ ] **Step 1: Write the failing test**

Create `tests/top-talkers-query.test.js`:

```javascript
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { getTopTalkers } from '../src/routes/fragments.js';

describe('getTopTalkers', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES ('lan','LAN','lan')`).run();
    db.prepare(`INSERT INTO devices (mac, hostname, current_ip, is_online, first_seen_at, last_seen_at) VALUES
      ('aa:00:00:00:00:01','heavy','10.0.0.1',1,?,?),
      ('aa:00:00:00:00:02','medium','10.0.0.2',1,?,?),
      ('aa:00:00:00:00:03','light','10.0.0.3',1,?,?),
      ('aa:00:00:00:00:04','silent','10.0.0.4',1,?,?)`)
      .run(now, now, now, now, now, now, now, now);
    const heavy = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:01'").get().id;
    const medium = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:02'").get().id;
    const light = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:03'").get().id;
    db.prepare(`INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`).run(heavy, now - 60, 100_000_000, 5_000_000);
    db.prepare(`INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`).run(medium, now - 60, 10_000_000, 500_000);
    db.prepare(`INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`).run(light, now - 60, 1_000, 500);
  });

  it('returns devices ordered by total bytes descending', () => {
    const now = Math.floor(Date.now() / 1000);
    const rows = getTopTalkers(db, { sinceTs: now - 3600, limit: 10 });
    expect(rows.length).toBe(3); // silent device has no samples and is excluded
    expect(rows[0].mac).toBe('aa:00:00:00:00:01');
    expect(rows[1].mac).toBe('aa:00:00:00:00:02');
    expect(rows[2].mac).toBe('aa:00:00:00:00:03');
    expect(rows[0].bytes).toBe(105_000_000);
  });

  it('respects the limit', () => {
    const now = Math.floor(Date.now() / 1000);
    const rows = getTopTalkers(db, { sinceTs: now - 3600, limit: 2 });
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.mac)).toEqual(['aa:00:00:00:00:01', 'aa:00:00:00:00:02']);
  });

  it('counts hourly rollup rows in addition to raw samples', () => {
    // Add a heavy hourly rollup for "medium" so its total exceeds "heavy".
    const medium = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:02'").get().id;
    const now = Math.floor(Date.now() / 1000);
    const hour = Math.floor((now - 3600) / 3600) * 3600;
    db.prepare(`INSERT INTO traffic_hourly (device_id, hour_bucket, rx_bytes, tx_bytes) VALUES (?, ?, ?, ?)`).run(medium, hour, 500_000_000, 50_000_000);
    const rows = getTopTalkers(db, { sinceTs: now - 7200, limit: 10 });
    expect(rows[0].mac).toBe('aa:00:00:00:00:02');
  });

  it('returns display fields (nickname-or-hostname, ip, interface name)', () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE devices SET nickname='Big Box', interface_id=(SELECT id FROM interfaces WHERE pfsense_name='lan') WHERE mac='aa:00:00:00:00:01'`).run();
    const rows = getTopTalkers(db, { sinceTs: now - 3600, limit: 1 });
    expect(rows[0].nickname).toBe('Big Box');
    expect(rows[0].current_ip).toBe('10.0.0.1');
    expect(rows[0].interface_friendly).toBe('LAN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/top-talkers-query.test.js`
Expected: FAIL — `getTopTalkers is not a function` (import error).

- [ ] **Step 3: Add `getTopTalkers` and export it**

In `src/routes/fragments.js`, insert this function immediately after the existing `sumInterfaceBytes` function (around line 156, before `interfaceHourlySeries`):

```javascript
export function getTopTalkers(db, { sinceTs, limit }) {
  const bytesExpr = deviceBytesSinceSql({
    column: 'rx_bytes + tx_bytes',
    deviceIdExpr: 'd.id',
    sinceParam: '@sinceTs',
  });
  return db
    .prepare(`
    SELECT d.id, d.mac, d.hostname, d.nickname, d.current_ip,
           d.device_type_guess, d.is_online,
           i.pfsense_name AS interface_name, i.friendly_name AS interface_friendly,
           ${bytesExpr} AS bytes
    FROM devices d
    LEFT JOIN interfaces i ON i.id = d.interface_id
    WHERE ${bytesExpr} > 0
    ORDER BY bytes DESC
    LIMIT @limit
  `)
    .all({ sinceTs, limit });
}
```

Note: the `WHERE ${bytesExpr} > 0` filter drops devices with zero bytes in the window so the list doesn't pad with silent devices. SQLite re-evaluates the expression for the WHERE — that's acceptable here because we're already capped by `LIMIT`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/top-talkers-query.test.js`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/routes/fragments.js tests/top-talkers-query.test.js
git commit -m "feat(fragments): add getTopTalkers query helper"
```

---

### Task 4: Top-talkers fragment endpoint and EJS partial

The HTTP route, the rendered partial, and the test for both.

**Files:**
- Modify: `src/routes/fragments.js` (add `GET /fragments/top-talkers` route inside `buildFragmentsRouter`)
- Create: `src/views/fragments/top-talkers.ejs`
- Test: `tests/fragment-top-talkers.test.js` (new file)

- [ ] **Step 1: Write the failing test**

Create `tests/fragment-top-talkers.test.js`:

```javascript
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
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
  db.prepare(`INSERT INTO interfaces (pfsense_name, friendly_name, kind) VALUES ('lan','LAN','lan')`).run();
  const ifLan = db.prepare("SELECT id FROM interfaces WHERE pfsense_name='lan'").get().id;
  db.prepare(`INSERT INTO devices (mac, hostname, nickname, current_ip, interface_id, is_online, first_seen_at, last_seen_at, device_type_guess) VALUES
    ('aa:00:00:00:00:01','tv-living',NULL,'10.0.0.10',?,1,?,?,'Smart TV'),
    ('aa:00:00:00:00:02','phone',NULL,'10.0.0.11',?,1,?,?,NULL),
    ('aa:00:00:00:00:03','silent',NULL,'10.0.0.12',?,1,?,?,NULL)`)
    .run(ifLan, now, now, ifLan, now, now, ifLan, now, now);
  const tv = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:01'").get().id;
  const phone = db.prepare("SELECT id FROM devices WHERE mac='aa:00:00:00:00:02'").get().id;
  db.prepare(`INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`).run(tv, now - 60, 80_000_000, 4_000_000);
  db.prepare(`INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`).run(phone, now - 60, 1_000_000, 100_000);
}

describe('GET /fragments/top-talkers', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    seed(db);
  });

  it('renders top talkers in descending bytes order', async () => {
    const res = await request(makeApp(db)).get('/fragments/top-talkers');
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    const rows = $('table.top-talkers tbody tr');
    expect(rows.length).toBe(2); // silent excluded
    expect($(rows[0]).text()).toContain('tv-living');
    expect($(rows[1]).text()).toContain('phone');
  });

  it('clicking a row swaps the detail panel via hx-get', async () => {
    const res = await request(makeApp(db)).get('/fragments/top-talkers');
    const $ = cheerio.load(res.text);
    const firstRow = $('table.top-talkers tbody tr').first();
    expect(firstRow.attr('hx-get')).toMatch(/^\/fragments\/device\/\d+$/);
    expect(firstRow.attr('hx-target')).toBe('#detail-panel');
  });

  it('accepts range=7d and range=30d, default is 24h', async () => {
    for (const r of ['24h', '7d', '30d']) {
      const res = await request(makeApp(db)).get(`/fragments/top-talkers?range=${r}`);
      expect(res.status).toBe(200);
      const $ = cheerio.load(res.text);
      // The chosen range button is marked .primary.
      expect($(`button.action.primary`).filter((_, el) => $(el).text().trim() === r).length).toBe(1);
    }
  });

  it('rejects unknown range values by falling back to 24h', async () => {
    const res = await request(makeApp(db)).get('/fragments/top-talkers?range=garbage');
    const $ = cheerio.load(res.text);
    expect($('button.action.primary').first().text().trim()).toBe('24h');
  });

  it('renders an empty-state message when no device has bytes in the window', async () => {
    const fresh = new Database(':memory:');
    runMigrations(fresh);
    const res = await request(makeApp(fresh)).get('/fragments/top-talkers');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No traffic yet');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fragment-top-talkers.test.js`
Expected: FAIL — `Cannot GET /fragments/top-talkers` (404).

- [ ] **Step 3: Add the route**

In `src/routes/fragments.js`, inside `buildFragmentsRouter`, add this route right after the existing `/fragments/wan-summary` handler (around line 332):

```javascript
  router.get('/fragments/top-talkers', (req, res) => {
    const allowed = ['24h', '7d', '30d'];
    const range = allowed.includes(req.query.range) ? req.query.range : '24h';
    const rangeSec = range === '24h' ? 24 * 3600 : range === '7d' ? 7 * 86400 : 30 * 86400;
    const now = Math.floor(Date.now() / 1000);
    const rows = getTopTalkers(db, { sinceTs: now - rangeSec, limit: 10 });
    const totalBytes = rows.reduce((sum, r) => sum + r.bytes, 0);
    res.render('fragments/top-talkers', { rows, range, totalBytes, formatBytes });
  });
```

- [ ] **Step 4: Create the partial**

Create `src/views/fragments/top-talkers.ejs`:

```ejs
<div class="top-talkers-wrap">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px;">
    <div>
      <div style="font-size:10px;color:var(--fg-muted);text-transform:uppercase;letter-spacing:0.5px;">Top talkers &mdash; last <%= range %></div>
      <div style="font-size:11px;color:var(--fg-muted);">Total across top devices: <%= formatBytes(totalBytes) %></div>
    </div>
    <div style="display:flex;gap:4px;font-size:11px;">
      <% ['24h','7d','30d'].forEach(function(r) { %>
        <button class="action <%= r === range ? 'primary' : '' %>"
                hx-get="/fragments/top-talkers?range=<%= r %>"
                hx-target="[data-fragment='top-talkers']"
                hx-swap="innerHTML"><%= r %></button>
      <% }); %>
    </div>
  </div>
  <% if (rows.length === 0) { %>
    <p class="subtitle" style="padding:8px 0;">No traffic yet in this window.</p>
  <% } else { %>
    <table class="top-talkers">
      <thead>
        <tr>
          <th>Device</th>
          <th>IP</th>
          <th>VLAN</th>
          <th style="text-align:right;">Bytes</th>
          <th style="text-align:right;">% of top</th>
        </tr>
      </thead>
      <tbody>
        <% rows.forEach(function(d) {
          const display = d.nickname || d.hostname || `(${d.mac.slice(0, 8)}...)`;
          const pct = totalBytes > 0 ? (d.bytes / totalBytes * 100).toFixed(1) : '0.0';
        %>
          <tr hx-get="/fragments/device/<%= d.id %>"
              hx-target="#detail-panel"
              hx-swap="innerHTML">
            <td>
              <span class="status-dot <%= d.is_online ? '' : 'offline' %>"></span>
              <%= display %><% if (d.device_type_guess && d.device_type_guess !== 'Unknown') { %><span class="type-chip"><%= d.device_type_guess %></span><% } %>
            </td>
            <td><%= d.current_ip || '-' %></td>
            <td><%= d.interface_friendly || d.interface_name || '-' %></td>
            <td style="text-align:right;"><%= formatBytes(d.bytes) %></td>
            <td style="text-align:right;color:var(--fg-muted);"><%= pct %>%</td>
          </tr>
        <% }); %>
      </tbody>
    </table>
  <% } %>
</div>
```

- [ ] **Step 5: Add minimal CSS for the new table**

Append to `src/static/pfmon.css`:

```css
table.top-talkers {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
table.top-talkers thead th {
  text-align: left;
  font-weight: 500;
  color: var(--fg-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
}
table.top-talkers tbody tr {
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}
table.top-talkers tbody tr:hover { background: var(--bg-row-hover); }
table.top-talkers tbody td { padding: 6px 8px; }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/fragment-top-talkers.test.js`
Expected: PASS — all 5 tests.

- [ ] **Step 7: Commit**

```bash
git add src/routes/fragments.js src/views/fragments/top-talkers.ejs src/static/pfmon.css tests/fragment-top-talkers.test.js
git commit -m "feat(fragments): add top-talkers leaderboard with range selector"
```

---

### Task 5: Wire top-talkers fragment into the page layout

Mount the new fragment between the existing WAN summary and the controls form so it shows up unconditionally on every page load. Add a `data-fragment="top-talkers"` host div with `hx-trigger="load, every 30s"` for auto-refresh.

**Files:**
- Modify: `src/views/layout.ejs:31-33` (insert host div)
- Test: `tests/page-shell.test.js` (add assertion that the host div is present)

- [ ] **Step 1: Write the failing test**

In `tests/page-shell.test.js`, inside the `describe('GET /', ...)` block, append:

```javascript
  it('mounts the top-talkers fragment host div with auto-refresh wiring', async () => {
    const res = await request(makeApp()).get('/');
    const $ = cheerio.load(res.text);
    const host = $('[data-fragment="top-talkers"]');
    expect(host.length).toBe(1);
    expect(host.attr('hx-get')).toBe('/fragments/top-talkers');
    expect(host.attr('hx-trigger')).toMatch(/every/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/page-shell.test.js`
Expected: FAIL — `data-fragment="top-talkers"` element not found.

- [ ] **Step 3: Insert the host div**

In `src/views/layout.ejs`, change:

```ejs
  <div data-fragment="wan-summary" hx-get="/fragments/wan-summary" hx-trigger="load, every 30s" hx-swap="innerHTML"></div>

  <% const q = (typeof query !== 'undefined' && query) ? query : { q:'', status:'', vlan:'', sort:'last_seen' }; %>
```

to:

```ejs
  <div data-fragment="wan-summary" hx-get="/fragments/wan-summary" hx-trigger="load, every 30s" hx-swap="innerHTML"></div>

  <div data-fragment="top-talkers" hx-get="/fragments/top-talkers" hx-trigger="load, every 30s" hx-swap="innerHTML"></div>

  <% const q = (typeof query !== 'undefined' && query) ? query : { q:'', status:'', vlan:'', sort:'last_seen' }; %>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/page-shell.test.js`
Expected: PASS — all page-shell tests including the new one.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all test files green (count should be 30 files / 124+ tests after Tasks 1-5).

- [ ] **Step 6: Commit**

```bash
git add src/views/layout.ejs tests/page-shell.test.js
git commit -m "feat(ui): mount top-talkers fragment between WAN summary and device list"
```

---

### Task 6: Manual smoke test and release-readiness check

Not all behavior is testable from supertest+cheerio (e.g. visual layout, HTMX auto-refresh interval, theme switching).

**Files:**
- No code changes; verification only.

- [ ] **Step 1: Run the dev server against the existing seed data**

Start the app with mock-friendly env vars:

```bash
PFSENSE_URL=http://127.0.0.1:9 PFSENSE_API_KEY=test DB_PATH=./pfmon-dev.db PORT=8080 npm start
```

The poll will fail (no pfSense at port 9) but the server still serves the dashboard. Open `http://localhost:8080/` in a browser.

Expected:
- Top-talkers section appears between the WAN summary box and the controls form.
- If your dev DB has device traffic, the leaderboard populates within 30s.
- Range buttons (24h / 7d / 30d) switch the chart without a full-page reload.
- Device-type chips render next to device names in the device list and the top-talkers table.

If your local DB is empty, you should see "No traffic yet in this window." instead of a table — that's the empty-state path.

- [ ] **Step 2: Run lint + format check**

Run: `npm run check`
Expected: no diagnostics. Fix any biome complaints (`npm run check:fix` rewrites trivial issues).

- [ ] **Step 3: Cleanup**

Stop the dev server (Ctrl+C). Remove the throwaway DB:

```bash
rm -f pfmon-dev.db pfmon-dev.db-wal pfmon-dev.db-shm
```

- [ ] **Step 4: Final commit (if any cleanup changes were needed from Step 2)**

Skip if no changes. Otherwise:

```bash
git add -p
git commit -m "chore: lint fixes from device-list enrichment"
```

---

## Self-review

- **Spec coverage:**
  - Feature #2 (top talkers) — Tasks 3, 4, 5 cover query helper, endpoint, partial, layout mount, range selector, empty state, click-through to detail.
  - Feature #6 (device-type) — Tasks 1 and 2 cover surfacing in the list (already populated by the poller) and expanding the rule taxonomy.
- **No placeholders:** every code step contains the exact code to write; every test step contains the actual assertions; every command has expected output.
- **Type/name consistency:** `getTopTalkers` named identically in import (Task 3 test), export (Task 3 implementation), and consumer (Task 4 route). `data-fragment="top-talkers"` consistent across Task 4 partial buttons and Task 5 layout host div. `.type-chip` class introduced in Task 1 and reused in Task 4's top-talkers partial.
- **One gotcha to note for the executor:** Task 4 step 3 places the route immediately after `/fragments/wan-summary`. If a previous plan inserted other routes there, place it anywhere within `buildFragmentsRouter` — the order does not matter for Express.
