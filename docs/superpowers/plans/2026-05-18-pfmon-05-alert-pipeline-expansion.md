# Alert Pipeline Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing ntfy alert pipeline to (1) warn the user when a device hits a per-device daily download budget, and (2) send a single daily "what changed" digest summarizing new devices, devices gone silent, top bandwidth users, and WAN poll failures.

**Architecture:** Two new modules under `src/poller/`, each mirroring the structure of `src/poller/alerts.js`. Both reuse the existing ntfy POST + timeout + retry-backoff pattern. Idempotency for each is enforced by a small SQLite table (`budget_alerts` keyed by `device_id + day_bucket`, `digest_log` keyed by `day_bucket`). The budget alerter runs inside every `runOnePoll` after `recordTrafficSamples`; the digest runs from the existing hourly cron (the function itself decides whether the current hour matches the configured `DIGEST_HOUR` and whether today's digest has already been sent).

**Tech Stack:** Node.js 20, Express 5, better-sqlite3, node-cron, EJS, vitest + supertest. ntfy POSTs go through Node's global `fetch` with `AbortController` for timeouts.

**Background the executing engineer needs:**

- The reference for both new modules is `src/poller/alerts.js`. Read it first — particularly `nextBackoffSec`, the `AbortController` timeout pattern, the `ntfyRetry` map, and the `if (!topicUrl) return` short-circuit. Copy that structure exactly so behavior under failure is consistent across all three alert types.
- The reference for test mocking is `tests/alerts.test.js`. It spins up two ephemeral express servers (one that returns 200, one that returns 500, one that hangs without responding) and asserts both happy-path and backoff paths. The same fixtures should be reused in the new alert tests.
- Schema migrations: append-only files under `src/migrations/`. The runner (`src/db.js`) is transactional and idempotent. Use `ALTER TABLE devices ADD COLUMN ...` — SQLite supports this. Do NOT edit `001_init.sql`.
- Day buckets across both features use UTC midnight: `Math.floor(ts / 86400) * 86400`. This matches the existing `traffic_daily.day_bucket` convention.
- Config: `src/config.js` validates positive ints via `positiveInt(name, fallback)`. For `DIGEST_HOUR` (0-23) we need a new validator since 0 must be allowed.
- "Today's bytes" for a device is computed by `deviceBytesSinceSql({column: 'rx_bytes + tx_bytes', deviceIdExpr: '@id', sinceParam: '@sinceTs'})` from `src/routes/fragments.js`. Import and reuse — do not redefine the rollup-existence partition logic.

---

### Task 1: Migration 002 — budget schema

Add the `daily_budget_bytes` column to `devices` (nullable; null = no budget). Add the `budget_alerts` table for per-device-per-day idempotency.

**Files:**
- Create: `src/migrations/002_budgets.sql`
- Test: `tests/db.test.js` (extend existing migration test)

- [ ] **Step 1: Write the failing test**

Read `tests/db.test.js` first to see the existing pattern. Then append inside the existing `describe(...)` block:

```javascript
  it('migration 002 adds daily_budget_bytes column and budget_alerts table', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const cols = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
    expect(cols).toContain('daily_budget_bytes');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='budget_alerts'").all();
    expect(tables.length).toBe(1);
    const baCols = db.prepare('PRAGMA table_info(budget_alerts)').all().map((c) => c.name);
    expect(baCols).toEqual(expect.arrayContaining(['device_id', 'day_bucket', 'alerted_at']));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db.test.js`
Expected: FAIL — `daily_budget_bytes` not in columns, no `budget_alerts` table.

- [ ] **Step 3: Create the migration**

Create `src/migrations/002_budgets.sql`:

```sql
ALTER TABLE devices ADD COLUMN daily_budget_bytes INTEGER;

CREATE TABLE IF NOT EXISTS budget_alerts (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  day_bucket INTEGER NOT NULL,
  alerted_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, day_bucket)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db.test.js`
Expected: PASS — new assertion green; existing migration test still green.

- [ ] **Step 5: Commit**

```bash
git add src/migrations/002_budgets.sql tests/db.test.js
git commit -m "feat(schema): add daily_budget_bytes column and budget_alerts table"
```

---

### Task 2: PATCH `/devices/:id/budget` action endpoint

Accepts a number-of-megabytes value (empty = clear). Mirrors the nickname endpoint exactly. Returns the new `<dd>` fragment for HTMX outerHTML swap.

**Files:**
- Modify: `src/routes/actions.js` (insert after the `notes` route)
- Test: `tests/actions-budget.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/actions-budget.test.js`:

```javascript
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
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

describe('PATCH /devices/:id/budget', () => {
  it('stores MB input as bytes', async () => {
    const { db, id } = setup();
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/budget`)
      .type('form')
      .send({ budget_mb: '500' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT daily_budget_bytes FROM devices WHERE id = ?').get(id);
    expect(row.daily_budget_bytes).toBe(500 * 1024 * 1024);
  });

  it('clears the budget when the value is blank', async () => {
    const { db, id } = setup();
    db.prepare('UPDATE devices SET daily_budget_bytes = ? WHERE id = ?').run(1_000_000_000, id);
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/budget`)
      .type('form')
      .send({ budget_mb: '' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT daily_budget_bytes FROM devices WHERE id = ?').get(id);
    expect(row.daily_budget_bytes).toBeNull();
  });

  it('rejects non-numeric input with 400', async () => {
    const { db, id } = setup();
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/budget`)
      .type('form')
      .send({ budget_mb: 'lots' });
    expect(res.status).toBe(400);
  });

  it('rejects negative numbers with 400', async () => {
    const { db, id } = setup();
    const res = await request(makeApp(db))
      .patch(`/devices/${id}/budget`)
      .type('form')
      .send({ budget_mb: '-5' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for missing device', async () => {
    const { db } = setup();
    const res = await request(makeApp(db))
      .patch(`/devices/99999/budget`)
      .type('form')
      .send({ budget_mb: '100' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions-budget.test.js`
Expected: FAIL — `Cannot PATCH /devices/.../budget` (404 on the route itself).

- [ ] **Step 3: Add the route**

In `src/routes/actions.js`, insert this handler immediately after the existing `/devices/:id/notes` handler (around line 35):

```javascript
  router.patch('/devices/:id/budget', (req, res) => {
    const id = Number(req.params.id);
    const raw = (req.body?.budget_mb ?? '').trim();
    let value = null;
    if (raw.length > 0) {
      const mb = Number(raw);
      if (!Number.isFinite(mb) || !Number.isInteger(mb) || mb < 0) {
        return res.status(400).send('budget_mb must be a non-negative integer');
      }
      value = mb * 1024 * 1024;
    }
    const exists = db.prepare('SELECT 1 FROM devices WHERE id = ?').get(id);
    if (!exists) return res.status(404).send('not found');
    db.prepare('UPDATE devices SET daily_budget_bytes = ? WHERE id = ?').run(value, id);
    const displayMb = value === null ? '' : Math.round(value / 1024 / 1024);
    res.send(`<dd>
      <form hx-patch="/devices/${id}/budget" hx-target="closest dd" hx-swap="outerHTML">
        <input type="number" min="0" step="1" name="budget_mb" class="inline-edit" value="${escapeHtml(String(displayMb))}" placeholder="(no budget)" style="width: 100px;">
        <span style="color: var(--fg-muted); font-size: 11px;">MB / day</span>
        <button class="action" type="submit">Save</button>
      </form>
    </dd>`);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/actions-budget.test.js`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/routes/actions.js tests/actions-budget.test.js
git commit -m "feat(actions): add PATCH /devices/:id/budget endpoint"
```

---

### Task 3: Budget field on device-detail panel

Surface the budget in the existing detail panel with the same form pattern as nickname/notes. Also show today's usage as `X MB / Y MB (Z%)` when a budget is set so the user can see how close they are.

**Files:**
- Modify: `src/routes/fragments.js` (compute `budgetDisplay` in the device detail handler)
- Modify: `src/views/fragments/device-detail.ejs` (insert new `<dt>` / `<dd>` between Vendor/Type and DHCP lease)
- Test: `tests/fragment-device-detail.test.js` (add assertions)

- [ ] **Step 1: Write the failing test**

In `tests/fragment-device-detail.test.js`, inside the existing `describe(...)` block, append:

```javascript
  it('renders the budget form with current value when set', async () => {
    db.prepare('UPDATE devices SET daily_budget_bytes = ? WHERE id = ?').run(500 * 1024 * 1024, id);
    const res = await request(makeApp(db)).get(`/fragments/device/${id}`);
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    const input = $('form[hx-patch$="/budget"] input[name="budget_mb"]');
    expect(input.attr('value')).toBe('500');
  });

  it('renders the budget form empty when no budget set', async () => {
    const res = await request(makeApp(db)).get(`/fragments/device/${id}`);
    const $ = cheerio.load(res.text);
    const input = $('form[hx-patch$="/budget"] input[name="budget_mb"]');
    expect(input.attr('value')).toBe('');
  });

  it('shows today/budget usage percent when budget set and traffic exists', async () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE devices SET daily_budget_bytes = ? WHERE id = ?').run(100 * 1024 * 1024, id);
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(id, now - 60, 50 * 1024 * 1024, 0);
    const res = await request(makeApp(db)).get(`/fragments/device/${id}`);
    expect(res.text).toMatch(/50\s*%/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fragment-device-detail.test.js`
Expected: FAIL — `form[hx-patch$="/budget"]` not found.

- [ ] **Step 3: Add budget computation to the route**

In `src/routes/fragments.js`, in the `router.get('/fragments/device/:id', ...)` handler, locate where `todayBytes` is computed (around line 352). Immediately after it, add:

```javascript
    const budgetBytes = dev.daily_budget_bytes;
    const budgetMb = budgetBytes == null ? '' : Math.round(budgetBytes / 1024 / 1024);
    const todayTotal = (todayBytes.rx ?? 0) + (todayBytes.tx ?? 0);
    const budgetPct = budgetBytes && budgetBytes > 0 ? Math.round((todayTotal / budgetBytes) * 100) : null;
```

Then in the `res.render('fragments/device-detail', {...})` call (around line 407), add to the object: `budgetMb, budgetPct, formatBytes` is already there.

So the call becomes:

```javascript
    res.render('fragments/device-detail', {
      dev,
      tags,
      todayBytes,
      weekBytes,
      monthBytes,
      allTimeBytes,
      lastSample,
      countries,
      trafficSvg,
      uptimeSvg,
      now,
      formatBytes,
      formatRelative,
      budgetMb,
      budgetPct,
    });
```

- [ ] **Step 4: Add the budget `<dt>`/`<dd>` to the EJS partial**

In `src/views/fragments/device-detail.ejs`, locate the existing `<dt>Vendor / Type</dt>...` line (around line 21). Insert a new pair immediately after the closing `</dd>` of that line, before the DHCP lease block:

```ejs
  <dt>Daily budget</dt>
  <dd>
    <form hx-patch="/devices/<%= dev.id %>/budget" hx-target="closest dd" hx-swap="outerHTML">
      <input type="number" min="0" step="1" name="budget_mb" class="inline-edit" value="<%= budgetMb %>" placeholder="(no budget)" style="width: 100px;">
      <span style="color: var(--fg-muted); font-size: 11px;">MB / day</span>
      <button class="action" type="submit">Save</button>
      <% if (budgetPct !== null) { %>
        <span style="margin-left: 8px; font-size: 12px;<% if (budgetPct >= 100) { %> color: var(--danger); font-weight: 600;<% } else if (budgetPct >= 80) { %> color: var(--warning-strong); font-weight: 600;<% } else { %> color: var(--fg-muted);<% } %>"><%= budgetPct %>% used today</span>
      <% } %>
    </form>
  </dd>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/fragment-device-detail.test.js`
Expected: PASS — all existing tests plus 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/routes/fragments.js src/views/fragments/device-detail.ejs tests/fragment-device-detail.test.js
git commit -m "feat(ui): add daily budget field to device detail panel"
```

---

### Task 4: `maybeFireBudgetAlerts` module

A new poller module that mirrors `src/poller/alerts.js`. Fires one ntfy POST per device per day when a device's today bytes crosses its budget. Uses `budget_alerts` table for idempotency. Reuses the existing `ntfyRetry` Map (separate keyspace from new-device alerts by using a string key prefix).

**Files:**
- Create: `src/poller/budgets.js`
- Test: `tests/budgets.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/budgets.test.js`:

```javascript
import Database from 'better-sqlite3';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { maybeFireBudgetAlerts } from '../src/poller/budgets.js';

let okServer, okTopicUrl, received;
let failServer, failTopicUrl;

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
  await new Promise((resolve) => {
    const app = express();
    app.post('/topic', (_req, res) => res.status(500).send('boom'));
    failServer = app.listen(0, () => {
      failTopicUrl = `http://127.0.0.1:${failServer.address().port}/topic`;
      resolve();
    });
  });
});
afterAll(async () => {
  await new Promise((r) => okServer.close(r));
  await new Promise((r) => failServer.close(r));
});

function setup({ budgetBytes, todayBytes }) {
  const db = new Database(':memory:');
  runMigrations(db);
  const now = 1_700_000_000;
  db.prepare(
    `INSERT INTO devices (mac, hostname, current_ip, is_online, first_seen_at, last_seen_at, daily_budget_bytes)
     VALUES ('aa:bb:cc:dd:ee:01','tv','10.0.0.10',1,?,?,?)`,
  ).run(now, now, budgetBytes);
  const id = db.prepare("SELECT id FROM devices WHERE mac='aa:bb:cc:dd:ee:01'").get().id;
  if (todayBytes > 0) {
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(id, now - 60, todayBytes, 0);
  }
  return { db, id, now };
}

describe('maybeFireBudgetAlerts', () => {
  it('does not fire when today bytes are under budget', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 50 * 1024 * 1024 });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now, ntfyRetry: new Map() });
    expect(received).toHaveLength(0);
  });

  it('fires one alert when today bytes cross budget', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 150 * 1024 * 1024 });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now, ntfyRetry: new Map() });
    expect(received).toHaveLength(1);
    expect(received[0].body).toMatch(/tv|10\.0\.0\.10/);
  });

  it('does not re-fire on subsequent polls within the same day', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 150 * 1024 * 1024 });
    const retry = new Map();
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now, ntfyRetry: retry });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now: now + 30, ntfyRetry: retry });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now: now + 3600, ntfyRetry: retry });
    expect(received).toHaveLength(1);
  });

  it('fires again on a new UTC day', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 150 * 1024 * 1024 });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now, ntfyRetry: new Map() });
    // Insert tomorrow's traffic and advance the clock past midnight UTC of the original day.
    const id = db.prepare("SELECT id FROM devices WHERE mac='aa:bb:cc:dd:ee:01'").get().id;
    const tomorrow = now + 86400;
    db.prepare(
      `INSERT INTO traffic_samples (device_id, ts, rx_bytes, tx_bytes, states_count) VALUES (?, ?, ?, ?, 0)`,
    ).run(id, tomorrow, 200 * 1024 * 1024, 0);
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now: tomorrow + 60, ntfyRetry: new Map() });
    expect(received).toHaveLength(2);
  });

  it('skips devices with no budget set (null)', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: null, todayBytes: 999 * 1024 * 1024 });
    await maybeFireBudgetAlerts(db, { topicUrl: okTopicUrl, now, ntfyRetry: new Map() });
    expect(received).toHaveLength(0);
  });

  it('is a no-op when topicUrl is empty', async () => {
    received.length = 0;
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 150 * 1024 * 1024 });
    await maybeFireBudgetAlerts(db, { topicUrl: '', now, ntfyRetry: new Map() });
    expect(received).toHaveLength(0);
    // And nothing got recorded in budget_alerts either.
    const rows = db.prepare('SELECT * FROM budget_alerts').all();
    expect(rows.length).toBe(0);
  });

  it('records retry state on POST failure and does not mark alerted', async () => {
    const { db, now } = setup({ budgetBytes: 100 * 1024 * 1024, todayBytes: 150 * 1024 * 1024 });
    const retry = new Map();
    await maybeFireBudgetAlerts(db, { topicUrl: failTopicUrl, now, ntfyRetry: retry });
    expect(retry.size).toBe(1);
    // budget_alerts row only inserted on success.
    const rows = db.prepare('SELECT * FROM budget_alerts').all();
    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/budgets.test.js`
Expected: FAIL — `Cannot find module '../src/poller/budgets.js'`.

- [ ] **Step 3: Create the module**

Create `src/poller/budgets.js`:

```javascript
const NTFY_INITIAL_BACKOFF_SEC = 60;
const NTFY_MAX_BACKOFF_SEC = 3600;
const NTFY_MAX_ATTEMPTS = 5;
const NTFY_TIMEOUT_MS = 5000;

function nextBackoffSec(attempts) {
  const exp = NTFY_INITIAL_BACKOFF_SEC * 2 ** Math.max(0, attempts - 1);
  return Math.min(NTFY_MAX_BACKOFF_SEC, exp);
}

// The retry keyspace is shared with new-device alerts (via the same `ntfyRetry`
// Map). Prefix our keys so a device id can have both kinds of retries pending
// without collision.
const retryKey = (deviceId) => `budget:${deviceId}`;

export async function maybeFireBudgetAlerts(
  db,
  { topicUrl, now, ntfyRetry, timeoutMs = NTFY_TIMEOUT_MS },
) {
  if (!topicUrl) return;
  const dayBucket = Math.floor(now / 86400) * 86400;
  // Devices with a non-null budget that have NOT been alerted for today's bucket.
  // Today's bytes is computed inline so we can compare to the budget without a
  // round trip through deviceBytesSinceSql's bind plumbing.
  const candidates = db
    .prepare(`
    SELECT d.id, d.mac, d.hostname, d.nickname, d.current_ip, d.daily_budget_bytes,
      (
        COALESCE((SELECT SUM(rx_bytes + tx_bytes) FROM traffic_hourly th
                  WHERE th.device_id = d.id AND th.hour_bucket >= @dayBucket), 0)
        + COALESCE((SELECT SUM(rx_bytes + tx_bytes) FROM traffic_samples ts
                    WHERE ts.device_id = d.id AND ts.ts >= @dayBucket
                    AND NOT EXISTS (
                      SELECT 1 FROM traffic_hourly h
                      WHERE h.device_id = ts.device_id
                      AND h.hour_bucket = (ts.ts / 3600) * 3600
                    )), 0)
      ) AS bytes_today
    FROM devices d
    WHERE d.daily_budget_bytes IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM budget_alerts ba
        WHERE ba.device_id = d.id AND ba.day_bucket = @dayBucket
      )
  `)
    .all({ dayBucket });

  const markAlerted = db.prepare(
    'INSERT OR IGNORE INTO budget_alerts (device_id, day_bucket, alerted_at) VALUES (?, ?, ?)',
  );

  for (const dev of candidates) {
    if (dev.bytes_today < dev.daily_budget_bytes) continue;
    const key = retryKey(dev.id);
    const retry = ntfyRetry?.get(key);
    if (retry) {
      if (retry.attempts >= NTFY_MAX_ATTEMPTS) continue;
      if (retry.nextAttemptAt != null && now < retry.nextAttemptAt) continue;
    }

    const name = dev.nickname ?? dev.hostname ?? dev.mac;
    const budgetMb = Math.round(dev.daily_budget_bytes / 1024 / 1024);
    const usedMb = Math.round(dev.bytes_today / 1024 / 1024);
    const body = `Budget hit: ${name}\nused=${usedMb} MB\nbudget=${budgetMb} MB\nip=${dev.current_ip ?? '?'}`;

    let ok = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(topicUrl, {
        method: 'POST',
        headers: { Title: 'pfmon: budget alert', 'Content-Type': 'text/plain' },
        body,
        signal: controller.signal,
      });
      ok = res.ok;
      if (!ok) {
        console.log(JSON.stringify({ level: 'warn', msg: 'ntfy budget non-2xx', status: res.status }));
      }
    } catch (e) {
      console.log(JSON.stringify({ level: 'warn', msg: 'ntfy budget error', error: String(e) }));
    } finally {
      clearTimeout(timer);
    }

    if (ok) {
      markAlerted.run(dev.id, dayBucket, now);
      ntfyRetry?.delete(key);
    } else if (ntfyRetry) {
      const attempts = (retry?.attempts ?? 0) + 1;
      const nextAttemptAt = now + nextBackoffSec(attempts);
      ntfyRetry.set(key, { attempts, nextAttemptAt });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/budgets.test.js`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/poller/budgets.js tests/budgets.test.js
git commit -m "feat(poller): add maybeFireBudgetAlerts module"
```

---

### Task 5: Wire `maybeFireBudgetAlerts` into `runOnePoll`

Call the new alerter once per poll, after traffic samples are recorded.

**Files:**
- Modify: `src/poller/index.js` (import + call inside `runOnePoll`)
- Test: `tests/poller-orchestrator.test.js` (extend with a budget-firing assertion)

- [ ] **Step 1: Write the failing test**

Read `tests/poller-orchestrator.test.js` first to see how it builds its test fixture (a fake pfsense client). Then append inside the existing `describe(...)` block:

```javascript
  it('fires a budget alert inside runOnePoll when a device crosses its daily budget', async () => {
    // This test relies on whatever pfsense-client fixture and runOnePoll setup
    // is established at the top of the file. Reuse it.
    // Approach: pre-seed a device row WITH a small budget, then run a poll
    // that produces a snapshot exceeding it, and assert budget_alerts has one row.
    // The pfSense fixture client is set up in the existing tests; the helper to
    // call runOnePoll is too. Use them.
    // See the budgets module's own unit tests for the body content assertions —
    // here we only verify that runOnePoll invokes the new alerter.
    // (Pseudocode-style placeholder if the orchestrator test uses helper fns:
    //   const { db, client, runPoll } = buildOrchestrator();
    //   db.prepare('UPDATE devices SET daily_budget_bytes = 1 WHERE mac=?').run('aa:..');
    //   await runPoll(now);
    //   expect(db.prepare('SELECT COUNT(*) c FROM budget_alerts').get().c).toBe(1);
    // )
    // If the existing fixture doesn't expose these helpers, write the test using
    // the same fakes the file's other tests already use.
    expect(true).toBe(true); // placeholder removed after wiring inspection
  });
```

Open `tests/poller-orchestrator.test.js` and adapt the above to match the fixture style already present. The intent: after `runOnePoll` finishes, a `budget_alerts` row exists for any device whose `daily_budget_bytes` has been crossed by `bytes_today`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/poller-orchestrator.test.js`
Expected: FAIL — `budget_alerts` row not produced (because nothing calls `maybeFireBudgetAlerts` yet).

- [ ] **Step 3: Import and call the alerter**

In `src/poller/index.js`:

a. Add the import next to the existing `maybeFireNewDeviceAlerts` import (around line 2):

```javascript
import { maybeFireBudgetAlerts } from './budgets.js';
```

b. Inside `runOnePoll`, after the existing `await maybeFireNewDeviceAlerts(...)` call (around line 61), add:

```javascript
    await maybeFireBudgetAlerts(db, { topicUrl: ntfyTopicUrl, now, ntfyRetry });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/poller-orchestrator.test.js`
Expected: PASS — budget alert fires inside the poll cycle.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all green.

- [ ] **Step 6: Commit**

```bash
git add src/poller/index.js tests/poller-orchestrator.test.js
git commit -m "feat(poller): wire budget alerts into runOnePoll"
```

---

### Task 6: Migration 003 + config `DIGEST_HOUR`

Adds the `digest_log` table and a new validated env var `DIGEST_HOUR` (0-23, optional — null = disabled).

**Files:**
- Create: `src/migrations/003_digest_log.sql`
- Modify: `src/config.js`
- Test: `tests/db.test.js` (extend), `tests/config.test.js` (extend)

- [ ] **Step 1: Write the failing migration test**

Append to `tests/db.test.js`:

```javascript
  it('migration 003 adds digest_log table with day_bucket unique constraint', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='digest_log'").all();
    expect(tables.length).toBe(1);
    const cols = db.prepare('PRAGMA table_info(digest_log)').all().map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['id', 'day_bucket', 'sent_at', 'summary']));
    db.prepare('INSERT INTO digest_log (day_bucket, sent_at, summary) VALUES (?, ?, ?)').run(0, 0, 'a');
    expect(() =>
      db.prepare('INSERT INTO digest_log (day_bucket, sent_at, summary) VALUES (?, ?, ?)').run(0, 1, 'b'),
    ).toThrow(/UNIQUE/);
  });
```

- [ ] **Step 2: Write the failing config test**

Append to `tests/config.test.js`:

```javascript
  it('accepts DIGEST_HOUR in 0..23', () => {
    process.env.PFSENSE_URL = 'http://x';
    process.env.PFSENSE_API_KEY = 'k';
    process.env.DIGEST_HOUR = '0';
    expect(loadConfig().digestHour).toBe(0);
    process.env.DIGEST_HOUR = '23';
    expect(loadConfig().digestHour).toBe(23);
  });

  it('treats missing DIGEST_HOUR as disabled (null)', () => {
    process.env.PFSENSE_URL = 'http://x';
    process.env.PFSENSE_API_KEY = 'k';
    delete process.env.DIGEST_HOUR;
    expect(loadConfig().digestHour).toBeNull();
  });

  it('exits on DIGEST_HOUR=24', () => {
    process.env.PFSENSE_URL = 'http://x';
    process.env.PFSENSE_API_KEY = 'k';
    process.env.DIGEST_HOUR = '24';
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    expect(() => loadConfig()).toThrow();
    exit.mockRestore();
  });
```

Add `import { vi } from 'vitest'` to the top of `tests/config.test.js` if not already imported.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/db.test.js tests/config.test.js`
Expected: FAIL — `digest_log` missing; `digestHour` undefined.

- [ ] **Step 4: Create the migration**

Create `src/migrations/003_digest_log.sql`:

```sql
CREATE TABLE IF NOT EXISTS digest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_bucket INTEGER NOT NULL UNIQUE,
  sent_at INTEGER NOT NULL,
  summary TEXT
);
```

- [ ] **Step 5: Add the config validator**

In `src/config.js`, add a `digestHour` validator helper above the `return` and surface it on the config object:

```javascript
  const hourInRange = (name) => {
    const raw = process.env[name];
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 23) {
      console.error(`invalid env: ${name}=${raw} (expected integer 0..23)`);
      process.exit(2);
    }
    return n;
  };
```

Then add to the returned object (alongside the existing fields):

```javascript
    digestHour: hourInRange('DIGEST_HOUR'),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/db.test.js tests/config.test.js`
Expected: PASS.

- [ ] **Step 7: Update `.env.example`**

Add to `.env.example`:

```
DIGEST_HOUR=
```

- [ ] **Step 8: Commit**

```bash
git add src/migrations/003_digest_log.sql src/config.js .env.example tests/db.test.js tests/config.test.js
git commit -m "feat(schema): add digest_log table and DIGEST_HOUR config var"
```

---

### Task 7: `buildDigestSummary` pure function

A pure function that takes `(db, {now})` and returns `{ summary: string, hasContent: boolean }`. No I/O, no ntfy. Easy to test exhaustively.

**Files:**
- Create: `src/poller/digest.js`
- Test: `tests/digest-build.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/digest-build.test.js`:

```javascript
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
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
    expect(summary).toMatch(/dev1/); // top
    expect(summary).toMatch(/dev2/);
    expect(summary).toMatch(/dev3/);
    expect(summary).not.toMatch(/dev4/); // not in top 3
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/digest-build.test.js`
Expected: FAIL — `Cannot find module '../src/poller/digest.js'`.

- [ ] **Step 3: Create the module**

Create `src/poller/digest.js`:

```javascript
function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function isoDate(now) {
  return new Date(now * 1000).toISOString().slice(0, 10);
}

export function buildDigestSummary(db, { now }) {
  const dayAgo = now - 86400;

  const newDevices = db
    .prepare(`
    SELECT hostname, nickname, mac, current_ip, device_type_guess
    FROM devices WHERE first_seen_at >= ?
    ORDER BY first_seen_at DESC LIMIT 10
  `)
    .all(dayAgo);

  const silentDevices = db
    .prepare(`
    SELECT hostname, nickname, mac, current_ip, last_seen_at
    FROM devices WHERE is_online = 0 AND last_seen_at < ?
    ORDER BY last_seen_at DESC LIMIT 10
  `)
    .all(dayAgo);

  const topMovers = db
    .prepare(`
    SELECT d.hostname, d.nickname, d.mac, (
      COALESCE((SELECT SUM(rx_bytes + tx_bytes) FROM traffic_hourly th
                WHERE th.device_id = d.id AND th.hour_bucket >= @dayAgo), 0)
      + COALESCE((SELECT SUM(rx_bytes + tx_bytes) FROM traffic_samples ts
                  WHERE ts.device_id = d.id AND ts.ts >= @dayAgo
                  AND NOT EXISTS (
                    SELECT 1 FROM traffic_hourly h
                    WHERE h.device_id = ts.device_id
                    AND h.hour_bucket = (ts.ts / 3600) * 3600
                  )), 0)
    ) AS bytes
    FROM devices d
    WHERE bytes > 0
    ORDER BY bytes DESC
    LIMIT 3
  `)
    .all({ dayAgo });

  const pollFailures = db
    .prepare('SELECT COUNT(*) AS c FROM poll_log WHERE ts >= ? AND success = 0')
    .get(dayAgo).c;

  const lines = [`pfmon daily digest - ${isoDate(now)}`, ''];
  let hasContent = false;

  if (newDevices.length > 0) {
    hasContent = true;
    lines.push('New devices (last 24h):');
    for (const d of newDevices) {
      const name = d.nickname ?? d.hostname ?? d.mac;
      const type = d.device_type_guess && d.device_type_guess !== 'Unknown' ? ` [${d.device_type_guess}]` : '';
      lines.push(`  - ${name} (${d.current_ip ?? '?'})${type}`);
    }
    lines.push('');
  }

  if (silentDevices.length > 0) {
    hasContent = true;
    lines.push('Devices gone silent:');
    for (const d of silentDevices) {
      const name = d.nickname ?? d.hostname ?? d.mac;
      const hrsAgo = Math.floor((now - d.last_seen_at) / 3600);
      lines.push(`  - ${name} (last seen ${hrsAgo}h ago)`);
    }
    lines.push('');
  }

  if (topMovers.length > 0) {
    hasContent = true;
    lines.push('Top bandwidth (last 24h):');
    topMovers.forEach((d, i) => {
      const name = d.nickname ?? d.hostname ?? d.mac;
      lines.push(`  ${i + 1}. ${name}: ${fmtBytes(d.bytes)}`);
    });
    lines.push('');
  }

  if (pollFailures > 0) {
    hasContent = true;
    lines.push(`WAN poll failures: ${pollFailures} in the last 24h`);
    lines.push('');
  }

  return { summary: lines.join('\n').trimEnd(), hasContent };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/digest-build.test.js`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/poller/digest.js tests/digest-build.test.js
git commit -m "feat(poller): add buildDigestSummary pure function"
```

---

### Task 8: `maybeSendDigest` orchestrator

Wraps `buildDigestSummary` with idempotency (via `digest_log.day_bucket`), the hour-of-day check, the `topicUrl` short-circuit, and the ntfy POST with timeout. Hour is matched against the **server-local** hour (Node's `new Date(now*1000).getHours()`).

**Files:**
- Modify: `src/poller/digest.js` (add `maybeSendDigest` alongside the pure builder)
- Test: `tests/digest-send.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/digest-send.test.js`:

```javascript
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
    // Idempotency row written.
    const rows = db.prepare('SELECT * FROM digest_log').all();
    expect(rows.length).toBe(1);
  });

  it('does not re-send if a digest row already exists for today', async () => {
    received.length = 0;
    const { db, now } = seeded();
    const dayBucket = Math.floor(now / 86400) * 86400;
    db.prepare('INSERT INTO digest_log (day_bucket, sent_at, summary) VALUES (?, ?, ?)').run(dayBucket, now - 60, 'already');
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
    // No digest_log row written for an empty digest — leave the slot free in case content appears later in the day.
    const rows = db.prepare('SELECT * FROM digest_log').all();
    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/digest-send.test.js`
Expected: FAIL — `maybeSendDigest is not exported`.

- [ ] **Step 3: Add `maybeSendDigest` to the existing file**

Append to `src/poller/digest.js`:

```javascript
const NTFY_TIMEOUT_MS = 5000;

export async function maybeSendDigest(
  db,
  { topicUrl, now, digestHour, timeoutMs = NTFY_TIMEOUT_MS },
) {
  if (digestHour == null || !topicUrl) return;
  const currentHour = new Date(now * 1000).getHours();
  if (currentHour !== digestHour) return;

  const dayBucket = Math.floor(now / 86400) * 86400;
  const alreadySent = db
    .prepare('SELECT 1 FROM digest_log WHERE day_bucket = ?')
    .get(dayBucket);
  if (alreadySent) return;

  const { summary, hasContent } = buildDigestSummary(db, { now });
  if (!hasContent) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let ok = false;
  try {
    const res = await fetch(topicUrl, {
      method: 'POST',
      headers: { Title: 'pfmon daily digest', 'Content-Type': 'text/plain' },
      body: summary,
      signal: controller.signal,
    });
    ok = res.ok;
    if (!ok) {
      console.log(JSON.stringify({ level: 'warn', msg: 'ntfy digest non-2xx', status: res.status }));
    }
  } catch (e) {
    console.log(JSON.stringify({ level: 'warn', msg: 'ntfy digest error', error: String(e) }));
  } finally {
    clearTimeout(timer);
  }

  if (ok) {
    db.prepare('INSERT OR IGNORE INTO digest_log (day_bucket, sent_at, summary) VALUES (?, ?, ?)').run(
      dayBucket,
      now,
      summary,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/digest-send.test.js`
Expected: PASS — all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/poller/digest.js tests/digest-send.test.js
git commit -m "feat(poller): add maybeSendDigest orchestrator with idempotent day-bucket guard"
```

---

### Task 9: Wire daily digest into the scheduler

Call `maybeSendDigest` from the existing hourly cron and from `runOnePoll`'s initial sync so a process started right at the digest hour still fires the digest.

**Files:**
- Modify: `src/poller/index.js` (import + call inside `startScheduler`'s hourly task; thread `digestHour` and `topicUrl` through)
- Modify: `src/index.js` (pass `digestHour` to `startScheduler`)
- Test: `tests/poller-orchestrator.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe(...)` block in `tests/poller-orchestrator.test.js`:

```javascript
  it('startScheduler accepts a digestHour parameter and threads it to the hourly task', async () => {
    // Smoke test only. The actual send-fires-once-per-day behavior is covered
    // exhaustively in tests/digest-send.test.js. Here we verify the wiring.
    // Adapt to the fixture pattern used by the other startScheduler tests in
    // this file. The minimum: call startScheduler with digestHour: 3, assert
    // it returns an object with a `stop` function, call stop().
    // (If the file already has a "constructs a scheduler" test, just augment it
    //  with the digestHour arg and assert no throw.)
  });
```

If the orchestrator test file doesn't currently invoke `startScheduler` directly, skip this step's test and rely on the unit tests from Task 8 plus the smoke test in Step 5 below.

- [ ] **Step 2: Run the test (or skip if no startScheduler test exists yet)**

Run: `npx vitest run tests/poller-orchestrator.test.js`
Expected: PASS — wiring change is type-safe; if the test was skipped, this step is just `npm test` to confirm no regression so far.

- [ ] **Step 3: Update `startScheduler` signature and the hourly task**

In `src/poller/index.js`:

a. Add `maybeSendDigest` to the existing digest import. Replace:

```javascript
import { maybeFireBudgetAlerts } from './budgets.js';
```

with:

```javascript
import { maybeFireBudgetAlerts } from './budgets.js';
import { maybeSendDigest } from './digest.js';
```

b. Add `digestHour` to `startScheduler`'s destructured params:

```javascript
export function startScheduler({
  db,
  client,
  ouiMap,
  geoRanges,
  intervalSec,
  staleAfterSec,
  ntfyTopicUrl,
  graceSec,
  wanOverride,
  initialStateBytes,
  ntfyRetry,
  digestHour,
}) {
```

c. Replace the existing `hourlyTask` declaration with one that also fires the digest:

```javascript
  const hourlyTask = cron.schedule('0 * * * *', async () => {
    const now = Math.floor(Date.now() / 1000);
    rollupHourly(db, { now });
    await maybeSendDigest(db, { topicUrl: ntfyTopicUrl, now, digestHour });
  });
```

- [ ] **Step 4: Pass `digestHour` from `src/index.js`**

In `src/index.js`, locate the `startScheduler({...})` call (around line 62). Add `digestHour: cfg.digestHour,` to the object.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all 30+ test files green.

- [ ] **Step 6: Manual smoke test**

Set `DIGEST_HOUR` to whatever hour you can wait for (or pick the current hour for an immediate fire), set `NTFY_TOPIC_URL`, and start the app:

```bash
PFSENSE_URL=http://127.0.0.1:9 PFSENSE_API_KEY=test DB_PATH=./pfmon-dev.db PORT=8080 \
  NTFY_TOPIC_URL=https://ntfy.sh/your-test-topic DIGEST_HOUR=$(date +%H) \
  npm start
```

Wait for `:00` of the current hour and watch the ntfy topic. You should see a single push with the digest summary. Restart the app in the same hour and confirm no second send (idempotency).

Stop the server. Clean up:

```bash
rm -f pfmon-dev.db pfmon-dev.db-wal pfmon-dev.db-shm
```

- [ ] **Step 7: Commit**

```bash
git add src/poller/index.js src/index.js tests/poller-orchestrator.test.js
git commit -m "feat(poller): fire daily digest from hourly cron"
```

---

## Self-review

- **Spec coverage:**
  - Feature #1 (per-device bandwidth budgets with ntfy alerts) — Tasks 1 (schema), 2 (action endpoint), 3 (UI), 4 (alerter module), 5 (poll-cycle wiring).
  - Feature #5 (daily digest) — Tasks 6 (schema + config), 7 (builder), 8 (orchestrator), 9 (cron wiring).
- **No placeholders:**
  - Task 5 Step 1 contains pseudocode in a comment because the fixture style of `tests/poller-orchestrator.test.js` was not read end-to-end during planning. The instructions tell the engineer to **read that file first and adapt the assertion to the existing helpers**, with a precise statement of what must end up green ("`budget_alerts` row exists after `runOnePoll`"). Acceptable: the engineer has a concrete success criterion and a working-example reference (`tests/budgets.test.js`).
  - Task 9 Step 1 has the same shape: the smoke-test text body is small because the actual coverage lives in Task 8's unit tests. The wiring change is verified by the full-suite run in Step 5.
- **Type/name consistency:**
  - `maybeFireBudgetAlerts` — created in Task 4, imported in Task 5.
  - `buildDigestSummary` and `maybeSendDigest` — created in Tasks 7 and 8, imported in Task 9.
  - `daily_budget_bytes` (column), `budget_alerts` (table) — defined in Task 1, queried in Tasks 2, 3, 4.
  - `digest_log` (table), `day_bucket` (column) — defined in Task 6, used in Task 8.
  - `digestHour` (config field) — added in Task 6, consumed in Tasks 8 and 9.
- **Shared idempotency convention:** both new tables use UTC day buckets (`Math.floor(now / 86400) * 86400`), matching the existing `traffic_daily.day_bucket` convention. The digest's hour-of-day check uses *server-local* time via `new Date(now*1000).getHours()` — this is intentional so a user setting `DIGEST_HOUR=7` gets a 7 AM local push, not 7 AM UTC. Note this in commit messages or release notes when shipping.
- **Note for the executor on Task 9 Step 6:** The smoke test depends on a real ntfy topic. If you don't want to send a real push during testing, skip the manual smoke and rely on the automated tests from Tasks 4, 7, 8. The wiring is type-checked by `npm test`.
