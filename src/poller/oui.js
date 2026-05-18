import { readFileSync } from 'node:fs';

export function loadOui(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = parseCsvLine(line);
    if (parts.length < 3) continue;
    const assignment = parts[1].toUpperCase().replace(/[^0-9A-F]/g, '');
    if (assignment.length !== 6) continue;
    map.set(assignment, parts[2]);
  }
  return map;
}

export function lookupVendor(map, mac) {
  if (!mac) return null;
  const prefix = mac
    .toUpperCase()
    .replace(/[^0-9A-F]/g, '')
    .slice(0, 6);
  if (prefix.length !== 6) return null;
  return map.get(prefix) ?? null;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"') {
        inQuote = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}
