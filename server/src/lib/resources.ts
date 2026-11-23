/** Daftar menu RouterOS yang boleh diakses lewat API proxy generik beserta hak aksesnya. */
export interface ResourceRule {
  group: 'config' | 'hotspot';
  readOnly?: boolean;
  noAdd?: boolean;
  danger?: boolean;
}

export const RESOURCE_RULES: Record<string, ResourceRule> = {
  '/interface': { group: 'config', noAdd: true },
  '/interface/bridge': { group: 'config' },
  '/interface/bridge/port': { group: 'config' },
  '/interface/vlan': { group: 'config' },
  '/interface/pppoe-server/server': { group: 'config' },
  '/ip/address': { group: 'config' },
  '/ip/route': { group: 'config' },
  '/ip/pool': { group: 'config' },
  '/ip/dhcp-server': { group: 'config' },
  '/ip/dhcp-server/lease': { group: 'config' },
  '/ip/dhcp-server/network': { group: 'config' },
  '/ip/dns/static': { group: 'config' },
  '/ip/firewall/filter': { group: 'config' },
  '/ip/firewall/nat': { group: 'config' },
  '/ip/firewall/mangle': { group: 'config' },
  '/ip/firewall/address-list': { group: 'config' },
  '/ip/arp': { group: 'config' },
  '/ip/neighbor': { group: 'config', readOnly: true },
  '/ip/service': { group: 'config', noAdd: true, danger: true },
  '/queue/simple': { group: 'config' },
  '/queue/type': { group: 'config' },
  '/queue/tree': { group: 'config' },
  '/ppp/secret': { group: 'config' },
  '/ppp/profile': { group: 'config' },
  '/ppp/active': { group: 'config', noAdd: true },
  '/system/scheduler': { group: 'config', danger: true },
  '/system/script': { group: 'config', danger: true },
  '/user': { group: 'config', danger: true },
  '/user/group': { group: 'config', readOnly: true },
  '/file': { group: 'config', noAdd: true },
  '/ip/hotspot': { group: 'hotspot' },
  '/ip/hotspot/profile': { group: 'hotspot' },
  '/ip/hotspot/user': { group: 'hotspot' },
  '/ip/hotspot/user/profile': { group: 'hotspot' },
  '/ip/hotspot/active': { group: 'hotspot', noAdd: true },
  '/ip/hotspot/host': { group: 'hotspot', noAdd: true },
  '/ip/hotspot/ip-binding': { group: 'hotspot' },
  '/ip/hotspot/walled-garden': { group: 'hotspot' },
  '/ip/hotspot/walled-garden/ip': { group: 'hotspot' },
  '/ip/hotspot/cookie': { group: 'hotspot', noAdd: true },
};

export const SINGLETON_RULES: Record<string, { readOnly?: boolean; danger?: boolean }> = {
  '/system/identity': {},
  '/system/routerboard': { readOnly: true },
  '/system/resource': { readOnly: true },
  '/system/clock': {},
  '/system/ntp/client': {},
  '/ip/dns': {},
  '/ip/cloud': {},
  '/snmp': {},
};

const KEY_RE = /^[a-z0-9][a-z0-9.\-]*$/i;

/** Bersihkan body dari browser menjadi parameter RouterOS yang aman. */
export function sanitizeParams(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body || typeof body !== 'object') return out;
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!KEY_RE.test(k) || k === '.id' || k === 'numbers') continue;
    if (v === undefined || v === null) continue;
    if (typeof v === 'boolean') out[k] = v ? 'yes' : 'no';
    else if (typeof v === 'number') out[k] = String(v);
    else if (typeof v === 'string') out[k] = v;
  }
  return out;
}
