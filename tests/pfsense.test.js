import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createPfsenseClient } from '../src/poller/pfsense.js';

let server, baseUrl;

beforeAll(() => new Promise((resolve) => {
  const app = express();
  app.use((req, res, next) => {
    if (req.headers['x-api-key'] !== 'test-key') return res.status(401).json({ error: 'unauth' });
    next();
  });
  app.get('/api/v2/diagnostics/arp_table', (req, res) =>
    res.json({ data: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.42', hostname: 'tv', interface: 'lan' }] }));
  app.get('/api/v2/interfaces', (req, res) =>
    res.json({ data: [
      { if: 'wan', descr: 'WAN' },
      { if: 'lan', descr: 'LAN', ipv4_address: '10.0.0.1', ipv4_subnet: '24' },
    ] }));
  app.get('/api/v2/status/interfaces', (req, res) =>
    res.json({ data: [{ name: 'wan', inbytes: 100, outbytes: 50 }, { name: 'lan', inbytes: 999, outbytes: 888 }] }));
  server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));

afterAll(() => new Promise((r) => server.close(r)));

describe('pfsense client', () => {
  it('sends X-API-Key header', async () => {
    const c = createPfsenseClient({ baseUrl, apiKey: 'wrong-key', verifyTls: true });
    await expect(c.fetchArpTable()).rejects.toThrow(/401/);
  });

  it('returns normalized ARP rows', async () => {
    const c = createPfsenseClient({ baseUrl, apiKey: 'test-key', verifyTls: true });
    const rows = await c.fetchArpTable();
    expect(rows).toEqual([{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.42', hostname: 'tv', interface: 'lan' }]);
  });

  it('returns interface list', async () => {
    const c = createPfsenseClient({ baseUrl, apiKey: 'test-key', verifyTls: true });
    const ifaces = await c.fetchInterfaces();
    expect(ifaces.find(i => i.if === 'wan')).toBeTruthy();
  });

  it('returns interface stats', async () => {
    const c = createPfsenseClient({ baseUrl, apiKey: 'test-key', verifyTls: true });
    const stats = await c.fetchInterfaceStats();
    expect(stats.find(s => s.name === 'wan').inbytes).toBe(100);
  });
});
