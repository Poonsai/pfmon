const ONLINE = '#22c55e';
const OFFLINE = '#cbd5e1';

export function renderUptimeSparklineSvg({
  events,
  windowStart,
  windowEnd,
  isOnlineNow,
  width = 400,
  height = 14,
}) {
  const span = Math.max(windowEnd - windowStart, 1);
  if (!events || events.length === 0) {
    const color = isOnlineNow ? ONLINE : OFFLINE;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="${color}"/>
    </svg>`;
  }
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const segments = [];
  let cursor = windowStart;
  let currentStatus = sorted[0].status === 'online' ? 'offline' : 'online';
  for (const e of sorted) {
    if (e.ts < windowStart) {
      currentStatus = e.status;
      continue;
    }
    if (e.ts > windowEnd) break;
    if (e.ts > cursor) {
      segments.push({ start: cursor, end: e.ts, status: currentStatus });
    }
    cursor = e.ts;
    currentStatus = e.status;
  }
  if (cursor < windowEnd) {
    segments.push({ start: cursor, end: windowEnd, status: currentStatus });
  }
  const rects = segments
    .map((s) => {
      const x = ((s.start - windowStart) / span) * width;
      const w = ((s.end - s.start) / span) * width;
      const color = s.status === 'online' ? ONLINE : OFFLINE;
      return `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${height}" fill="${color}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">${rects}</svg>`;
}
