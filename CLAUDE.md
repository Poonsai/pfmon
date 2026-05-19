# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`pfmon` is a self-hosted dashboard that polls a pfSense REST API (the pfRest addon) every 30s, stores history in SQLite, and serves a single HTMX-driven web page. One Node.js 20 + Express 5 process, one SQLite file, one Docker container. No frontend build step — HTMX 2 is shipped as `src/static/htmx.min.js` and the views are EJS templates.

## Common commands

```bash
npm test                                    # vitest, full suite
npm run test:watch                          # vitest in watch mode
npx vitest run tests/<name>.test.js         # single file
npx vitest run -t "pattern"                 # single test by name

npm run check                               # biome lint + format (read-only)
npm run check:fix                           # biome lint + format (writes)

npm start                                   # node src/index.js (requires env)
npm run fetch-data                          # downloads OUI + GeoIP CSVs to data/

docker compose up -d                                            # prod (pulls from ghcr)
docker compose -f docker-compose.dev.yml up -d --build          # dev (local build)
```

Run-time env is loaded directly from `process.env` (no dotenv). For `npm start` you must export the required vars (`PFSENSE_URL`, `PFSENSE_API_KEY`) yourself — see `.env.example`. The Dockerfile downloads `data/oui.csv` and `data/dbip-country-lite.csv` during the image build; for local dev outside Docker, run `npm run fetch-data` first.

## Architecture: hot path

The whole app is a poll loop plus a read-only view of what the loop wrote.

1. `src/index.js` boots: loads config, opens SQLite, runs migrations, loads OUI/GeoIP CSVs into memory, runs one synchronous initial poll, then starts the scheduler and the HTTP server.
2. `src/poller/index.js` schedules a cron tick every 5s gated by a `nextRunAt` watermark + a `running` re-entry guard. On success it sets `nextRunAt = now + intervalSec * 1000`; on failure it falls back to exponential backoff capped at 5 min.
3. Each `runOnePoll` (a) fetches arp / dhcp / ndp / firewall-states / interfaces / interface-stats / filter-log via `Promise.all` from `src/poller/pfsense.js`, (b) calls `buildSnapshot` to fold those plus OUI/GeoIP/`prevStateBytes` into a single shape, (c) reconciles devices/traffic/geo/firewall rows into SQLite, (d) maybe fires deferred ntfy alerts. `poll_log` records duration and error.
4. Two hourly/daily cron jobs in the same scheduler call `rollupHourly`, `rollupDaily`, `pruneOldRows` from `src/poller/retention.js`.

### State threaded through polls (lives in `index.js`)

- `prevStateBytes: Map` — per-pf-state byte totals from the previous poll. `buildSnapshot` diffs against this to attribute traffic to devices; without it the first delta after restart would be wrong.
- `ntfyRetry: Map<deviceId, {attempts, nextAttemptAt}>` — per-device alert retry state with exponential backoff up to `NTFY_MAX_ATTEMPTS`. Prevents a broken ntfy endpoint from re-attempting every candidate device every poll.

Both are passed into `runOnePoll` and mutated in place. The scheduler also keeps them across ticks.

## Architecture: rollup-existence partition

Traffic is stored at three granularities: `traffic_samples` (raw per-poll), `traffic_hourly` (filled by an on-the-hour rollup), `traffic_daily` (filled at 00:05). Dashboard queries **must not** use wall-clock cutoffs to choose between layers — the hourly rollup runs at :00, so for several minutes after the hour the previous hour's samples have nothing in `traffic_hourly` yet. Instead, queries union all layers and partition by `NOT EXISTS` against the next-coarser layer. A sample is counted only if no rollup row covers its bucket.

This logic is centralized in `src/routes/fragments.js`:

- `deviceBytesSinceSql({column, deviceIdExpr, sinceParam})` — hourly + samples-not-in-hourly.
- `deviceBytesAllTimeSql({column, deviceIdExpr})` — daily + hourly-not-in-daily + samples-not-in-hourly-and-not-in-daily.

Both return SQL fragments interpolated into the calling query. `column` and `deviceIdExpr` are caller-controlled hardcoded strings (never user input) so they're spliced rather than bound; `sinceParam` is a bind placeholder. If you change the rollup boundary rule, change it once in these two helpers and the three call sites (`sumDeviceBytes`, `sumDeviceBytesAllTime`, the inline `bytesTodaySql` in `/fragments/device-list`) inherit it.

## Architecture: HTMX form state

The controls form (search/status/vlan/sort) and the auto-refresh of the device list are wired so URL state survives both auto-refresh and F5:

- The form fires `GET /fragments/device-list` on change. Its `hx-on::after-request` calls `window.pfmonSyncUrl(form)` (in `src/static/theme.js`), which `history.replaceState`s the form values into the address bar as `/?q=...&sort=...`. `replaceState` (not `pushState`) avoids piling up back-button entries on every keystroke.
- The auto-refreshing device-list `<div>` has `hx-include=".controls"`, so its `every 30s` and `load` triggers carry the current form values (otherwise it would silently reset sort/filter on every refresh).
- `GET /` (`src/routes/page.js`) reads `req.query.{q,status,vlan,sort}` and passes them to `layout.ejs`, which renders the form's `value=` / `selected` from those. So F5 on `/?sort=bytes_today` reproduces the same filtered view.

When adding new filter inputs, all three pieces must be updated together: the form template, `page.js`'s `query` object, and the fragment endpoint's accepted params.

## Schema and migrations

`src/migrations/NNN_*.sql` files, run in lexical order at startup by `runMigrations` in `src/db.js`. Each file runs in its own transaction; `schema_migrations` tracks what's applied. `PRAGMA` statements are dispatched separately from `db.prepare(...).run()` (better-sqlite3 doesn't accept PRAGMAs through prepared statements). Append new migrations; do not edit existing files.

WAL is enabled and `foreign_keys = ON`. Use `ON DELETE CASCADE` for device-owned data (`device_tags`, `uptime_events`, `traffic_*`, `geo_connections`) and `ON DELETE SET NULL` for foreign keys that should survive deletion of the referenced row (`devices.interface_id`).

## Shutdown

`src/index.js` installs SIGINT/SIGTERM handlers that stop the scheduler, await any in-flight poll (so we don't write to a closing DB handle), close idle HTTP connections, drain remaining requests, then `db.close()`. An 8s `setTimeout` is the force-exit guard: HTMX keep-alives can sit idle for the full 30s poll interval, so without the timeout `docker stop` would always reach SIGKILL before WAL is flushed.

## Configuration

All settings are env vars; see `.env.example` and `src/config.js`. `loadConfig` exits with code 2 on missing required envs or non-positive-integer numeric envs — failing fast is intentional. Note: `LOG_LEVEL` is defined in config but **not currently wired to any log call site** (everything is bare `console.log(JSON.stringify(...))`). Don't pretend it works; either wire it up first or leave it.

## Releases

Versioning is driven by [release-please](https://github.com/googleapis/release-please) using Conventional Commits — **not** the manual `git tag` flow described in the user-level CLAUDE.md. The release-please workflow watches `main` and maintains a Release PR; merging it creates the tag, the GitHub Release, and triggers a Docker build to `ghcr.io/poonsai/pfmon`. The version in `package.json` is the source of truth; do not bump it by hand.

Commit messages are enforced by Husky + commitlint at `commit-msg`. Use `feat:` / `fix:` / `chore:` / `refactor:` / `test:` / `docs:` / `ci:` / `perf:` / `style:`. `feat:` bumps minor; `fix:` and `perf:` bump patch; `feat!:` / `BREAKING CHANGE:` footer bumps major; `chore` / `docs` / `ci` / `refactor` / `test` / `style` do not bump.

## Testing notes

Tests use vitest with supertest + cheerio for HTTP-level assertions on the EJS-rendered HTML. DB tests open `new Database(':memory:')` and run `runMigrations(db)` per test; this is fast — a full run of 30 files is ~1.2s. Prefer asserting on rendered HTML or returned rows over mocking the DB.

## Code conventions

- Biome handles lint + format (`biome.json`); EJS views and `htmx.min.js` are excluded.
- ES modules throughout (`"type": "module"`), Node 20+, top-level `await` in `index.js`.
- Logs are single-line JSON: `console.log(JSON.stringify({ level, msg, ...fields }))`.
- SQL lives next to the route or poller code that calls it; there is no ORM. Prepared statements via `db.prepare(...).get/all/run(...)`.
