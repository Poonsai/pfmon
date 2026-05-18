import { readFileSync } from 'node:fs';

function ipv4ToNum(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

export function loadGeoIp(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const ranges = [];
  for (const line of lines) {
    if (!line) continue;
    const [start, end, cc] = line.split(',');
    const s = ipv4ToNum(start);
    const e = ipv4ToNum(end);
    if (s == null || e == null || !cc) continue;
    ranges.push([s, e, cc.replace(/[^A-Za-z]/g, '').toUpperCase()]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

export function lookupCountry(ranges, ip) {
  const n = ipv4ToNum(ip);
  if (n == null) return null;
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e, cc] = ranges[mid];
    if (n < s) hi = mid - 1;
    else if (n > e) lo = mid + 1;
    else return cc;
  }
  return null;
}
