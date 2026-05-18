function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

export function renderWanChartSvg({ samples, width = 600, height = 80, downColor = '#3b82f6', upColor = '#ef4444' }) {
  if (!samples || samples.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      <text x="50%" y="50%" text-anchor="middle" font-size="11" fill="#64748b">No data yet</text>
    </svg>`;
  }
  const maxRx = Math.max(...samples.map(s => s.rx_bytes), 1);
  const maxTx = Math.max(...samples.map(s => s.tx_bytes), 1);
  const max = Math.max(maxRx, maxTx);
  const n = samples.length;
  const stepX = width / Math.max(n - 1, 1);
  function toPoints(key) {
    const points = samples.map((s, i) => {
      const x = i * stepX;
      const y = height - (s[key] / max) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `${points.join(' ')} ${width},${height} 0,${height}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    <polygon points="${toPoints('rx_bytes')}" fill="${escapeXml(downColor)}" opacity="0.55"/>
    <polygon points="${toPoints('tx_bytes')}" fill="${escapeXml(upColor)}" opacity="0.55"/>
  </svg>`;
}
