import { hasCoord, type Diagnosis, type Finding, type Topology } from './pppoe';

export type NodeKind = 'server' | 'odc' | 'odp' | 'customer';
export type Health = 'ok' | 'fault' | 'suspect' | 'dark' | 'unknown' | 'isolated' | 'disabled';

export interface MapNode {
  id: string;
  kind: NodeKind;
  lat: number;
  lng: number;
  label: string;
  health: Health;
  detail: string;
}

export interface MapLine {
  id: string;
  from: [number, number];
  to: [number, number];
  health: Health;
  detail: string;
}

export const HEALTH_COLOR: Record<Health, string> = {
  ok: '#10b981',
  fault: '#f43f5e',
  suspect: '#f59e0b',
  dark: '#94a3b8',
  unknown: '#94a3b8',
  isolated: '#f59e0b',
  disabled: '#94a3b8',
};

/** Susun titik dan garis peta dari topologi, diwarnai menurut hasil diagnosis. */
export function buildFiberMap(topo: Topology, diag?: Diagnosis, opts: { customers?: boolean } = {}) {
  const nodes: MapNode[] = [];
  const lines: MapLine[] = [];
  let missing = 0;
  const findings = diag?.findings ?? [];
  const byTarget = (type: string, id: number) => findings.find((f) => f.to.type === type && f.to.id === id);
  const serverFault = findings.find((f) => f.kind === 'server');
  const lineHealth = (f: Finding | undefined): Health | undefined => (f ? (f.severity === 'critical' ? 'fault' : 'suspect') : undefined);
  const s = topo.server;

  if (hasCoord(s)) nodes.push({ id: 'server', kind: 'server', lat: s.lat, lng: s.lng, label: s.name, health: serverFault ? 'fault' : 'ok', detail: s.location || 'Server PPPoE' });
  else missing++;

  const addOdp = (o: Topology['looseOdps'][number], up: { lat: number | null; lng: number | null; name: string }, parentDark: boolean) => {
    const f = byTarget('odp', o.id);
    const live = o.customers.filter((c) => c.status !== 'disabled');
    const health: Health = parentDark ? 'dark' : lineHealth(f) ?? (o.online > 0 ? 'ok' : live.length ? 'dark' : 'unknown');
    if (!hasCoord(o)) {
      missing++;
    } else {
      nodes.push({ id: `odp-${o.id}`, kind: 'odp', lat: o.lat, lng: o.lng, label: o.name, health, detail: `${o.online}/${o.used} online • ${o.used}/${o.ports} port${o.location ? ` • ${o.location}` : ''}` });
      if (hasCoord(up)) lines.push({ id: `l-odp-${o.id}`, from: [up.lat, up.lng], to: [o.lat, o.lng], health, detail: f ? f.title : `${up.name} → ${o.name}` });
    }
    if (!opts.customers) return;
    for (const c of o.customers) {
      if (!hasCoord(c)) continue;
      const cf = byTarget('customer', c.id);
      const ch: Health = c.status === 'disabled' ? 'disabled' : lineHealth(cf) ?? (c.online ? (c.status === 'isolated' ? 'isolated' : 'ok') : 'dark');
      nodes.push({ id: `c-${c.id}`, kind: 'customer', lat: c.lat, lng: c.lng, label: c.name, health: ch, detail: `${c.username} • ${c.online ? 'online' : 'offline'}${c.odp_port ? ` • port ${c.odp_port}` : ''}` });
      if (hasCoord(o)) lines.push({ id: `l-c-${c.id}`, from: [o.lat, o.lng], to: [c.lat, c.lng], health: ch, detail: cf ? cf.title : `${o.name} → ${c.name}` });
    }
  };

  for (const d of topo.odcs) {
    const f = byTarget('odc', d.id);
    const fault = !!serverFault || f?.kind === 'feeder';
    const health: Health = serverFault ? 'dark' : lineHealth(f) ?? (d.online > 0 ? 'ok' : d.customers ? 'dark' : 'unknown');
    if (hasCoord(d)) {
      nodes.push({ id: `odc-${d.id}`, kind: 'odc', lat: d.lat, lng: d.lng, label: d.name, health, detail: `${d.online}/${d.customers} online • ${d.used}/${d.ports} port ODC${d.location ? ` • ${d.location}` : ''}` });
      if (hasCoord(s)) lines.push({ id: `l-odc-${d.id}`, from: [s.lat, s.lng], to: [d.lat, d.lng], health: serverFault ? 'fault' : health, detail: f ? f.title : `${s.name} → ${d.name}` });
    } else missing++;
    for (const o of d.odps) addOdp(o, d, fault);
  }
  for (const o of topo.looseOdps) addOdp(o, s, !!serverFault);
  return { nodes, lines, missing };
}
