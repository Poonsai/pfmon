# pfmon — pfSense Network Device Monitor Dashboard

**Status:** Design draft
**Date:** 2026-05-17
**Owner:** boozercab@gmail.com

## 1. Overview

A self-hosted dashboard for monitoring devices on a home network sitting behind pfSense. It polls the pfSense REST API addon (https://pfrest.org/) every 30 seconds, stores history in SQLite, and serves a single web page showing the current state of the network plus per-device and network-wide trends.

### Goals

- See every device on the network at a glance: name, IP, MAC, vendor, VLAN, online/offline status.
- Track devices over time: first-seen, last-seen, online/offline timeline.
- Track bandwidth per device and network-wide (WAN totals), with daily/weekly/monthly history.
- Get notified when a previously-unseen device appears.
- Support multiple VLANs out of the box, with no hardcoded interface names.
- Work in any modern browser, runnable on any Docker host (NAS, mini-PC, Pi).

### Non-goals

- Replacing pfSense's own dashboards or logs.
- Active probing/scanning (the data comes from pfSense's existing state).
- Multi-user accounts or role-based access. (Single shared LAN view.)
- Mobile-first design. Desktop browser is the primary surface.

### Constraints

- Single Docker container deployment.
- No external paid services required (free ntfy.sh topic; free offline IP-to-country DB).
- LAN-only trust model — no authentication.
- pfSense REST API (pfrest.org) is the only data source.

## 2. Architecture

One Docker container running Node.js. Inside the container:

- **Poller** (`node-cron`, every `POLL_INTERVAL_SECONDS`, default 30s)
  Pulls fresh state from pfSense, reconciles against SQLite, fires ntfy.sh push for new devices.
- **Express web server**
  Serves the page shell at `/` and HTMX fragment routes for the table, detail panel, alerts banner, and inline edits.
- **SQLite** at `/data/pfmon.db` (WAL mode), mounted to a host volume for persistence across upgrades.

External integrations:

- **pfSense REST API** — read-only consumer of the diagnostics + status endpoints.
- **ntfy.sh** — POST when a new device joins (optional).
- **IEEE OUI table** — baked into image at build time for MAC vendor lookup; loaded into memory at startup.
- **db-ip Lite Country DB** — baked into image at build time for offline IP-to-country lookup (CC-BY-4.0).

### Why a single container

The poller and the web server share an in-process SQLite handle. Splitting them adds cross-process file-locking complexity for no real benefit at this scale (tens to low-hundreds of devices, single-digit-MB DB).

## 3. Data scope and trends

The dashboard tracks the following bundles (essentials always included; rest enabled by design):

- **Essentials** — IP, MAC, hostname, MAC vendor (OUI), online/offline now, last-seen, user-editable nickname.
- **Identity** — first-seen date, free-text notes, custom tags, device-type guess from vendor + hostname patterns.
- **Traffic** — current bandwidth (RX/TX rates), active firewall states count, bytes today / week / month / all-time (per device and WAN-total).
- **Security** — new-device alert, recent firewall blocks, geo-IP tally of recent outbound destinations.
- **Network** — VLAN/interface, DHCP lease type, IPv6 address (NDP), lease expiration.
- **Uptime** — per-device online/offline timeline (last 24h, 7d, 30d).

## 4. Database schema

SQLite, WAL mode. Identifiers: device identity is MAC address (stable across DHCP renewals).

### Tables

**`devices`** (hub)
```
id                          INTEGER PK AUTOINCREMENT
mac                         TEXT NOT NULL UNIQUE
vendor                      TEXT
hostname                    TEXT
nickname                    TEXT          -- user-editable
notes                       TEXT          -- user-editable
device_type_guess           TEXT
current_ip                  TEXT
current_ipv6                TEXT
interface_id                INTEGER FK -> interfaces(id)
current_lease_type          TEXT          -- 'dynamic' | 'static' | 'expired'
current_lease_expires_at    INTEGER       -- unix epoch
is_online                   INTEGER NOT NULL DEFAULT 0
first_seen_at               INTEGER NOT NULL
last_seen_at                INTEGER NOT NULL
new_until_seen_at           INTEGER       -- nullable; drives NEW badge
alerted_at                  INTEGER       -- nullable; when ntfy was sent
```

**`device_tags`**
```
device_id  INTEGER FK -> devices(id) ON DELETE CASCADE
tag        TEXT NOT NULL
PRIMARY KEY (device_id, tag)
```

**`interfaces`** (per VLAN/LAN/WAN)
```
id              INTEGER PK AUTOINCREMENT
pfsense_name    TEXT NOT NULL UNIQUE   -- e.g. 'lan', 'opt1', 'vlan10'
friendly_name   TEXT                   -- user-editable display name
kind            TEXT NOT NULL          -- 'wan' | 'lan' | 'opt' | 'vlan'
vlan_tag        INTEGER                -- nullable
ipv4_subnet     TEXT                   -- CIDR
ipv6_prefix     TEXT
```

**`uptime_events`** (transitions only — append-only)
```
device_id  INTEGER FK -> devices(id) ON DELETE CASCADE
ts         INTEGER NOT NULL
status     TEXT NOT NULL CHECK (status IN ('online','offline'))
INDEX (device_id, ts)
```

**`traffic_samples`** (30s granularity, 7-day retention)
```
device_id     INTEGER FK -> devices(id) ON DELETE CASCADE
ts            INTEGER NOT NULL
rx_bytes      INTEGER       -- delta since previous sample
tx_bytes      INTEGER
states_count  INTEGER       -- count of active firewall states with src_ip = this device's current_ip
INDEX (device_id, ts)
```

**`traffic_hourly`** (90-day retention)
```
device_id        INTEGER FK -> devices(id) ON DELETE CASCADE
hour_bucket      INTEGER NOT NULL   -- unix epoch, floor to hour
rx_bytes         INTEGER
tx_bytes         INTEGER
peak_rx_rate     INTEGER            -- bytes/sec
peak_tx_rate     INTEGER
PRIMARY KEY (device_id, hour_bucket)
```

**`traffic_daily`** (indefinite retention; ~365 rows/device/year)
```
device_id        INTEGER FK -> devices(id) ON DELETE CASCADE
day_bucket       INTEGER NOT NULL   -- unix epoch, floor to day
rx_bytes         INTEGER
tx_bytes         INTEGER
peak_rx_rate     INTEGER
peak_tx_rate     INTEGER
PRIMARY KEY (device_id, day_bucket)
```

**`interface_traffic_samples`** / **`interface_traffic_hourly`** / **`interface_traffic_daily`**
Same shape and retention policies as the device-level tables, keyed by `interface_id` instead of `device_id` (samples 7d, hourly 90d, daily indefinite). The WAN interface's rows drive the headline network-wide chart.

**`firewall_blocks`** (7-day retention)
```
id          INTEGER PK AUTOINCREMENT
ts          INTEGER NOT NULL
device_id   INTEGER FK -> devices(id) ON DELETE SET NULL
src_ip      TEXT
src_port    INTEGER
dst_ip      TEXT
dst_port    INTEGER
proto       TEXT
direction   TEXT          -- 'out' | 'in'
INDEX (device_id, ts)
```

**`geo_connections`**
```
device_id      INTEGER FK -> devices(id) ON DELETE CASCADE
country_code   TEXT NOT NULL
last_seen_at   INTEGER NOT NULL
hit_count      INTEGER NOT NULL DEFAULT 1
PRIMARY KEY (device_id, country_code)
```

**`poll_log`** (7-day retention)
```
id            INTEGER PK AUTOINCREMENT
ts            INTEGER NOT NULL
success       INTEGER NOT NULL
duration_ms   INTEGER
error_msg     TEXT
```

### Retention sweep

Daily cron at 03:00 local time:
- `traffic_samples` older than 7 days deleted.
- `traffic_hourly` older than 90 days deleted.
- `firewall_blocks` older than 7 days deleted.
- `poll_log` older than 7 days deleted.
- `uptime_events` kept indefinitely (small).
- `traffic_daily` and `interface_traffic_daily` kept indefinitely.

### Rollup jobs

- **Hourly rollup**: at minute 0 of every hour, sum the prior hour's `traffic_samples` and `interface_traffic_samples` into `_hourly` rows. Compute `peak_rx_rate` and `peak_tx_rate` from the max single-sample rate observed in that hour.
- **Daily rollup**: at 00:05 local time, sum the prior day's `_hourly` rows into `_daily` rows.

## 5. Polling cycle

Runs every `POLL_INTERVAL_SECONDS` (default 30s).

1. **Fetch from pfSense in parallel:**
   - ARP table (`/api/v2/diagnostics/arp_table`)
   - DHCP leases (one call per configured DHCP server)
   - Firewall state table (filtered to current outbound states)
   - Per-interface stats (`/api/v2/status/interfaces`)
   - NDP table (IPv6)
   - Recent filter-log entries via the pfRest filter-log endpoint, filtered to `action=block`. Exact pfRest path to be confirmed during implementation; fallback is to skip this fetch if the endpoint is unavailable on the user's pfRest version (firewall blocks become an empty section rather than a failure).

2. **Build snapshot keyed by MAC:**
   For each MAC: current IP/IPv6, hostname, vendor (OUI lookup), interface (IP-in-subnet match), lease info, active states + byte counters, dst country tally from outbound state dst-IPs.

3. **Reconcile inside a single SQLite transaction:**
   - Unknown MAC → INSERT device with `first_seen_at = now`, `new_until_seen_at = now`; queue ntfy alert if `NEW_DEVICE_GRACE_MINUTES` has elapsed since first detection.
   - Known MAC → UPDATE current fields, set `last_seen_at = now`; if was offline → INSERT `uptime_events('online')` and set `is_online = 1`.
   - Known MAC not in snapshot and stale > 5 min → INSERT `uptime_events('offline')`, set `is_online = 0`.
   - Per device: INSERT `traffic_samples` (delta from prior counters), UPSERT `geo_connections`, INSERT any new `firewall_blocks` (de-duplicated by hash of {ts, src, dst, port}).
   - Per interface: INSERT `interface_traffic_samples` (delta from prior counters).

4. **After commit:** fire queued ntfy.sh POSTs. Each is a POST to `NTFY_TOPIC_URL` with the message body containing `New device: vendor=<v>, hostname=<h>, IP=<ip>, MAC=<mac>, VLAN=<v>` and a `Title` header `pfmon: new device`. Failures are logged but do not retry.

5. **Log to `poll_log`:** success/fail, duration, error_msg.

### Interface and DHCP server discovery

On startup and then refreshed every hour, the poller enumerates interfaces and DHCP servers from pfSense — no hardcoded names. Adding a new VLAN in pfSense surfaces automatically on the next refresh.

### Failure handling

- pfSense unreachable: log to `poll_log`, dashboard shows red banner "Last poll failed: <error>", existing data stays visible.
- Backoff: 30s normal → 60s after 3 consecutive failures → cap at 5 min.
- Container never crashes on a poll error.

### New-device alert grace period

To avoid alerting on a flapping ARP entry, a new MAC isn't pushed to ntfy until `NEW_DEVICE_GRACE_MINUTES` (default 5) has elapsed since first observation. If the device disappears before the grace period ends, it's still in the DB but no alert is sent.

## 6. Frontend

Server-rendered EJS templates. HTMX swaps fragments. No build step. CSS variables for theming.

### Page structure (`GET /`)

A single HTML shell loaded once. Inside it, four independently-refreshing regions:

- **Header strip** — device counts, VLAN counts, "data is Ns old" freshness indicator.
- **WAN totals strip** — today's totals (down/up), week/month subline, 24h stacked-area chart (down + up), range toggles (24h/7d/30d), "Break down by VLAN" toggle.
- **Alerts banner** — yellow strip when new devices appeared (per-alert dismiss button); red strip if poller is failing.
- **Master/detail split** — left: filterable/sortable device table; right: full detail panel for selected device.

### HTMX endpoints

```
GET    /                                       page shell (loaded once)
GET    /fragments/alerts                       banner HTML; polled every 30s
GET    /fragments/wan-summary                  WAN totals + chart; polled every 30s
GET    /fragments/device-list?q=&filter=&sort= table rows; polled every 30s
GET    /fragments/device/:id                   detail panel; polled every 30s while open
PATCH  /devices/:id/nickname                   inline nickname edit
PATCH  /devices/:id/notes                      inline notes edit
POST   /devices/:id/tags                       add tag chip
DELETE /devices/:id/tags/:tag                  remove tag chip
POST   /devices/:id/dismiss-new                clears NEW badge
GET    /api/health                             JSON; for Docker healthcheck
```

### Master list

- Columns: Name (nickname or hostname), IP, VLAN (clickable to filter), Bytes today (sortable), Last seen, plus an unlabeled status column (colored dot).
- Filters: search box (matches name, IP, MAC, vendor, tag), status select (All/Online/Offline/New), VLAN select (auto-populated), sort select.
- Selected row preserved across 30s refreshes via `hx-preserve` on `data-device-id`.

### Detail panel

For the selected device: nickname (inline editable), IP, MAC, vendor, device type, IPv6, interface/VLAN (link), DHCP lease info, first-seen, bandwidth now, totals (today / week / month / all-time), tags (chips with add/remove), notes (inline editable), 24h trend chart (inline SVG), 24h uptime sparkline (inline SVG segments), country tally (last 7d), recent firewall blocks (last 7d).

### Charts

All charts are **server-rendered inline SVG** — no JS chart library:
- **WAN chart**: stacked area, down vs up, ~50-100 data points over selected range.
- **Per-device 24h trend**: stacked area, down vs up, hourly resolution.
- **Per-device uptime sparkline**: horizontal bar split into colored segments per online/offline transition.

### Theming (light/dark)

- CSS variables for theme tokens: `--bg`, `--bg-elevated`, `--fg`, `--fg-muted`, `--border`, `--accent`, `--danger`, `--warning`, `--success`. One stylesheet, two value sets keyed by `[data-theme="light"]` and `[data-theme="dark"]`.
- Toggle in header (inline SVG sun/moon icons or `Light | Dark` text labels — no emoji).
- Preference saved to `localStorage`; first-load default respects `prefers-color-scheme`.
- Inline `<script>` at top of `<head>` reads localStorage and sets `data-theme` before first paint (no flash of wrong theme). HTMX fragment swaps inherit the theme automatically.

### Visual conventions (no emoji)

- Status indicators: colored CSS dots via `border-radius:50%` (green=online, gray=offline, red=new).
- Warnings: red `NEW` text badge with rounded background.
- Up/down bandwidth: `Down:` / `Up:` text labels or inline SVG arrows, no glyphs.

## 7. Configuration

Environment variables (set in docker-compose):

```
PFSENSE_URL                 https://pfsense.lan         required
PFSENSE_API_KEY             <pfRest API key>            required
PFSENSE_VERIFY_TLS          true                        default true
POLL_INTERVAL_SECONDS       30                          default 30
NTFY_TOPIC_URL              https://ntfy.sh/<topic>     optional
NEW_DEVICE_GRACE_MINUTES    5                           default 5
DB_PATH                     /data/pfmon.db              default
PORT                        8080                        default
LOG_LEVEL                   info                        info|debug|warn|error
WAN_INTERFACE_NAME          (auto)                      optional override
```

## 8. Deployment

### Dockerfile

Multi-stage build on `node:lts-alpine`:
- **Builder stage**: `npm ci`, download IEEE OUI CSV and db-ip Lite country DB into `/build/data`.
- **Runtime stage**: copy app + data files, drop to non-root user, expose 8080, run `node src/index.js`. `HEALTHCHECK` hits `/api/health`.
- Target image size: ~120MB.

### docker-compose.yml

```yaml
services:
  pfmon:
    image: ghcr.io/<repo-owner>/pfmon:latest
    container_name: pfmon
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    environment:
      PFSENSE_URL: https://pfsense.lan
      PFSENSE_API_KEY: ${PFSENSE_API_KEY}
      NTFY_TOPIC_URL: https://ntfy.sh/your-private-topic
      POLL_INTERVAL_SECONDS: 30
```

`<repo-owner>` is the GitHub username/org that owns the published image. Pin a specific version (e.g., `:0.3.1`) in production; `latest` is convenient for the home-lab case where you're tracking the project's `main`.

Secrets go in a sibling `.env` (gitignored).

### First-run sequence

1. Validate required env vars; exit with clear error if missing.
2. Open SQLite at `DB_PATH`, run migrations (idempotent).
3. Load OUI CSV and geo-IP DB into memory.
4. Synchronous initial poll so the first page load has data.
5. Start node-cron scheduler and Express server.

### Backups

Copy `./data/pfmon.db`. A nightly host-side cron job is enough; SQLite's `.backup` command can be used for hot backups while the container is running.

### Upgrades

`docker compose pull && docker compose up -d`. Migrations run at startup.

## 9. Versioning and release

The project follows **Strict Semantic Versioning (SemVer 2.0)**. Every code change ships under a version increment per these rules:

- **MAJOR** (X.0.0): incompatible / breaking changes — DB schema requiring manual migration, env-var removals/renames, behavior changes that break existing deployments.
- **MINOR** (0.X.0): backward-compatible new features — new data column, new endpoint, new metric, new opt-in config.
- **PATCH** (0.0.X): backward-compatible bug fixes only.

### Conventional Commits

All commit messages follow the Conventional Commits 1.0 spec. Examples:

```
feat: add Wi-Fi signal strength column            -> MINOR bump
fix: handle missing DHCP lease for static IPs     -> PATCH bump
feat!: replace POLL_INTERVAL with POLL_INTERVAL_SECONDS    -> MAJOR bump
fix!: change DB schema; requires manual re-migrate         -> MAJOR bump
chore: bump dependencies                          -> no version bump
docs: clarify env vars in README                  -> no version bump
refactor: extract OUI loader                      -> no version bump
test: add reconcile fixtures                      -> no version bump
```

The `!` after the type (or a `BREAKING CHANGE:` footer) triggers a MAJOR bump regardless of the type.

### Automation: release-please

A GitHub Actions workflow (`.github/workflows/release-please.yml`) runs on every push to `main`. It parses Conventional Commits since the last release and:

1. Opens or updates a **Release PR** titled `chore(main): release X.Y.Z` containing:
   - The version bump in `package.json`
   - An appended `CHANGELOG.md` entry generated from the commit messages
   - An updated `.release-please-manifest.json`
2. When the Release PR is merged:
   - The action creates the git tag `vX.Y.Z`
   - The action creates the GitHub Release with auto-generated notes
   - The release event triggers the Docker publish workflow

### Docker image publication

A second workflow (`.github/workflows/release-docker.yml`) listens for `release: published` events. It builds the image and pushes to **GitHub Container Registry** at `ghcr.io/<repo-owner>/pfmon`, tagged with all of:

- `X.Y.Z` (specific version)
- `X.Y` (auto-updates to latest patch within minor)
- `X` (auto-updates to latest minor within major)
- `latest` (auto-updates to latest stable release)

Pulls from `ghcr.io` are free and unlimited for public images.

### Commit message enforcement

`commitlint` + Husky pre-commit hook (`.husky/commit-msg`) rejects non-Conventional commit messages locally before they reach the repo. Enforced for everyone clone-pulling the repo.

### Pre-1.0 status

The project starts at **0.1.0**. While in `0.x`, any feature change may include breaking adjustments per SemVer's allowance for initial development. **1.0.0** is cut once the initial design is shipped, exercised in real use, and the surface is stable.

### Files added for versioning

Reflected in section 11 (File layout):

- `.github/workflows/release-please.yml`
- `.github/workflows/release-docker.yml`
- `release-please-config.json`
- `.release-please-manifest.json`
- `commitlint.config.js`
- `.husky/commit-msg`
- `CHANGELOG.md` (initially `# Changelog\n`; auto-maintained by release-please)

## 10. Testing

- **Unit tests (vitest)** on the high-value pure modules: `reconcile.js` (with fixture pfSense JSON responses), `oui.js`, `rules.js`, `geoip.js`.
- **Route tests (supertest)** against an in-memory SQLite: exercise each HTMX endpoint, verify HTML structure with cheerio.
- **Smoke test (CI)**: build the image, run it pointed at a mock pfSense fixture server, hit `/api/health` and `/`, assert non-error response.
- **No live-pfSense tests** — fixtures only.

## 11. File layout

```
pfmon/
  Dockerfile
  docker-compose.yml
  .env.example
  .gitignore
  .dockerignore
  package.json
  README.md
  CHANGELOG.md
  commitlint.config.js
  release-please-config.json
  .release-please-manifest.json
  .husky/
    commit-msg
  .github/
    workflows/
      ci.yml                    lint + unit + route + smoke tests on every PR
      release-please.yml        opens/updates Release PR on push to main
      release-docker.yml        builds + pushes ghcr.io image on release
  docs/
    superpowers/specs/          design docs
  src/
    index.js                    Express app entrypoint
    db.js                       better-sqlite3 connection, migrations
    poller/
      index.js                  node-cron tick
      pfsense.js                HTTP client for pfRest
      reconcile.js              snapshot to DB diff
      alerts.js                 ntfy.sh sender
      geoip.js                  offline country lookup
      oui.js                    MAC vendor lookup
      rules.js                  device-type guesser
      retention.js              daily prune + rollups
    routes/
      page.js
      fragments.js
      actions.js
      health.js
    views/
      layout.ejs
      fragments/
        device-list.ejs
        device-detail.ejs
        alerts-banner.ejs
        wan-summary.ejs
    static/
      pfmon.css
      htmx.min.js
      theme.js
    migrations/
      001_init.sql
  data/                         OUI csv + geo-ip db (copied into image)
  tests/
```

## 12. Out of scope (deferred)

The following could be added later but are not part of this design:

- Authentication / multi-user support.
- Active probing (ping sweeps, port scans).
- Per-device firewall rule management.
- Mobile-optimized layout.
- Historic export (CSV/Prometheus).
- Wake-on-LAN buttons.
- Integration with Home Assistant.

## 13. Open questions

None at this time. All major design decisions resolved during brainstorm.
