# pfmon

A self-hosted dashboard for monitoring devices on a home network behind pfSense. Polls the [pfSense REST API addon](https://pfrest.org/), stores history in SQLite, and serves a single web page with current state plus per-device and network-wide trends.

**Status: pre-1.0 design phase.** No code yet. See the [design spec](docs/superpowers/specs/2026-05-17-pfmon-design.md).

## What it shows

- Every device on the network: name, IP, MAC, vendor, VLAN, online/offline status
- Per-device history: first-seen, last-seen, online/offline timeline, traffic totals (today / week / month / all-time)
- Network-wide WAN bandwidth chart with 24h / 7d / 30d ranges, optional per-VLAN breakdown
- New-device alerts via ntfy.sh push
- Light and dark themes

## Stack

Node.js + Express + HTMX + SQLite (better-sqlite3). One Docker container.

## Versioning

Strict SemVer 2.0 via Conventional Commits + release-please. Docker images published to `ghcr.io/<owner>/pfmon`.
