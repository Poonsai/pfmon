import { renderWanChartSvg } from './wan-chart.js';

export function renderDeviceTrafficSvg({ samples, width = 400, height = 50 }) {
  return renderWanChartSvg({ samples, width, height });
}
