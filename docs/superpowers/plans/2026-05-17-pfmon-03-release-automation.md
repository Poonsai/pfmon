# pfmon Plan 3: Release Automation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the SemVer release pipeline the design spec calls for. release-please opens Release PRs whenever Conventional Commits land on `main`; merging a Release PR creates a git tag + GitHub Release, which triggers a second workflow that builds the Docker image and pushes it to `ghcr.io/poonsai/pfmon` with all SemVer tag variants (`X.Y.Z`, `X.Y`, `X`, `latest`).

**Prerequisite:** A repository secret `RELEASE_PLEASE_TOKEN` must already exist (it does — user added it during planning). This is a fine-grained PAT with `Contents: Read/Write` + `Pull requests: Read/Write` + `Issues: Read/Write` on `Poonsai/pfmon`. release-please uses this so its tag push triggers downstream workflows (the default `GITHUB_TOKEN` cannot do that).

**Architecture:** Two new workflows + two config files. release-please reads commit messages since the last tag, computes the next version, and maintains a `Release PR` on `main`. When that PR merges, release-please creates the tag and GitHub Release. The release-published event triggers the docker workflow, which builds + pushes the image with all the SemVer tag variants. Both workflows live in `.github/workflows/`.

**Tech stack additions:** None — pure GitHub Actions YAML + JSON config.

**End-of-plan milestone:** A `chore: ` commit lands on main → no Release PR. A `feat: ` or `fix: ` commit lands → release-please opens a Release PR titled `chore(main): release X.Y.Z` with version bump + CHANGELOG entry. Merging that PR creates `vX.Y.Z` tag, a GitHub Release, and `ghcr.io/poonsai/pfmon:X.Y.Z` (plus `X.Y`, `X`, `latest`) appears in the GHCR registry.

---

## Phase A — release-please configuration

### Task A1: `release-please-config.json` + `.release-please-manifest.json`

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`

Single-package node project; release-please reads the version from `package.json`.

- [ ] **Step 1: Create `release-please-config.json` at the repo root**

```json
{
  "release-type": "node",
  "bump-minor-pre-major": true,
  "bump-patch-for-minor-pre-major": false,
  "draft": false,
  "prerelease": false,
  "packages": {
    ".": {
      "package-name": "pfmon",
      "changelog-path": "CHANGELOG.md",
      "include-component-in-tag": false,
      "extra-files": []
    }
  }
}
```

- [ ] **Step 2: Create `.release-please-manifest.json` (must match current `package.json` version)**

```json
{
  ".": "0.1.0"
}
```

- [ ] **Step 3: Commit**

Use a `chore:` prefix so this commit does not influence the next version bump.

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "chore: add release-please configuration for single-package node project"
```

---

### Task A2: `.github/workflows/release-please.yml`

**Files:**
- Create: `.github/workflows/release-please.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: release-please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          token: ${{ secrets.RELEASE_PLEASE_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

The token override (vs. the default `GITHUB_TOKEN`) is what lets the tag-push event fan out to the docker-publish workflow.

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/release-please.yml
git commit -m "ci: add release-please workflow for automated SemVer releases"
git push
```

- [ ] **Step 3: Verify workflow triggers on the next push**

```bash
gh run list --workflow release-please.yml --limit 1
```

The first run on `main` will find no Conventional Commits since the (non-existent) last release, but will still produce a Release PR seeded from the initial 0.1.0 baseline. If no Release PR appears, check:

```bash
gh run view <run-id> --log
```

Common issues:
- `RELEASE_PLEASE_TOKEN` secret missing or wrong scope → workflow logs will say "no permission".
- Manifest file version doesn't match `package.json` → release-please will refuse to start.

If the workflow says "no release found", land a `feat:` or `fix:` commit on main and re-check; release-please needs a version-influencing commit before it opens a PR.

---

### Task A3: First Release PR appears

**Files:**
- (no source changes)

This is a verification step. We need a version-influencing commit to make release-please open its PR.

- [ ] **Step 1: Check for an existing Release PR**

```bash
gh pr list --label "autorelease: pending" 2>&1
gh pr list --search "in:title release" 2>&1
```

If a Release PR exists, skip to Step 4.

- [ ] **Step 2: Land a no-op feat commit if Release PR is missing**

If commits since the manifest baseline are all `chore:`/`docs:`/`ci:` (which don't trigger bumps), release-please won't open a PR. Add a minor feat to surface the pipeline:

```bash
# Bump the README's status line from "pre-1.0 design phase" to reflect Plans 1 + 2 are complete
sed -i.bak 's|pre-1.0 design phase.*$|pre-1.0 \(Plans 1+2 complete, Plan 3 in progress\).|' README.md && rm README.md.bak
git add README.md
git commit -m "feat: update README status to reflect Plans 1+2 complete"
git push
```

(On Windows/Git Bash the sed `-i.bak` form works; if it fails, edit the line by hand.)

- [ ] **Step 3: Wait for release-please workflow to run**

```bash
gh run watch $(gh run list --workflow release-please.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

- [ ] **Step 4: Verify the Release PR was opened**

```bash
gh pr list --search "release" 2>&1
```

You should see a PR titled like `chore(main): release 0.2.0`. The PR body will list the conventional commits since the last release and the proposed version bump.

- [ ] **Step 5: No code changes; no commit.**

---

## Phase B — Docker publish to GitHub Container Registry

### Task B1: `.github/workflows/release-docker.yml`

**Files:**
- Create: `.github/workflows/release-docker.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: release-docker

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      tag:
        description: "Version tag to build (e.g. 0.2.0). Defaults to the latest release."
        required: false

permissions:
  contents: read
  packages: write

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.release.tag_name || format('v{0}', github.event.inputs.tag) || github.ref }}

      - uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Compute version
        id: version
        run: |
          RAW="${{ github.event.release.tag_name || format('v{0}', github.event.inputs.tag) }}"
          VERSION="${RAW#v}"
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "Version: $VERSION"

      - name: Set up image metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/pfmon
          tags: |
            type=raw,value=${{ steps.version.outputs.version }}
            type=semver,pattern={{major}}.{{minor}},value=v${{ steps.version.outputs.version }}
            type=semver,pattern={{major}},value=v${{ steps.version.outputs.version }}
            type=raw,value=latest

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

The `docker/metadata-action` does the SemVer parsing. We pass it `v${VERSION}` so its `type=semver` patterns work. We also force `latest` via `type=raw` so it's pinned to every release (not just stable).

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/release-docker.yml
git commit -m "ci: add release-docker workflow to publish ghcr.io images on release"
git push
```

- [ ] **Step 3: Confirm workflow exists**

```bash
gh workflow list
```

Should show both `release-please` and `release-docker`.

- [ ] **Step 4: No source verification yet — runs only on release publication.**

---

### Task B2: README polish — install + deploy guide

**Files:**
- Modify: `README.md`

The README is currently a single paragraph. Now that the project actually works, expand it with a real install guide.

- [ ] **Step 1: Rewrite `README.md`**

Replace the entire content of `README.md` with:

```markdown
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
```

Commit messages are enforced via Husky + commitlint. The pre-commit hook rejects messages that aren't valid Conventional Commits.

## License

MIT. See [LICENSE](./LICENSE).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: expand README with install guide, env var table, and release process"
git push
```

This is a `docs:` commit so it does not trigger a release.

---

### Task B3: Update `docker-compose.yml` example for ghcr.io

**Files:**
- Modify: `docker-compose.yml`

The current compose file uses `build: .` plus `image:` — fine for local builds, but the published-image-first workflow is the deployment story. Make the compose file use the ghcr.io image by default, and provide a sibling `docker-compose.dev.yml` for local builds.

- [ ] **Step 1: Replace `docker-compose.yml`**

```yaml
services:
  pfmon:
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

(Same as before but without `build: .` so the file is purely about deployment.)

- [ ] **Step 2: Create `docker-compose.dev.yml` for local builds**

```yaml
services:
  pfmon:
    build: .
    image: pfmon:dev
    container_name: pfmon-dev
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

Usage:

```bash
# Production: pull and run
docker compose up -d

# Dev: build locally
docker compose -f docker-compose.dev.yml up -d --build
```

- [ ] **Step 3: Update README to mention the dev variant**

In `README.md`, find the "Local development" section and update the docker build line:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

(Add this line after `docker build -t pfmon:dev .` or replace it.)

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker-compose.dev.yml README.md
git commit -m "docs: switch docker-compose to ghcr.io image; add docker-compose.dev.yml for local builds"
git push
```

This is a `docs:` commit because the change is operational/documentation, not feature. (Arguable — could be `chore:` too. Both result in no version bump.)

---

## Phase C — Cut the first published release

### Task C1: Merge the Release PR

**Files:**
- (no source changes here — operating on GitHub)

By the time you reach this task, a Release PR should be open from Phase A. Merging it cuts the first published version.

- [ ] **Step 1: Inspect the Release PR**

```bash
gh pr list --search "release"
gh pr view <pr-number>
```

Read the CHANGELOG entry release-please proposed. Check the version bump is what you expect (0.2.0 or higher depending on the commits that triggered it).

- [ ] **Step 2: Merge the Release PR**

```bash
gh pr merge <pr-number> --merge
```

`--merge` creates a merge commit. `--squash` would also work but loses commit-by-commit history. release-please's docs recommend `--merge` or `--rebase`.

- [ ] **Step 3: Confirm the tag and Release were created**

```bash
gh release list --limit 3
git fetch --tags
git tag --list | tail -3
```

You should see `vX.Y.Z` as both a tag and a Release.

- [ ] **Step 4: Confirm the docker workflow fires**

```bash
gh run list --workflow release-docker.yml --limit 1
gh run watch $(gh run list --workflow release-docker.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

The workflow runs against the tag. Expect ~3-5 minutes for the multi-stage build.

- [ ] **Step 5: Confirm the image is in GHCR**

```bash
gh api /user/packages/container/pfmon/versions --jq '.[0:5] | .[] | .metadata.container.tags'
```

You should see your version, the X.Y, X, and `latest` tags.

Or via web: https://github.com/Poonsai/pfmon/pkgs/container/pfmon

- [ ] **Step 6: No commit.**

---

### Task C2: Smoke test the published image end-to-end

**Files:**
- (no source changes)

- [ ] **Step 1: Pull and run the published image**

```bash
docker pull ghcr.io/poonsai/pfmon:latest
docker run --rm -d --name pfmon-pub -p 8090:8080 \
  -e PFSENSE_URL=http://127.0.0.1:1 \
  -e PFSENSE_API_KEY=test \
  ghcr.io/poonsai/pfmon:latest
sleep 5
curl -sf http://localhost:8090/api/health
docker stop pfmon-pub
```

Expected: healthcheck returns 200 with `{"status":"ok"...}`.

- [ ] **Step 2: Optional — deploy against real pfSense**

If you have a working pfSense + pfRest key:

```bash
cd ~/somewhere
cp /path/to/pfmon/docker-compose.yml .
cat > .env <<'EOF'
PFSENSE_URL=https://pfsense.lan
PFSENSE_API_KEY=your-real-key
NTFY_TOPIC_URL=https://ntfy.sh/your-private-topic
EOF
docker compose up -d
# wait one poll cycle (~30-60s)
curl -s http://localhost:8080/ | head -5
```

Open http://localhost:8080/ in a browser. You should see live device data.

- [ ] **Step 3: No commit.**

---

### Task C3: Final repo hygiene

**Files:**
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml`
- (other repo-tidying as needed)

Now that 0.2.0 (or whatever first release) is published, do a final pass.

- [ ] **Step 1: Add a badge row to the top of README**

Right under the `# pfmon` heading, add:

```markdown
[![ci](https://github.com/Poonsai/pfmon/actions/workflows/ci.yml/badge.svg)](https://github.com/Poonsai/pfmon/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/Poonsai/pfmon?label=release)](https://github.com/Poonsai/pfmon/releases)
[![ghcr](https://img.shields.io/badge/ghcr.io-pfmon-blue)](https://github.com/Poonsai/pfmon/pkgs/container/pfmon)
```

- [ ] **Step 2: Update the README status line**

Replace the `pre-1.0 (Plans 1+2 complete, Plan 3 in progress)` line with:

```markdown
**Status: 0.X.0** — see [Releases](https://github.com/Poonsai/pfmon/releases) for the latest.
```

(Use the actual version that got published.)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add CI/release/GHCR badges and update status line"
git push
```

- [ ] **Step 4: Final test pass**

```bash
npm test
```

Expected: all tests still pass.

---

## Self-review

Spec coverage (mapped to spec section 9 — Versioning and release):

- **Conventional Commits enforced** → already landed in Plan 1 via commitlint + Husky (Task A6 of Plan 1).
- **MAJOR / MINOR / PATCH rules** → encoded in `release-please-config.json` (Task A1) and documented in README (Task B2).
- **release-please workflow opens Release PR on push to main** → Task A2.
- **Release PR contains version bump + CHANGELOG entry** → automatic via release-please-action@v4.
- **Merging Release PR creates git tag + GitHub Release** → Task C1.
- **release-docker workflow triggered by `release: published`** → Task B1.
- **Image published to `ghcr.io/<owner>/pfmon` tagged X.Y.Z / X.Y / X / latest** → Task B1 (docker/metadata-action).
- **README documents the version-bump rules** → Task B2.
- **Files added per spec section 9** → `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release-please.yml`, `.github/workflows/release-docker.yml`.

Plan 1 already covered: `commitlint.config.cjs`, `.husky/commit-msg`, `CHANGELOG.md` (empty stub — release-please will populate on first merge).

No placeholders. No TODOs. Every workflow has the actual YAML; every commit message is shown explicitly.

---

## Execution handoff

Plan 3 complete and saved to `docs/superpowers/plans/2026-05-17-pfmon-03-release-automation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review per task. Same workflow as Plans 1 and 2.
2. **Inline Execution** — execute tasks in this session with batch checkpoints.

Which approach?
