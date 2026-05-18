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
