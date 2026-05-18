# pfmon

A self-hosted dashboard for monitoring devices on a home network behind pfSense. Polls the [pfSense REST API addon](https://pfrest.org/) every 30 seconds, stores history in SQLite, and serves a single web page showing current state plus per-device and network-wide trends.

## What it tracks

- Every device on the network: name, IP, MAC, vendor, VLAN, online/offline
- First-seen and last-seen timestamps, uptime timeline
- Bandwidth per device and network-wide WAN totals (today / week / month / all-time)
- New-device alerts via ntfy.sh push notification
- Per-device firewall blocks (last 7 days) and geo-IP tally of recent destinations
- Light and dark themes; preference saved to localStorage

## Stack

Node.js 20 + Express 5 + HTMX 2 + SQLite (better-sqlite3). One Docker container. No frontend build step.

## Quick start (docker-compose)

Create a `.env` file in the project root:

```env
PFSENSE_URL=https://pfsense.lan
PFSENSE_API_KEY=your-pfrest-api-key
PFSENSE_VERIFY_TLS=true
POLL_INTERVAL_SECONDS=30
NTFY_TOPIC_URL=https://ntfy.sh/your-private-topic
NEW_DEVICE_GRACE_MINUTES=5
```

Use the shipped `docker-compose.yml` which pulls from GitHub Container Registry:

```bash
docker compose up -d
```

Open http://localhost:8080/. The dashboard polls pfSense every 30s and populates as data arrives.

## Generating a pfSense API key

In pfSense, install the pfRest addon (see https://pfrest.org/INSTALL_AND_CONFIG/). Then create an API key under **System → REST API → Authentication / API Keys** (path varies by pfRest version). pfmon uses the API Key authentication mode and sends the key as the `X-API-Key` header on every request.

## Configuration

All settings are environment variables. See `.env.example` for the full list:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PFSENSE_URL` | yes | - | Base URL of pfSense web UI (e.g. `https://pfsense.lan`) |
| `PFSENSE_API_KEY` | yes | - | pfRest API key, sent as `X-API-Key` header |
| `PFSENSE_VERIFY_TLS` | no | `true` | Set `false` only for self-signed certs |
| `POLL_INTERVAL_SECONDS` | no | `30` | How often to poll pfSense |
| `NTFY_TOPIC_URL` | no | - | If set, POSTs to this URL on new device. Leave empty to disable pushes. |
| `NEW_DEVICE_GRACE_MINUTES` | no | `5` | Wait window before alerting (prevents flap alerts) |
| `DB_PATH` | no | `/data/pfmon.db` | SQLite location |
| `PORT` | no | `8080` | HTTP listener port |
| `LOG_LEVEL` | no | `info` | `info`, `debug`, `warn`, `error` |
| `WAN_INTERFACE_NAME` | no | (auto) | Override which interface is treated as WAN |

## Releases

Versioning follows [strict SemVer 2.0](https://semver.org/) via [Conventional Commits](https://www.conventionalcommits.org/) + [release-please](https://github.com/googleapis/release-please).

| Commit type | Version bump | Example |
|---|---|---|
| `feat:` | minor | `feat: add Wi-Fi signal strength column` |
| `fix:` | patch | `fix: handle missing DHCP lease for static IPs` |
| `feat!:` / `BREAKING CHANGE:` | major | `feat!: replace POLL_INTERVAL with POLL_INTERVAL_SECONDS` |
| `chore:`, `docs:`, `ci:`, `refactor:`, `test:`, `style:` | none | `chore: bump dependencies` |

Every push to `main` triggers the `release-please` workflow which maintains a Release PR. Merging the Release PR creates the git tag, the GitHub Release, and triggers the `release-docker` workflow which publishes the image to `ghcr.io/poonsai/pfmon` tagged with all SemVer variants.

## Local development

```bash
npm install
npm test                            # vitest suite
npm start                           # node src/index.js (requires env vars)
docker build -t pfmon:dev .         # full image build (downloads OUI + GeoIP)
docker compose -f docker-compose.dev.yml up -d --build
```

Commit messages are enforced via Husky + commitlint. The pre-commit hook rejects messages that aren't valid Conventional Commits.

## License

MIT. See [LICENSE](./LICENSE).
