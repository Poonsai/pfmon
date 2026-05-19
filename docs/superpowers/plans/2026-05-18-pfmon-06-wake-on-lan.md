# Wake-on-LAN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user wake any device on the network from the dashboard by clicking a "Wake" button on the device-detail panel. pfmon sends the magic packet itself (UDP broadcast) using Node's stdlib `dgram` module — no pfSense or pfRest dependency, no shell-out, no child processes.

**Architecture:** A small standalone module `src/wol.js` builds and sends WoL magic packets via Node's `dgram`. A new `POST /devices/:id/wake` action endpoint looks up the device's MAC, sends one packet, and returns a short HTML status snippet that HTMX swaps into a placeholder. The broadcast address and port are configurable env vars so the user can target a per-VLAN broadcast (e.g. `10.0.0.255`) when pfmon's container isn't on the same L2 segment as the target.

**Tech Stack:** Node.js 20 (stdlib `dgram`), Express 5, EJS, vitest + supertest. No new npm deps.

**Background the executing engineer needs:**

- WoL magic packet format: 6 bytes of `0xFF`, followed by **16** repetitions of the target's 6-byte MAC. Total payload = 102 bytes. Sent as UDP, typically to broadcast address `255.255.255.255` port `9`. The receiving NIC matches the embedded MAC against its own.
- Docker networking note (for `.env.example` only): if the pfmon container uses bridge networking, `255.255.255.255` will not cross the L2 boundary. Production users on a routed multi-VLAN setup should set `WOL_BROADCAST_ADDR` to the target subnet's directed broadcast (e.g. `10.0.0.255`) and ensure pfSense allows the broadcast forward. `network_mode: host` in the compose file also works.
- The existing action endpoint pattern lives in `src/routes/actions.js`. Read it for the 404-on-missing-device pattern. WoL is a non-idempotent state change so it's a POST.
- For testing UDP, do not mock. Stand up a real local `dgram` listener on an ephemeral port (mirrors how `tests/alerts.test.js` stands up real express servers). Assert on the bytes received.
- The route needs the broadcast address + port at request time. Inject them via `buildActionsRouter({db, wolConfig})` rather than reading `process.env` inside the handler — keeps the route pure and the test trivial.

---

### Task 1: Pure `buildMagicPacket(mac)` function

Builds the 102-byte WoL payload from a MAC string. Validates format strictly: 6 colon-separated or dash-separated hex pairs, anything else throws.

**Files:**
- Create: `src/wol.js`
- Test: `tests/wol-packet.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/wol-packet.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import { buildMagicPacket } from '../src/wol.js';

describe('buildMagicPacket', () => {
  it('produces a 102-byte buffer', () => {
    const pkt = buildMagicPacket('aa:bb:cc:dd:ee:ff');
    expect(pkt.length).toBe(102);
  });

  it('starts with six 0xFF bytes', () => {
    const pkt = buildMagicPacket('aa:bb:cc:dd:ee:ff');
    for (let i = 0; i < 6; i++) expect(pkt[i]).toBe(0xff);
  });

  it('contains 16 repetitions of the MAC bytes after the header', () => {
    const pkt = buildMagicPacket('01:02:03:04:05:06');
    const macBytes = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06];
    for (let rep = 0; rep < 16; rep++) {
      for (let i = 0; i < 6; i++) {
        expect(pkt[6 + rep * 6 + i]).toBe(macBytes[i]);
      }
    }
  });

  it('accepts dash-separated MACs (Windows style)', () => {
    const pkt = buildMagicPacket('AA-BB-CC-DD-EE-FF');
    expect(pkt.length).toBe(102);
    expect(pkt[6]).toBe(0xaa);
  });

  it('accepts uppercase and mixed case', () => {
    const pkt = buildMagicPacket('Aa:Bb:Cc:dD:eE:fF');
    expect(pkt[6]).toBe(0xaa);
    expect(pkt[11]).toBe(0xff);
  });

  it('throws on an empty MAC', () => {
    expect(() => buildMagicPacket('')).toThrow(/invalid mac/i);
  });

  it('throws on a MAC with the wrong number of bytes', () => {
    expect(() => buildMagicPacket('aa:bb:cc:dd:ee')).toThrow(/invalid mac/i);
    expect(() => buildMagicPacket('aa:bb:cc:dd:ee:ff:00')).toThrow(/invalid mac/i);
  });

  it('throws on non-hex characters', () => {
    expect(() => buildMagicPacket('aa:bb:cc:dd:ee:zz')).toThrow(/invalid mac/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/wol-packet.test.js`
Expected: FAIL — `Cannot find module '../src/wol.js'`.

- [ ] **Step 3: Create the module with `buildMagicPacket`**

Create `src/wol.js`:

```javascript
const MAC_RE = /^([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})$/i;

export function buildMagicPacket(mac) {
  const m = MAC_RE.exec(String(mac ?? '').trim());
  if (!m) throw new Error(`invalid mac: ${mac}`);
  const macBytes = Buffer.from(m.slice(1).map((h) => Number.parseInt(h, 16)));
  const packet = Buffer.alloc(102);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) macBytes.copy(packet, 6 + i * 6);
  return packet;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/wol-packet.test.js`
Expected: PASS — all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/wol.js tests/wol-packet.test.js
git commit -m "feat(wol): add buildMagicPacket"
```

---

### Task 2: `sendMagicPacket` UDP sender

Wraps the dgram socket, sets `SO_BROADCAST`, sends one packet, closes the socket, and resolves. Errors during send reject the returned promise so callers can return HTTP 500.

**Files:**
- Modify: `src/wol.js` (add `sendMagicPacket`)
- Test: `tests/wol-send.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/wol-send.test.js`. The test stands up a real local UDP listener and captures the bytes pfmon sends:

```javascript
import { createSocket } from 'node:dgram';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendMagicPacket } from '../src/wol.js';

describe('sendMagicPacket', () => {
  let listener, port;

  beforeEach(async () => {
    listener = createSocket('udp4');
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.bind(0, '127.0.0.1', () => {
        port = listener.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise((r) => listener.close(r));
  });

  it('sends a 102-byte packet to the configured host and port', async () => {
    const received = new Promise((resolve) => listener.once('message', (msg) => resolve(msg)));
    await sendMagicPacket({ mac: 'aa:bb:cc:dd:ee:ff', broadcastAddr: '127.0.0.1', port });
    const msg = await received;
    expect(msg.length).toBe(102);
    expect(msg[0]).toBe(0xff);
    expect(msg[6]).toBe(0xaa);
  });

  it('rejects when buildMagicPacket throws for an invalid MAC', async () => {
    await expect(
      sendMagicPacket({ mac: 'not-a-mac', broadcastAddr: '127.0.0.1', port }),
    ).rejects.toThrow(/invalid mac/i);
  });

  it('rejects when the broadcastAddr is bad', async () => {
    await expect(
      sendMagicPacket({ mac: 'aa:bb:cc:dd:ee:ff', broadcastAddr: 'not.a.host.example.invalid', port }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/wol-send.test.js`
Expected: FAIL — `sendMagicPacket` is not exported.

- [ ] **Step 3: Append `sendMagicPacket` to `src/wol.js`**

Append to `src/wol.js`:

```javascript
import { createSocket } from 'node:dgram';

export function sendMagicPacket({ mac, broadcastAddr, port }) {
  const packet = buildMagicPacket(mac);
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    socket.once('error', (err) => {
      try {
        socket.close();
      } catch (_e) {}
      reject(err);
    });
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
      } catch (e) {
        socket.close();
        reject(e);
        return;
      }
      socket.send(packet, port, broadcastAddr, (err) => {
        socket.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/wol-send.test.js`
Expected: PASS — all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/wol.js tests/wol-send.test.js
git commit -m "feat(wol): add sendMagicPacket UDP sender"
```

---

### Task 3: Config env vars `WOL_BROADCAST_ADDR` and `WOL_PORT`

**Files:**
- Modify: `src/config.js`
- Modify: `.env.example`
- Test: `tests/config.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/config.test.js`:

```javascript
  it('defaults WoL config to 255.255.255.255:9', () => {
    process.env.PFSENSE_URL = 'http://x';
    process.env.PFSENSE_API_KEY = 'k';
    delete process.env.WOL_BROADCAST_ADDR;
    delete process.env.WOL_PORT;
    const cfg = loadConfig();
    expect(cfg.wolBroadcastAddr).toBe('255.255.255.255');
    expect(cfg.wolPort).toBe(9);
  });

  it('accepts WOL_BROADCAST_ADDR and WOL_PORT overrides', () => {
    process.env.PFSENSE_URL = 'http://x';
    process.env.PFSENSE_API_KEY = 'k';
    process.env.WOL_BROADCAST_ADDR = '10.0.0.255';
    process.env.WOL_PORT = '7';
    const cfg = loadConfig();
    expect(cfg.wolBroadcastAddr).toBe('10.0.0.255');
    expect(cfg.wolPort).toBe(7);
  });

  it('exits on a non-integer WOL_PORT', () => {
    process.env.PFSENSE_URL = 'http://x';
    process.env.PFSENSE_API_KEY = 'k';
    process.env.WOL_PORT = 'lots';
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    expect(() => loadConfig()).toThrow();
    exit.mockRestore();
  });
```

Make sure `import { vi } from 'vitest'` is present at the top of the file (added in Plan B Task 6 if you've already executed that — otherwise add it now).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.js`
Expected: FAIL — `wolBroadcastAddr` is undefined.

- [ ] **Step 3: Add the fields to `loadConfig`**

In `src/config.js`, add to the returned object:

```javascript
    wolBroadcastAddr: process.env.WOL_BROADCAST_ADDR ?? '255.255.255.255',
    wolPort: positiveInt('WOL_PORT', 9),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.js`
Expected: PASS.

- [ ] **Step 5: Update `.env.example`**

Append to `.env.example`:

```
WOL_BROADCAST_ADDR=255.255.255.255
WOL_PORT=9
```

- [ ] **Step 6: Commit**

```bash
git add src/config.js .env.example tests/config.test.js
git commit -m "feat(config): add WOL_BROADCAST_ADDR and WOL_PORT env vars"
```

---

### Task 4: `POST /devices/:id/wake` action endpoint

The route looks up the device's MAC by id, calls `sendMagicPacket` with the configured broadcast addr/port, returns a short HTML status snippet on success. 404 for missing devices, 500 for send errors.

**Files:**
- Modify: `src/routes/actions.js` (extend `buildActionsRouter` to accept `wolConfig`)
- Modify: `src/index.js` (pass `wolConfig` when constructing the actions router)
- Test: `tests/actions-wake.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/actions-wake.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions-wake.test.js`
Expected: FAIL — `Cannot POST /devices/.../wake`.

- [ ] **Step 3: Extend the actions router**

In `src/routes/actions.js`:

a. Add an import at the top:

```javascript
import { sendMagicPacket } from '../wol.js';
```

b. Replace the function signature on the existing `buildActionsRouter`:

```javascript
export function buildActionsRouter({ db, wolConfig }) {
```

c. Insert this new route inside the function, right before the closing `return router;`:

```javascript
  router.post('/devices/:id/wake', async (req, res) => {
    const id = Number(req.params.id);
    const dev = db.prepare('SELECT mac FROM devices WHERE id = ?').get(id);
    if (!dev) return res.status(404).send('not found');
    try {
      await sendMagicPacket({
        mac: dev.mac,
        broadcastAddr: wolConfig.broadcastAddr,
        port: wolConfig.port,
      });
      console.log(JSON.stringify({ level: 'info', msg: 'wol sent', device_id: id, mac: dev.mac }));
      res
        .status(200)
        .send('<span style="color: var(--success); font-size: 12px;">Magic packet sent</span>');
    } catch (e) {
      console.error(
        JSON.stringify({ level: 'error', msg: 'wol failed', device_id: id, error: String(e) }),
      );
      res
        .status(500)
        .send('<span style="color: var(--danger); font-size: 12px;">Wake failed</span>');
    }
  });
```

- [ ] **Step 4: Pass `wolConfig` from `src/index.js`**

In `src/index.js`, find the `app.use(buildActionsRouter({ db }));` line (around line 85). Change to:

```javascript
app.use(buildActionsRouter({
  db,
  wolConfig: { broadcastAddr: cfg.wolBroadcastAddr, port: cfg.wolPort },
}));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/actions-wake.test.js`
Expected: PASS — all 3 tests.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all green. Existing `actions-*.test.js` files call `buildActionsRouter({ db })` without `wolConfig`. The wake route is the only consumer; the other routes never touch `wolConfig`, so the missing prop is harmless in those tests.

- [ ] **Step 7: Commit**

```bash
git add src/routes/actions.js src/index.js tests/actions-wake.test.js
git commit -m "feat(actions): add POST /devices/:id/wake endpoint"
```

---

### Task 5: "Wake" button on the device-detail panel

Show a small button in the subtitle row next to the status. Clicking it POSTs to `/devices/:id/wake` via HTMX, swaps the returned status snippet into a placeholder, and clears it after 3 seconds.

**Files:**
- Modify: `src/views/fragments/device-detail.ejs`
- Modify: `src/static/pfmon.css` (a small `.wake-status` rule)
- Test: `tests/fragment-device-detail.test.js`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('GET /fragments/device/:id', ...)` block in `tests/fragment-device-detail.test.js`:

```javascript
  it('renders a Wake button wired to the wake endpoint', async () => {
    const res = await request(makeApp(db)).get(`/fragments/device/${id}`);
    const $ = cheerio.load(res.text);
    const btn = $(`button[hx-post="/devices/${id}/wake"]`);
    expect(btn.length).toBe(1);
    expect(btn.text().toLowerCase()).toContain('wake');
    expect($('.wake-status').length).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fragment-device-detail.test.js`
Expected: FAIL — no matching button.

- [ ] **Step 3: Add the button to the EJS partial**

In `src/views/fragments/device-detail.ejs`, replace the entire subtitle block (lines 2-9 — the `<div class="subtitle">...</div>` element) with:

```ejs
<div class="subtitle">
  <span class="status-dot <%= dev.is_online ? '' : 'offline' %>"></span>
  <%= dev.is_online ? 'online' : 'offline' %> &middot;
  last seen <%= formatRelative(dev.last_seen_at, now) %>
  <% if (dev.interface_friendly || dev.interface_name) { %>
    &middot; <a href="#" hx-get="/fragments/device-list?vlan=<%= dev.interface_name %>" hx-target="[data-fragment='device-list']" hx-swap="innerHTML"><%= dev.interface_friendly || dev.interface_name %></a>
  <% } %>
  <button class="action"
          hx-post="/devices/<%= dev.id %>/wake"
          hx-target="next .wake-status"
          hx-swap="innerHTML"
          hx-on::after-request="setTimeout(() => { const el = this.nextElementSibling; if (el) el.innerHTML = ''; }, 3000)"
          style="margin-left: 8px;">Wake</button>
  <span class="wake-status" aria-live="polite"></span>
</div>
```

The `hx-on::after-request` handler clears the status banner 3s later so the panel doesn't accumulate clutter.

- [ ] **Step 4: Add `.wake-status` CSS for spacing**

Append to `src/static/pfmon.css`:

```css
.wake-status { margin-left: 8px; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/fragment-device-detail.test.js`
Expected: PASS — all existing tests plus the new one.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Manual smoke test**

Start the dev server with WoL pointed at a sink you can observe (e.g. a `tcpdump -i any 'udp port 9'` running on the host). For a local-only smoke test you can target loopback:

```bash
PFSENSE_URL=http://127.0.0.1:9 PFSENSE_API_KEY=test DB_PATH=./pfmon-dev.db PORT=8080 \
  WOL_BROADCAST_ADDR=127.0.0.1 WOL_PORT=9 \
  npm start
```

Open `http://localhost:8080/`, click any device row, click **Wake**. Expected:
- The "Magic packet sent" banner appears next to the Wake button and clears after 3s.
- The Node log shows `{"level":"info","msg":"wol sent",...}`.

Stop the server. Clean up:

```bash
rm -f pfmon-dev.db pfmon-dev.db-wal pfmon-dev.db-shm
```

- [ ] **Step 8: Commit**

```bash
git add src/views/fragments/device-detail.ejs src/static/pfmon.css tests/fragment-device-detail.test.js
git commit -m "feat(ui): add Wake button to device detail panel"
```

---

### Task 6: Document WoL deployment caveats in the README

WoL is the single feature most likely to confuse new users at deploy time because of Docker networking. A short paragraph in `README.md` saves an hour of "why doesn't this work" debugging.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Insert WoL rows in the configuration table**

In `README.md`, locate the env-var configuration table. Add two new rows at the end (before the closing of the table):

```markdown
| `WOL_BROADCAST_ADDR` | no | `255.255.255.255` | UDP broadcast address for Wake-on-LAN packets. Set to a directed broadcast (e.g. `10.0.0.255`) if your devices are on a different L2 segment than the pfmon container. |
| `WOL_PORT` | no | `9` | UDP port for Wake-on-LAN packets. |
```

- [ ] **Step 2: Add the Docker-networking note immediately after the table**

Insert this paragraph after the configuration table:

```markdown
**Wake-on-LAN note:** When the pfmon container uses Docker bridge networking, packets sent to `255.255.255.255` will not cross the L2 boundary into your LAN. Either set `WOL_BROADCAST_ADDR` to the target subnet's directed broadcast and ensure pfSense allows the forward, or run pfmon with `network_mode: host` in your `docker-compose.yml`.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: explain Wake-on-LAN broadcast and Docker networking"
```

---

## Self-review

- **Spec coverage:**
  - Feature #3 (Wake-on-LAN) — Task 1 (packet builder), 2 (UDP send), 3 (config), 4 (endpoint), 5 (UI button), 6 (deployment docs).
- **No placeholders:** every step has literal code, literal test code, exact command, expected output.
- **Type/name consistency:**
  - `buildMagicPacket(mac)` defined Task 1, consumed by `sendMagicPacket` Task 2.
  - `sendMagicPacket({mac, broadcastAddr, port})` defined Task 2, consumed by the route in Task 4.
  - `wolConfig` (object `{broadcastAddr, port}`) injected into `buildActionsRouter` Task 4 step 3, threaded from `src/index.js` Task 4 step 4.
  - Config field names: `wolBroadcastAddr`, `wolPort`. Env names: `WOL_BROADCAST_ADDR`, `WOL_PORT`.
- **Backward compatibility:** Existing `actions-*.test.js` files call `buildActionsRouter({ db })` without `wolConfig`. The wake route is the only consumer; the other routes ignore the prop. No churn in those tests.
- **Note for the executor:** ship Tasks 1-6 together. The `200 OK + HTML snippet` contract of the wake endpoint is paired with the placeholder in the EJS partial; shipping Task 4 without Task 5 would leave the endpoint contract floating without a consumer, and changing the contract later is a breaking change for anyone who hand-curled it.
