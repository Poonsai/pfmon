import { Agent, fetch as undiciFetch } from 'undici';

const ENDPOINTS = {
  arp: '/api/v2/diagnostics/arp_table',
  dhcpLeases: '/api/v2/services/dhcp_server/leases',
  firewallStates: '/api/v2/firewall/states',
  interfaces: '/api/v2/interface',
  interfaceStats: '/api/v2/status/interfaces',
  ndp: '/api/v2/diagnostics/ndp_table',
  filterLog: '/api/v2/diagnostics/log/firewall',
};

export function createPfsenseClient({ baseUrl, apiKey, verifyTls, timeoutMs = 10_000 }) {
  if (!baseUrl) throw new Error('PFSENSE_URL required');
  if (!apiKey) throw new Error('PFSENSE_API_KEY required');

  const dispatcher = verifyTls === false
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;

  async function call(path) {
    const url = baseUrl.replace(/\/$/, '') + path;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await undiciFetch(url, {
        headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
        signal: controller.signal,
        dispatcher,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`pfRest ${path} -> ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      return json.data ?? json;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    fetchArpTable: () => call(ENDPOINTS.arp),
    fetchDhcpLeases: () => call(ENDPOINTS.dhcpLeases),
    fetchFirewallStates: () => call(ENDPOINTS.firewallStates),
    fetchInterfaces: () => call(ENDPOINTS.interfaces),
    fetchInterfaceStats: () => call(ENDPOINTS.interfaceStats),
    fetchNdpTable: () => call(ENDPOINTS.ndp),
    fetchFilterLogBlocks: async () => {
      try { return await call(ENDPOINTS.filterLog); }
      catch (e) {
        if (/404/.test(e.message)) return [];
        throw e;
      }
    },
  };
}
