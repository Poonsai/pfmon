import { describe, it, expect } from 'vitest';
import { renderDeviceTrafficSvg } from '../src/charts/device-traffic-chart.js';

describe('renderDeviceTrafficSvg', () => {
  it('renders placeholder text when no samples', () => {
    expect(renderDeviceTrafficSvg({ samples: [] })).toContain('No data');
  });
  it('renders stacked polygons for rx/tx', () => {
    const samples = Array.from({ length: 24 }, (_, i) => ({
      ts: i * 3600,
      rx_bytes: 100 * (i + 1),
      tx_bytes: 30 * (i + 1),
    }));
    const svg = renderDeviceTrafficSvg({ samples });
    expect(svg.match(/<polygon/g)?.length).toBe(2);
  });
});
