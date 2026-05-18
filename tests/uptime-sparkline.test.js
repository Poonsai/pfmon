import { describe, it, expect } from 'vitest';
import { renderUptimeSparklineSvg } from '../src/charts/uptime-sparkline.js';

describe('renderUptimeSparklineSvg', () => {
  it('renders a single green bar when device is online the whole window', () => {
    const now = 1_700_000_000;
    const events = [{ ts: now - 86400, status: 'online' }];
    const svg = renderUptimeSparklineSvg({
      events,
      windowStart: now - 86400,
      windowEnd: now,
      isOnlineNow: true,
    });
    expect(svg).toContain('<rect');
    expect(svg).toMatch(/fill="[^"]*green|22c55e[^"]*"/i);
  });

  it('renders alternating segments for transitions', () => {
    const now = 1_700_000_000;
    const events = [
      { ts: now - 86400, status: 'online' },
      { ts: now - 43200, status: 'offline' },
      { ts: now - 21600, status: 'online' },
    ];
    const svg = renderUptimeSparklineSvg({
      events,
      windowStart: now - 86400,
      windowEnd: now,
      isOnlineNow: true,
    });
    const rects = svg.match(/<rect/g) ?? [];
    expect(rects.length).toBe(3);
  });
});
