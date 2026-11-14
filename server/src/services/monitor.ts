import type { DB } from '../db/index.js';
import { parseDuration } from '../lib/duration.js';
import type { RosRow } from '../lib/routeros/types.js';
import type { AlertService, Hub } from './alerts.js';
import type { RouterManager, RouterRecord } from './routers.js';
import type { SettingsService } from './settings.js';

export interface RouterSnapshot {
  routerId: number;
  online: boolean;
  ts: number;
  error?: string;
  identity?: string;
  version?: string;
  board?: string;
  uptime?: string;
  uptimeSeconds?: number;
  cpu?: number;
  cpuCount?: number;
  memUsed?: number;
  memTotal?: number;
  hddUsed?: number;
  hddTotal?: number;
  hotspotActive?: number;
  pppActive?: number;
  dhcpLeases?: number;
  wan?: string;
  rx?: number;
  tx?: number;
  temperature?: number;
  voltage?: number;
  interfacesDown?: string[];
}

interface RouterState {
  busy: boolean;
  online?: boolean;
  lastMetricAt: number;
  cpuHigh: boolean;
  memHigh: boolean;
  tempHigh: boolean;
  ifaceRunning: Map<string, boolean>;
  failures: number;
}

const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));

async function countOf(rows: Promise<RosRow[]>): Promise<number> {
  const r = await rows;
  if (r.length === 1 && r[0].ret !== undefined && Object.keys(r[0]).length === 1) return Number(r[0].ret);
  return r.length;
}

export class MonitorService {
  private states = new Map<number, RouterState>();
  readonly latest = new Map<number, RouterSnapshot>();
  private pollTimer?: NodeJS.Timeout;
  private trafficTimer?: NodeJS.Timeout;
  private housekeepingTimer?: NodeJS.Timeout;
  private trafficSubs = new Map<number, Map<string, Set<string>>>();
  private trafficBusy = new Set<number>();
  private stopped = true;

  constructor(
    private readonly db: DB,
    private readonly routers: RouterManager,
    private readonly settings: SettingsService,
    private readonly alerts: AlertService,
    private readonly hub: Hub,
    private readonly log: { info: (...a: any[]) => void; warn: (...a: any[]) => void } = console,
  ) {}

  start() {
    this.stopped = false;
    const loop = async () => {
      if (this.stopped) return;
      await this.pollAll().catch((err) => this.log.warn({ err }, 'Polling router gagal'));
      if (this.stopped) return;
      this.pollTimer = setTimeout(loop, Math.max(3, this.settings.get().monitor.pollSeconds) * 1000);
    };
    void loop();
    this.trafficTimer = setInterval(() => void this.pollTraffic(), 2000);
    this.housekeepingTimer = setInterval(() => this.housekeeping(), 3600_000);
    this.housekeeping();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearInterval(this.trafficTimer);
    clearInterval(this.housekeepingTimer);
  }

  private state(id: number): RouterState {
    let s = this.states.get(id);
    if (!s) {
      s = { busy: false, lastMetricAt: 0, cpuHigh: false, memHigh: false, tempHigh: false, ifaceRunning: new Map(), failures: 0 };
      this.states.set(id, s);
    }
    return s;
  }

  async pollAll() {
    const list = this.routers.list().filter((r) => r.enabled);
    await Promise.allSettled(list.map((r) => this.pollRouter(r)));
  }

  async pollRouter(r: RouterRecord): Promise<RouterSnapshot | undefined> {
    const st = this.state(r.id);
    if (st.busy) return this.latest.get(r.id);
    st.busy = true;
    try {
      const snap = await this.collect(r);
      st.failures = 0;
      this.onOnline(r, st, snap);
      return snap;
    } catch (err) {
      st.failures++;
      this.onOffline(r, st, err as Error);
      return this.latest.get(r.id);
    } finally {
      st.busy = false;
    }
  }

  private async collect(r: RouterRecord): Promise<RouterSnapshot> {
    const exec = (cmd: string, params?: Record<string, string>, q?: string[]) => this.routers.exec(r.id, cmd, params, q);
    const [resRows, identityRows] = await Promise.all([exec('/system/resource/print'), exec('/system/identity/print')]);
    const res = resRows[0] ?? {};
    const optional = async <T>(p: Promise<T>, fallback: T) => {
      try {
        return await p;
      } catch {
        return fallback;
      }
    };
    const [health, hotspotActive, pppActive, dhcpLeases, ifaces] = await Promise.all([
      optional(exec('/system/health/print'), [] as RosRow[]),
      optional(countOf(exec('/ip/hotspot/active/print', { 'count-only': '' })), 0),
      optional(countOf(exec('/ppp/active/print', { 'count-only': '' })), 0),
      optional(countOf(exec('/ip/dhcp-server/lease/print', { 'count-only': '' })), 0),
      optional(exec('/interface/print', { '.proplist': 'name,type,running,disabled,comment' }), [] as RosRow[]),
    ]);

    let wan = r.wan_interface;
    if (!wan) {
      wan = ifaces.find((i) => /wan|isp|internet/i.test(i.name ?? '') || /wan|isp|internet/i.test(i.comment ?? ''))?.name ?? ifaces.find((i) => i.type === 'ether' && i.running === 'true')?.name ?? '';
    }
    let rx: number | undefined;
    let tx: number | undefined;
    if (wan) {
      const t = await optional(exec('/interface/monitor-traffic', { interface: wan, once: '' }), [] as RosRow[]);
      rx = num(t[0]?.['rx-bits-per-second']);
      tx = num(t[0]?.['tx-bits-per-second']);
    }

    // RouterOS v6: health berupa satu baris {voltage, temperature}; v7: banyak baris {name, value}
    let temperature: number | undefined;
    let voltage: number | undefined;
    for (const h of health) {
      if (h.name) {
        if (h.name === 'temperature' || (h.name === 'cpu-temperature' && temperature === undefined)) temperature = num(h.value);
        if (h.name === 'voltage') voltage = num(h.value);
      } else {
        temperature ??= num(h.temperature ?? h['cpu-temperature']);
        voltage ??= num(h.voltage);
      }
    }

    const memTotal = num(res['total-memory']);
    const memFree = num(res['free-memory']);
    const hddTotal = num(res['total-hdd-space']);
    const hddFree = num(res['free-hdd-space']);

    const watched = ifaces.filter((i) => i.disabled !== 'true' && (i.name === wan || /\[monitor\]/i.test(i.comment ?? '')));
    const snap: RouterSnapshot = {
      routerId: r.id,
      online: true,
      ts: Date.now(),
      identity: identityRows[0]?.name,
      version: res.version,
      board: res['board-name'],
      uptime: res.uptime,
      uptimeSeconds: parseDuration(res.uptime),
      cpu: num(res['cpu-load']),
      cpuCount: num(res['cpu-count']),
      memTotal,
      memUsed: memTotal !== undefined && memFree !== undefined ? memTotal - memFree : undefined,
      hddTotal,
      hddUsed: hddTotal !== undefined && hddFree !== undefined ? hddTotal - hddFree : undefined,
      hotspotActive,
      pppActive,
      dhcpLeases,
      wan,
      rx,
      tx,
      temperature,
      voltage,
      interfacesDown: watched.filter((i) => i.running !== 'true').map((i) => i.name),
    };
    // simpan status interface yang dipantau untuk deteksi perubahan
    (snap as any)._watched = watched.map((i) => [i.name, i.running === 'true'] as const);
    return snap;
  }

  private onOnline(r: RouterRecord, st: RouterState, snap: RouterSnapshot) {
    const s = this.settings.get();
    const watched: (readonly [string, boolean])[] = (snap as any)._watched ?? [];
    delete (snap as any)._watched;
    this.latest.set(r.id, snap);
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE routers SET status = 'online', status_message = '', identity = ?, version = ?, board = ?, last_seen_at = ? WHERE id = ?`,
      [snap.identity ?? '', snap.version ?? '', snap.board ?? '', now, r.id],
    );
    if (st.online === false && s.alerts.offline) {
      this.alerts.create({ routerId: r.id, level: 'success', type: 'router.online', title: `${r.name} kembali online`, message: `Router dapat dijangkau lagi. Uptime ${snap.uptime ?? '-'}.` });
    }
    st.online = true;

    // Ambang batas dengan histeresis 5%
    const memPct = snap.memTotal ? ((snap.memUsed ?? 0) / snap.memTotal) * 100 : 0;
    const check = (key: 'cpuHigh' | 'memHigh' | 'tempHigh', value: number | undefined, limit: number, label: string, unit: string) => {
      if (value === undefined || !limit) return;
      if (!st[key] && value >= limit) {
        st[key] = true;
        this.alerts.create({ routerId: r.id, level: 'warning', type: `router.${key}`, title: `${label} tinggi di ${r.name}`, message: `${label} ${value.toFixed(0)}${unit} (batas ${limit}${unit}).` });
      } else if (st[key] && value < limit - 5) {
        st[key] = false;
        this.alerts.create({ routerId: r.id, level: 'success', type: `router.${key}.ok`, title: `${label} ${r.name} kembali normal`, message: `${label} sekarang ${value.toFixed(0)}${unit}.`, notify: false });
      }
    };
    check('cpuHigh', snap.cpu, s.alerts.cpu, 'CPU', '%');
    check('memHigh', memPct, s.alerts.memory, 'Memori', '%');
    check('tempHigh', snap.temperature, s.alerts.temperature, 'Suhu', '°C');

    if (s.alerts.interfaceDown) {
      for (const [name, running] of watched) {
        const prev = st.ifaceRunning.get(name);
        if (prev === true && !running) {
          this.alerts.create({ routerId: r.id, level: 'critical', type: 'interface.down', title: `Interface ${name} DOWN di ${r.name}`, message: 'Link terputus. Periksa kabel/ISP.' });
        } else if (prev === false && running) {
          this.alerts.create({ routerId: r.id, level: 'success', type: 'interface.up', title: `Interface ${name} UP kembali di ${r.name}` });
        }
        st.ifaceRunning.set(name, running);
      }
    }

    if (snap.ts - st.lastMetricAt >= s.monitor.metricsEverySeconds * 1000 - 500) {
      st.lastMetricAt = snap.ts;
      this.db.run(
        `INSERT INTO metrics (router_id, ts, cpu, mem_used, mem_total, hdd_used, hdd_total, hotspot_active, ppp_active, rx_bps, tx_bps, temperature, voltage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, snap.ts, snap.cpu ?? null, snap.memUsed ?? null, snap.memTotal ?? null, snap.hddUsed ?? null, snap.hddTotal ?? null, snap.hotspotActive ?? null, snap.pppActive ?? null, snap.rx ?? null, snap.tx ?? null, snap.temperature ?? null, snap.voltage ?? null],
      );
    }
    this.hub.emit('status', snap);
  }

  private onOffline(r: RouterRecord, st: RouterState, err: Error) {
    const message = err.message || String(err);
    const snap: RouterSnapshot = { routerId: r.id, online: false, ts: Date.now(), error: message };
    this.latest.set(r.id, snap);
    this.db.run(`UPDATE routers SET status = 'offline', status_message = ? WHERE id = ?`, [message.slice(0, 500), r.id]);
    // Alert setelah 2 kali gagal berturut-turut agar tidak "flapping"
    if (st.online !== false && st.failures >= 2) {
      if (this.settings.get().alerts.offline && st.online === true) {
        this.alerts.create({ routerId: r.id, level: 'critical', type: 'router.offline', title: `${r.name} OFFLINE`, message });
      }
      st.online = false;
    } else if (st.online === undefined && st.failures >= 1) {
      st.online = false;
    }
    this.hub.emit('status', snap);
  }

  forget(routerId: number) {
    this.states.delete(routerId);
    this.latest.delete(routerId);
    this.trafficSubs.delete(routerId);
  }

  // ---- Trafik realtime per interface (berlangganan via WebSocket) ----

  subscribeTraffic(routerId: number, clientId: string, interfaces: string[]) {
    let m = this.trafficSubs.get(routerId);
    if (!m) {
      m = new Map();
      this.trafficSubs.set(routerId, m);
    }
    m.set(clientId, new Set(interfaces.slice(0, 32)));
  }

  unsubscribeTraffic(clientId: string, routerId?: number) {
    for (const [rid, m] of this.trafficSubs) {
      if (routerId !== undefined && rid !== routerId) continue;
      m.delete(clientId);
      if (!m.size) this.trafficSubs.delete(rid);
    }
  }

  private async pollTraffic() {
    for (const [routerId, subs] of this.trafficSubs) {
      if (this.trafficBusy.has(routerId)) continue;
      const names = new Set<string>();
      for (const s of subs.values()) for (const n of s) names.add(n);
      if (!names.size) continue;
      this.trafficBusy.add(routerId);
      this.routers
        .exec(routerId, '/interface/monitor-traffic', { interface: [...names].join(','), once: '' })
        .then((rows) => {
          this.hub.emit('traffic', {
            routerId,
            ts: Date.now(),
            interfaces: rows.map((r) => ({
              name: r.name,
              rx: Number(r['rx-bits-per-second'] ?? 0),
              tx: Number(r['tx-bits-per-second'] ?? 0),
              rxPps: Number(r['rx-packets-per-second'] ?? 0),
              txPps: Number(r['tx-packets-per-second'] ?? 0),
            })),
          });
        })
        .catch(() => {
          /* router offline: status ditangani polling utama */
        })
        .finally(() => this.trafficBusy.delete(routerId));
    }
  }

  housekeeping() {
    const days = this.settings.get().monitor.retentionDays;
    this.db.run('DELETE FROM metrics WHERE ts < ?', [Date.now() - days * 86400_000]);
    this.db.run('DELETE FROM alerts WHERE created_at < ?', [new Date(Date.now() - 90 * 86400_000).toISOString()]);
  }

  metrics(routerId: number, range: string) {
    const ranges: Record<string, number> = { '1h': 3600, '6h': 6 * 3600, '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };
    const secs = ranges[range] ?? 86400;
    const since = Date.now() - secs * 1000;
    // kelompokkan agar maksimal ~300 titik
    const bucket = Math.max(60_000, Math.ceil((secs * 1000) / 300 / 60_000) * 60_000);
    return this.db.all(
      `SELECT (ts / ?) * ? AS ts, AVG(cpu) AS cpu, AVG(mem_used) AS mem_used, MAX(mem_total) AS mem_total,
              AVG(hotspot_active) AS hotspot_active, AVG(ppp_active) AS ppp_active, AVG(rx_bps) AS rx_bps,
              AVG(tx_bps) AS tx_bps, AVG(temperature) AS temperature, AVG(voltage) AS voltage
       FROM metrics WHERE router_id = ? AND ts >= ? GROUP BY ts / ? ORDER BY ts`,
      [bucket, bucket, routerId, since, bucket],
    );
  }
}
