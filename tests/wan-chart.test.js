import { describe, expect, it } from 'vitest';
import { renderWanChartSvg } from '../src/charts/wan-chart.js';

describe('renderWanChartSvg', () => {
  it('returns an empty placeholder when no samples', () => {
    const svg = renderWanChartSvg({ samples: [], width: 600, height: 80 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('No data');
  });

  it('renders two stacked polygons for down + up when samples exist', () => {
    const now = Math.floor(Date.now() / 1000);
    const samples = Array.from({ length: 24 }, (_, i) => ({
      ts: now - (24 - i) * 3600,
      rx_bytes: 1000 * (i + 1),
      tx_bytes: 200 * (i + 1),
    }));
    const svg = renderWanChartSvg({ samples, width: 600, height: 80 });
    const polys = svg.match(/<polygon/g) ?? [];
    expect(polys.length).toBe(2);
    expect(svg).toContain('viewBox="0 0 600 80"');
  });
});
