import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { formatDuration, parseDuration } from '../duration.js';
import { RouterOSError, type RosParams, type RosRow, type RouterConnection } from './types.js';
import { formatValue } from './protocol.js';

/**
 * Router MikroTik virtual. Meniru perilaku RouterOS API (print/add/set/remove/enable/disable,
 * monitor-traffic, hotspot active, log, dll) lengkap dengan trafik & pengguna hotspot yang
 * bergerak dinamis. Dipakai untuk demo, pengembangan, dan pengujian otomatis.
 */

type Item = Record<string, string>;

interface SimState {
  nextId: number;
  bootAt: number;
  tables: Record<string, Item[]>;
  singletons: Record<string, Item>;
  logs: Item[];
  ifaceRate: Record<string, { rx: number; tx: number; base: number }>;
  counters: Record<string, { rx: number; tx: number }>;
  cpu: number;
}

const stores = new Map<string, SimStore>();

class SimStore {
  state: SimState;
  lastTick = Date.now();
  dirty = false;
  private timer?: NodeJS.Timeout;

  constructor(
    readonly key: string,
    readonly identity: string,
    private readonly file?: string,
  ) {
    this.state = this.load() ?? createInitialState(identity);
    if (this.file) {
      this.timer = setInterval(() => this.save(), 5000);
      this.timer.unref();
    }
  }

  private load(): SimState | undefined {
    if (!this.file || !fs.existsSync(this.file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as SimState;
    } catch {
      return undefined;
    }
  }

  save() {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state));
  }
}

export function getSimStore(key: string, identity: string, dataDir?: string) {
  let store = stores.get(key);
  if (!store) {
    store = new SimStore(key, identity, dataDir ? path.join(dataDir, 'simulator', `router-${key}.json`) : undefined);
    stores.set(key, store);
  }
  return store;
}

export function resetSimStores() {
  stores.clear();
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function normBool(v: string): string {
  if (v === 'yes') return 'true';
  if (v === 'no') return 'false';
  return v;
}

function macAddr() {
  return Array.from({ length: 6 }, (_, i) => (i === 0 ? 0x02 | (randInt(0, 255) & 0xfc) : randInt(0, 255)).toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase();
}

function nowClock() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function createInitialState(identity: string): SimState {
  let id = 1;
  const nid = () => `*${(id++).toString(16).toUpperCase()}`;
  const mk = (rows: Item[]): Item[] => rows.map((r) => ({ '.id': nid(), disabled: 'false', comment: '', ...r }));

  const interfaces = mk([
    { name: 'ether1-WAN', type: 'ether', mtu: '1500', running: 'true', 'mac-address': macAddr(), comment: 'Uplink ISP' },
    { name: 'ether2-LAN', type: 'ether', mtu: '1500', running: 'true', 'mac-address': macAddr() },
    { name: 'ether3', type: 'ether', mtu: '1500', running: 'true', 'mac-address': macAddr() },
    { name: 'ether4', type: 'ether', mtu: '1500', running: 'false', 'mac-address': macAddr() },
    { name: 'ether5', type: 'ether', mtu: '1500', running: 'false', 'mac-address': macAddr(), disabled: 'true' },
    { name: 'wlan1', type: 'wlan', mtu: '1500', running: 'true', 'mac-address': macAddr(), comment: 'AP Hotspot' },
    { name: 'bridge-hotspot', type: 'bridge', mtu: '1500', running: 'true', 'mac-address': macAddr() },
  ]);

  const hsUsers: Item[] = mk(
    ['budi', 'siti', 'andi', 'rina', 'dewi'].map((n, i) => ({
      name: n,
      password: `${n}123`,
      profile: i % 2 ? '1HARI' : '1BULAN',
      server: 'all',
      uptime: formatDuration(randInt(600, 90000)),
      'bytes-in': String(randInt(50e6, 900e6)),
      'bytes-out': String(randInt(500e6, 9e9)),
      'limit-uptime': '',
      'limit-bytes-total': '0',
      comment: 'member',
    })),
  );

  const tables: Record<string, Item[]> = {
    '/interface': interfaces,
    '/interface/bridge': mk([{ name: 'bridge-hotspot', 'protocol-mode': 'rstp', mtu: 'auto' }]),
    '/interface/bridge/port': mk([
      { interface: 'ether3', bridge: 'bridge-hotspot' },
      { interface: 'wlan1', bridge: 'bridge-hotspot' },
    ]),
    '/interface/vlan': mk([]),
    '/ip/address': mk([
      { address: '192.168.1.2/24', network: '192.168.1.0', interface: 'ether1-WAN', dynamic: 'false' },
      { address: '192.168.88.1/24', network: '192.168.88.0', interface: 'ether2-LAN', dynamic: 'false' },
      { address: '10.5.50.1/24', network: '10.5.50.0', interface: 'bridge-hotspot', dynamic: 'false', comment: 'hotspot network' },
    ]),
    '/ip/route': mk([
      { 'dst-address': '0.0.0.0/0', gateway: '192.168.1.1', distance: '1', active: 'true', static: 'true' },
      { 'dst-address': '10.5.50.0/24', gateway: 'bridge-hotspot', distance: '0', active: 'true', dynamic: 'true', connect: 'true' },
    ]),
    '/ip/pool': mk([
      { name: 'hs-pool', ranges: '10.5.50.2-10.5.50.254' },
      { name: 'dhcp-lan', ranges: '192.168.88.10-192.168.88.254' },
    ]),
    '/ip/dhcp-server': mk([
      { name: 'dhcp-hotspot', interface: 'bridge-hotspot', 'address-pool': 'hs-pool', 'lease-time': '1h' },
      { name: 'dhcp-lan', interface: 'ether2-LAN', 'address-pool': 'dhcp-lan', 'lease-time': '1d' },
    ]),
    '/ip/dhcp-server/lease': mk(
      Array.from({ length: 8 }, (_, i) => ({
        address: i < 5 ? `10.5.50.${20 + i}` : `192.168.88.${50 + i}`,
        'mac-address': macAddr(),
        'host-name': pick(['android-hp', 'iPhone', 'LAPTOP-KANTOR', 'Redmi-Note', 'DESKTOP-01', 'Galaxy-A54', 'OPPO-A78', 'printer']),
        server: i < 5 ? 'dhcp-hotspot' : 'dhcp-lan',
        status: 'bound',
        dynamic: 'true',
        'expires-after': formatDuration(randInt(300, 3500)),
      })),
    ),
    '/ip/dns/static': mk([{ name: 'hotspot.lan', address: '10.5.50.1', ttl: '1d' }]),
    '/ip/firewall/filter': mk([
      { chain: 'input', action: 'accept', 'connection-state': 'established,related', comment: 'accept established' },
      { chain: 'input', action: 'drop', 'connection-state': 'invalid', comment: 'drop invalid' },
      { chain: 'input', action: 'accept', protocol: 'icmp', comment: 'accept ICMP' },
      { chain: 'input', action: 'accept', 'in-interface': 'ether2-LAN', comment: 'allow LAN' },
      { chain: 'input', action: 'drop', 'in-interface': 'ether1-WAN', comment: 'drop dari WAN' },
      { chain: 'forward', action: 'fasttrack-connection', 'connection-state': 'established,related', comment: 'fasttrack' },
      { chain: 'forward', action: 'drop', 'connection-state': 'invalid', comment: 'drop invalid' },
    ]).map((r) => ({ ...r, bytes: String(randInt(1e5, 9e8)), packets: String(randInt(1e3, 9e6)) })),
    '/ip/firewall/nat': mk([
      { chain: 'srcnat', action: 'masquerade', 'out-interface': 'ether1-WAN', comment: 'masquerade internet' },
      { chain: 'dstnat', action: 'dst-nat', protocol: 'tcp', 'dst-port': '8080', 'to-addresses': '192.168.88.10', 'to-ports': '80', comment: 'port forward CCTV', disabled: 'true' },
    ]),
    '/ip/firewall/mangle': mk([]),
    '/ip/firewall/address-list': mk([
      { list: 'blacklist', address: '203.0.113.5', comment: 'brute force' },
      { list: 'vip', address: '10.5.50.20', comment: 'owner' },
    ]),
    '/queue/simple': mk([
      { name: 'total-hotspot', target: '10.5.50.0/24', 'max-limit': '50M/50M', comment: 'limit total hotspot' },
      { name: 'cctv', target: '192.168.88.10/32', 'max-limit': '5M/5M' },
    ]),
    '/queue/type': mk([{ name: 'pcq-download', kind: 'pcq', 'pcq-classifier': 'dst-address', 'pcq-rate': '0' }]),
    '/ppp/profile': mk([
      { name: 'default', 'local-address': '', 'remote-address': '', 'rate-limit': '' },
      { name: 'PPPoE-10M', 'local-address': '172.16.0.1', 'remote-address': 'pppoe-pool', 'rate-limit': '10M/10M' },
      { name: 'PPPoE-20M', 'local-address': '172.16.0.1', 'remote-address': 'pppoe-pool', 'rate-limit': '20M/20M' },
    ]),
    '/ppp/secret': mk([
      { name: 'pelanggan01', password: 'rahasia01', service: 'pppoe', profile: 'PPPoE-10M', 'remote-address': '', comment: 'Pak Joko' },
      { name: 'pelanggan02', password: 'rahasia02', service: 'pppoe', profile: 'PPPoE-20M', 'remote-address': '', comment: 'Bu Ani' },
      { name: 'pelanggan03', password: 'rahasia03', service: 'pppoe', profile: 'PPPoE-10M', 'remote-address': '', comment: 'Warung Kopi', disabled: 'true' },
    ]),
    '/ppp/active': mk([
      { name: 'pelanggan01', service: 'pppoe', address: '172.16.0.10', 'caller-id': macAddr(), uptime: formatDuration(randInt(3600, 400000)), encoding: '' },
      { name: 'pelanggan02', service: 'pppoe', address: '172.16.0.11', 'caller-id': macAddr(), uptime: formatDuration(randInt(3600, 400000)), encoding: '' },
    ]),
    '/interface/pppoe-server/server': mk([{ 'service-name': 'pppoe-svc', interface: 'ether2-LAN', 'default-profile': 'PPPoE-10M' }]),
    '/ip/hotspot': mk([{ name: 'hotspot1', interface: 'bridge-hotspot', 'address-pool': 'hs-pool', profile: 'hsprof1', 'addresses-per-mac': '2' }]),
    '/ip/hotspot/profile': mk([
      { name: 'default', 'hotspot-address': '', 'dns-name': '', 'login-by': 'cookie,http-chap' },
      { name: 'hsprof1', 'hotspot-address': '10.5.50.1', 'dns-name': 'hotspot.lan', 'login-by': 'cookie,http-chap,http-pap', 'html-directory': 'hotspot' },
    ]),
    '/ip/hotspot/user/profile': mk([
      { name: 'default', 'rate-limit': '', 'shared-users': '1', 'session-timeout': '', 'keepalive-timeout': '2m', 'address-pool': 'none' },
      { name: '1JAM', 'rate-limit': '2M/2M', 'shared-users': '1', 'session-timeout': '', 'keepalive-timeout': '2m', 'address-pool': 'none' },
      { name: '1HARI', 'rate-limit': '5M/5M', 'shared-users': '1', 'session-timeout': '', 'keepalive-timeout': '2m', 'address-pool': 'none' },
      { name: '1MINGGU', 'rate-limit': '8M/8M', 'shared-users': '2', 'session-timeout': '', 'keepalive-timeout': '2m', 'address-pool': 'none' },
      { name: '1BULAN', 'rate-limit': '10M/10M', 'shared-users': '2', 'session-timeout': '', 'keepalive-timeout': '2m', 'address-pool': 'none' },
    ]),
    '/ip/hotspot/user': hsUsers,
    '/ip/hotspot/active': [],
    '/ip/hotspot/host': [],
    '/ip/hotspot/ip-binding': mk([
      { 'mac-address': macAddr(), address: '10.5.50.20', 'to-address': '', type: 'bypassed', comment: 'HP Owner' },
      { 'mac-address': macAddr(), address: '', 'to-address': '', type: 'blocked', comment: 'perangkat diblokir' },
    ]),
    '/ip/hotspot/walled-garden': mk([
      { 'dst-host': '*.whatsapp.net', action: 'allow', comment: 'akses WA tanpa login' },
      { 'dst-host': 'wa.me', action: 'allow', comment: '' },
    ]),
    '/ip/hotspot/walled-garden/ip': mk([]),
    '/ip/hotspot/cookie': [],
    '/system/scheduler': mk([
      { name: 'reboot-mingguan', 'start-date': 'jan/01/2025', 'start-time': '04:00:00', interval: '1w', 'on-event': '/system reboot', disabled: 'true' },
    ]),
    '/system/script': mk([{ name: 'backup-harian', source: '/system backup save name=auto', policy: 'read,write,policy,test' }]),
    '/user': mk([
      { name: 'admin', group: 'full', address: '', 'last-logged-in': 'nov/14/2026 08:00:00' },
      { name: 'mikrotal', group: 'full', address: '', 'last-logged-in': '' },
    ]),
    '/user/group': mk([
      { name: 'read', policy: 'local,telnet,ssh,read,test,winbox,web,api' },
      { name: 'write', policy: 'local,telnet,ssh,read,write,test,winbox,web,api' },
      { name: 'full', policy: 'local,telnet,ssh,ftp,reboot,read,write,policy,test,winbox,web,sniff,api' },
    ]),
    '/ip/service': mk([
      { name: 'telnet', port: '23', address: '', disabled: 'true' },
      { name: 'ftp', port: '21', address: '', disabled: 'true' },
      { name: 'www', port: '80', address: '' },
      { name: 'ssh', port: '22', address: '' },
      { name: 'www-ssl', port: '443', address: '', disabled: 'true' },
      { name: 'api', port: '8728', address: '' },
      { name: 'winbox', port: '8291', address: '' },
      { name: 'api-ssl', port: '8729', address: '' },
    ]),
    '/ip/arp': mk(
      Array.from({ length: 5 }, (_, i) => ({ address: `10.5.50.${20 + i}`, 'mac-address': macAddr(), interface: 'bridge-hotspot', dynamic: 'true' })),
    ),
    '/ip/neighbor': mk([{ interface: 'ether2-LAN', address: '192.168.88.2', identity: 'AP-Lantai2', platform: 'MikroTik', version: '7.15', board: 'hAP ac2' }]),
    '/file': mk([
      { name: 'flash', type: 'disk', size: '0', 'creation-time': 'jan/01/2025 00:00:00' },
      { name: 'flash/hotspot', type: 'directory', size: '0', 'creation-time': 'jan/01/2025 00:00:00' },
      { name: 'flash/hotspot/login.html', type: '.html file', size: '3421', 'creation-time': 'jan/01/2025 00:00:00' },
    ]),
  };

  const singletons: Record<string, Item> = {
    '/system/identity': { name: identity },
    '/system/routerboard': {
      routerboard: 'true',
      model: 'RB4011iGS+',
      'serial-number': 'HG' + randInt(100000000, 999999999),
      'firmware-type': 'al2',
      'factory-firmware': '6.45.9',
      'current-firmware': '7.16.1',
      'upgrade-firmware': '7.16.1',
    },
    '/system/clock': { 'time-zone-name': 'Asia/Jakarta', 'time-zone-autodetect': 'true' },
    '/ip/dns': { servers: '8.8.8.8,1.1.1.1', 'dynamic-servers': '192.168.1.1', 'allow-remote-requests': 'true', 'cache-size': '2048KiB', 'cache-used': '312KiB' },
    '/system/ntp/client': { enabled: 'true', servers: 'id.pool.ntp.org', status: 'synchronized' },
    '/ip/cloud': { 'ddns-enabled': 'false', 'public-address': '' },
    '/snmp': { enabled: 'false', contact: '', location: '' },
  };

  const ifaceRate: SimState['ifaceRate'] = {};
  const counters: SimState['counters'] = {};
  for (const i of interfaces) {
    const base = i.name.includes('WAN') ? 28e6 : i.type === 'bridge' ? 22e6 : i.type === 'wlan' ? 15e6 : i.running === 'true' ? 3e6 : 0;
    ifaceRate[i.name] = { rx: base * 0.9, tx: base * 0.2, base };
    counters[i.name] = { rx: randInt(1e9, 9e11), tx: randInt(1e8, 9e10) };
  }

  const logs: Item[] = [];
  const now = Date.now();
  const seedLogs: [string, string][] = [
    ['system,info', 'router rebooted'],
    ['interface,info', 'ether1-WAN link up (speed 1G, full duplex)'],
    ['dhcp,info', 'dhcp-hotspot assigned 10.5.50.21 to ' + macAddr()],
    ['hotspot,account,info', 'budi (10.5.50.21): logged in'],
    ['system,info,account', 'user admin logged in from 192.168.88.2 via winbox'],
    ['hotspot,info,debug', 'siti (10.5.50.22): trying to log in by http-chap'],
    ['firewall,info', 'input: in:ether1-WAN out:(unknown 0), proto TCP (SYN), 203.0.113.5:51234->192.168.1.2:22'],
  ];
  seedLogs.forEach(([topics, message], i) => {
    logs.push({ '.id': nid(), time: new Date(now - (seedLogs.length - i) * 60000).toTimeString().slice(0, 8), topics, message });
  });

  return { nextId: id, bootAt: now - randInt(2, 30) * 86400000, tables, singletons, logs, ifaceRate, counters, cpu: 12 };
}

export class SimulatedRouter extends EventEmitter implements RouterConnection {
  /** Matikan login/logout acak (untuk pengujian deterministik). */
  static autoActivity = true;
  private _connected = false;
  private store: SimStore;

  constructor(
    key: string,
    identity: string,
    private readonly opts: { dataDir?: string; username?: string; password?: string; failLogin?: boolean } = {},
  ) {
    super();
    this.store = getSimStore(key, identity, opts.dataDir);
  }

  get connected() {
    return this._connected;
  }

  private get s() {
    return this.store.state;
  }

  async connect() {
    await new Promise((r) => setTimeout(r, 5));
    if (this.opts.failLogin) throw new RouterOSError('invalid user name or password (6)');
    this._connected = true;
    this.log('system,info,account', `user ${this.opts.username ?? 'admin'} logged in via api`);
  }

  close() {
    if (!this._connected) return;
    this._connected = false;
    this.store.save();
    this.emit('close');
  }

  /** Untuk pengujian: paksa sesi hotspot login sekarang. */
  simulateLogin(username: string) {
    const user = this.table('/ip/hotspot/user').find((u) => u.name === username);
    if (user) this.login(user);
  }

  private table(p: string) {
    if (!this.s.tables[p]) this.s.tables[p] = [];
    return this.s.tables[p];
  }

  private newId() {
    return `*${(this.s.nextId++).toString(16).toUpperCase()}`;
  }

  private log(topics: string, message: string) {
    this.s.logs.push({ '.id': this.newId(), time: nowClock(), topics, message });
    if (this.s.logs.length > 500) this.s.logs.splice(0, this.s.logs.length - 500);
  }

  private tick() {
    const now = Date.now();
    const dt = Math.min((now - this.store.lastTick) / 1000, 3600);
    this.store.lastTick = now;
    if (dt <= 0) return;
    this.store.dirty = true;

    // CPU random walk
    this.s.cpu = Math.max(2, Math.min(97, this.s.cpu + rand(-6, 6) + (Math.random() < 0.02 ? 30 : 0) - (this.s.cpu > 60 ? 8 : 0)));

    // Trafik interface
    const ifaces = this.table('/interface');
    const activeCount = this.table('/ip/hotspot/active').length;
    for (const i of ifaces) {
      const r = (this.s.ifaceRate[i.name] ??= { rx: 0, tx: 0, base: 2e6 });
      const c = (this.s.counters[i.name] ??= { rx: 0, tx: 0 });
      if (i.running !== 'true' || i.disabled === 'true') {
        r.rx = 0;
        r.tx = 0;
        continue;
      }
      const load = 0.5 + activeCount / 15;
      const target = r.base * load;
      r.rx = Math.max(1000, r.rx + (target - r.rx) * 0.3 + rand(-0.25, 0.25) * r.base);
      r.tx = Math.max(500, r.tx + (target * 0.25 - r.tx) * 0.3 + rand(-0.08, 0.08) * r.base);
      c.rx += (r.rx / 8) * dt;
      c.tx += (r.tx / 8) * dt;
    }

    // Sesi hotspot aktif
    const active = this.table('/ip/hotspot/active');
    const users = this.table('/ip/hotspot/user');
    for (const a of [...active]) {
      const user = users.find((u) => u.name === a.user);
      const rxB = Math.floor(rand(20e3, 400e3) * dt);
      const txB = Math.floor(rand(5e3, 60e3) * dt);
      a.uptime = formatDuration(parseDuration(a.uptime) + dt);
      a['bytes-in'] = String(Number(a['bytes-in']) + txB);
      a['bytes-out'] = String(Number(a['bytes-out']) + rxB);
      if (!user) {
        this.logout(a, 'user removed');
        continue;
      }
      user.uptime = formatDuration(parseDuration(user.uptime) + dt);
      user['bytes-in'] = String(Number(user['bytes-in'] || 0) + txB);
      user['bytes-out'] = String(Number(user['bytes-out'] || 0) + rxB);
      const limit = parseDuration(user['limit-uptime']);
      const limitBytes = Number(user['limit-bytes-total'] || 0);
      const total = Number(user['bytes-in']) + Number(user['bytes-out']);
      if (user.disabled === 'true') this.logout(a, 'user disabled');
      else if (limit > 0 && parseDuration(user.uptime) >= limit) this.logout(a, 'uptime limit reached');
      else if (limitBytes > 0 && total >= limitBytes) this.logout(a, 'traffic limit reached');
      else if (SimulatedRouter.autoActivity && Math.random() < dt / 900) this.logout(a, 'keepalive timeout');
    }

    // Login baru: utamakan voucher yang belum dipakai
    const maxActive = 25;
    if (SimulatedRouter.autoActivity && active.length < maxActive) {
      const loginChance = dt / 25;
      let n = Math.floor(loginChance) + (Math.random() < loginChance % 1 ? 1 : 0);
      while (n-- > 0 && active.length < maxActive) {
        const candidates = users.filter((u) => {
          if (u.disabled === 'true' || active.some((a) => a.user === u.name)) return false;
          const limit = parseDuration(u['limit-uptime']);
          if (limit > 0 && parseDuration(u.uptime) >= limit) return false;
          return true;
        });
        if (!candidates.length) break;
        const fresh = candidates.filter((u) => parseDuration(u.uptime) === 0);
        const user = fresh.length && Math.random() < 0.7 ? pick(fresh) : pick(candidates);
        this.login(user);
      }
    }
  }

  private login(user: Item) {
    const active = this.table('/ip/hotspot/active');
    if (active.some((a) => a.user === user.name)) return;
    const ip = `10.5.50.${randInt(30, 250)}`;
    const mac = macAddr();
    active.push({
      '.id': this.newId(),
      server: 'hotspot1',
      user: user.name,
      address: ip,
      'mac-address': mac,
      'login-by': 'http-chap',
      uptime: '0s',
      'idle-time': '0s',
      'session-time-left': user['limit-uptime'] ? formatDuration(Math.max(0, parseDuration(user['limit-uptime']) - parseDuration(user.uptime))) : '',
      'bytes-in': '0',
      'bytes-out': '0',
      radius: 'false',
      comment: '',
    });
    const hosts = this.table('/ip/hotspot/host');
    hosts.push({ '.id': this.newId(), 'mac-address': mac, address: ip, 'to-address': ip, server: 'hotspot1', authorized: 'true', bypassed: 'false', 'idle-time': '0s', uptime: '0s', comment: '' });
    if (hosts.length > 60) hosts.splice(0, hosts.length - 60);
    this.log('hotspot,account,info,debug', `${user.name} (${ip}): logged in`);
  }

  private logout(a: Item, reason: string) {
    const active = this.table('/ip/hotspot/active');
    const idx = active.indexOf(a);
    if (idx >= 0) active.splice(idx, 1);
    this.log('hotspot,account,info,debug', `${a.user} (${a.address}): logged out: ${reason}`);
  }

  private computeResource(): Item {
    const total = 1024 * 1024 * 1024;
    const used = Math.floor(total * (0.18 + this.table('/ip/hotspot/active').length * 0.004 + Math.random() * 0.02));
    const hddTotal = 512 * 1024 * 1024;
    return {
      uptime: formatDuration((Date.now() - this.s.bootAt) / 1000),
      version: '7.16.1 (stable)',
      'build-time': '2024-10-10 14:03:32',
      'factory-software': '6.45.9',
      'free-memory': String(total - used),
      'total-memory': String(total),
      cpu: 'ARMv7',
      'cpu-count': '4',
      'cpu-frequency': '1400',
      'cpu-load': String(Math.round(this.s.cpu)),
      'free-hdd-space': String(Math.floor(hddTotal * 0.71)),
      'total-hdd-space': String(hddTotal),
      'architecture-name': 'arm',
      'board-name': 'RB4011iGS+',
      platform: 'MikroTik',
    };
  }

  private findItems(rows: Item[], ref: string | undefined): Item[] {
    if (!ref) throw new RouterOSError('no such item');
    const refs = ref.split(',').map((r) => r.trim());
    const found = rows.filter((r) => refs.includes(r['.id']) || refs.includes(r.name));
    if (!found.length) throw new RouterOSError('no such item');
    return found;
  }

  private applyParams(item: Item, params: RosParams) {
    for (const [k, v] of Object.entries(params)) {
      if (k === '.id' || k === 'numbers' || v === undefined) continue;
      item[k] = normBool(formatValue(v));
    }
  }

  private filterRows(rows: Item[], params: RosParams, queries: string[]): RosRow[] {
    let out = rows;
    for (const q of queries) {
      const body = q.replace(/^\?/, '');
      if (body.startsWith('#')) continue;
      if (body.startsWith('-')) {
        const key = body.slice(1);
        out = out.filter((r) => r[key] === undefined || r[key] === '');
        continue;
      }
      const eq = body.indexOf('=');
      if (eq === -1) {
        out = out.filter((r) => r[body] !== undefined && r[body] !== '');
      } else {
        const key = body.slice(0, eq);
        const val = normBool(body.slice(eq + 1));
        out = out.filter((r) => (r[key] ?? '') === val);
      }
    }
    if (params['count-only'] !== undefined) return [{ ret: String(out.length) }];
    const proplist = params['.proplist'] ? String(params['.proplist']).split(',') : undefined;
    return out.map((r) => {
      const copy: RosRow = {};
      for (const [k, v] of Object.entries(r)) {
        if (v === '' && k !== 'comment' && k !== 'name') continue;
        if (!proplist || proplist.includes(k)) copy[k] = v;
      }
      return copy;
    });
  }

  async exec(command: string, params: RosParams = {}, queries: string[] = []): Promise<RosRow[]> {
    if (!this._connected && command !== '/login') throw new RouterOSError('not logged in');
    this.tick();
    const cmd = command.replace(/\s+/g, '/').replace(/\/+$/, '');
    const idx = cmd.lastIndexOf('/');
    const base = cmd.slice(0, idx);
    const action = cmd.slice(idx + 1);

    // Perintah khusus
    switch (cmd) {
      case '/quit':
        return [];
      case '/system/resource/print':
        return this.filterRows([this.computeResource()], params, []);
      case '/system/resource/cpu/print':
        return Array.from({ length: 4 }, (_, i) => ({ '.id': `*${i}`, cpu: `cpu${i}`, load: String(Math.max(0, Math.round(this.s.cpu + rand(-10, 10)))) }));
      case '/system/health/print':
        return [
          { '.id': '*1', name: 'voltage', value: (24 + rand(-0.3, 0.3)).toFixed(1), type: 'V' },
          { '.id': '*2', name: 'temperature', value: String(Math.round(38 + this.s.cpu / 8 + rand(-1, 1))), type: 'C' },
          { '.id': '*3', name: 'cpu-temperature', value: String(Math.round(45 + this.s.cpu / 5 + rand(-1, 1))), type: 'C' },
        ];
      case '/system/clock/print': {
        const d = new Date();
        const mon = d.toLocaleString('en-US', { month: 'short' }).toLowerCase();
        return [{ ...this.s.singletons['/system/clock'], time: d.toTimeString().slice(0, 8), date: `${mon}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}` }];
      }
      case '/interface/monitor-traffic': {
        const names = String(params.interface ?? '').split(',').filter(Boolean);
        return names.map((name) => {
          const iface = this.table('/interface').find((i) => i.name === name);
          if (!iface) throw new RouterOSError(`no such item (${name})`);
          const r = this.s.ifaceRate[name] ?? { rx: 0, tx: 0 };
          return {
            name,
            'rx-bits-per-second': String(Math.round(r.rx)),
            'tx-bits-per-second': String(Math.round(r.tx)),
            'rx-packets-per-second': String(Math.round(r.rx / 8 / 900)),
            'tx-packets-per-second': String(Math.round(r.tx / 8 / 600)),
          };
        });
      }
      case '/interface/print': {
        const rows = this.table('/interface').map((i) => ({
          ...i,
          'rx-byte': String(Math.floor(this.s.counters[i.name]?.rx ?? 0)),
          'tx-byte': String(Math.floor(this.s.counters[i.name]?.tx ?? 0)),
        }));
        return this.filterRows(rows, params, queries);
      }
      case '/log/print': {
        return this.filterRows(this.s.logs, params, queries);
      }
      case '/system/reboot': {
        this.s.bootAt = Date.now();
        this.s.tables['/ip/hotspot/active'] = [];
        this.log('system,info', 'router rebooted by api');
        return [];
      }
      case '/system/backup/save': {
        const name = String(params.name || `backup-${Date.now()}`);
        this.table('/file').push({ '.id': this.newId(), name: `${name}.backup`, type: 'backup', size: String(randInt(30000, 90000)), 'creation-time': new Date().toISOString() });
        this.log('system,info', `configuration backup saved: ${name}.backup`);
        return [];
      }
      case '/export': {
        const file = String(params.file || `export-${Date.now()}`);
        this.table('/file').push({ '.id': this.newId(), name: `${file}.rsc`, type: 'script', size: String(randInt(8000, 25000)), 'creation-time': new Date().toISOString() });
        return [];
      }
      case '/ping': {
        const count = Math.min(Number(params.count ?? 4), 20);
        const host = String(params.address ?? '');
        if (!host) throw new RouterOSError('missing value for address');
        return Array.from({ length: count }, (_, i) => ({
          seq: String(i),
          host,
          size: '56',
          ttl: '57',
          time: `${randInt(8, 40)}ms`,
          sent: String(i + 1),
          received: String(i + 1),
          'packet-loss': '0',
        }));
      }
      case '/system/script/run': {
        const s = this.findItems(this.table('/system/script'), String(params['.id'] ?? params.number ?? ''));
        this.log('script,info', `script ${s[0].name} executed`);
        return [];
      }
      case '/ip/hotspot/user/reset-counters': {
        for (const u of this.findItems(this.table('/ip/hotspot/user'), String(params['.id'] ?? params.numbers ?? ''))) {
          u.uptime = '0s';
          u['bytes-in'] = '0';
          u['bytes-out'] = '0';
        }
        return [];
      }
    }

    // Singleton (print / set)
    if (this.s.singletons[base]) {
      if (action === 'print') return this.filterRows([this.s.singletons[base]], params, []);
      if (action === 'set') {
        this.applyParams(this.s.singletons[base], params);
        this.store.dirty = true;
        return [];
      }
    }

    const rows = this.s.tables[base];
    if (!rows) throw new RouterOSError(`no such command prefix`, undefined, command);

    switch (action) {
      case 'print':
        return this.filterRows(rows, params, queries);
      case 'getall':
        return this.filterRows(rows, params, queries);
      case 'add': {
        const uniqueByName = ['/ip/hotspot/user', '/ip/hotspot/user/profile', '/ppp/secret', '/ppp/profile', '/queue/simple', '/ip/pool', '/system/scheduler', '/system/script', '/user', '/interface/bridge', '/interface/vlan'];
        if (uniqueByName.includes(base) && params.name && rows.some((r) => r.name === String(params.name))) {
          throw new RouterOSError('failure: already have user with this name');
        }
        const item: Item = { '.id': this.newId(), disabled: 'false', comment: '' };
        if (base === '/ip/hotspot/user') Object.assign(item, { profile: 'default', server: 'all', uptime: '0s', 'bytes-in': '0', 'bytes-out': '0', 'limit-uptime': '', 'limit-bytes-total': '0' });
        if (base === '/interface/vlan') Object.assign(item, { type: 'vlan', running: 'true', mtu: '1500' });
        this.applyParams(item, params);
        rows.push(item);
        if (base === '/interface/vlan') {
          this.table('/interface').push({ '.id': this.newId(), name: item.name, type: 'vlan', mtu: '1500', running: 'true', disabled: 'false', comment: item.comment ?? '', 'mac-address': macAddr() });
        }
        this.store.dirty = true;
        return [{ ret: item['.id'] }];
      }
      case 'set': {
        for (const item of this.findItems(rows, String(params['.id'] ?? params.numbers ?? ''))) {
          const oldName = item.name;
          this.applyParams(item, params);
          if (base === '/interface' && oldName && item.name !== oldName) {
            this.s.ifaceRate[item.name] = this.s.ifaceRate[oldName];
            this.s.counters[item.name] = this.s.counters[oldName];
          }
        }
        this.store.dirty = true;
        return [];
      }
      case 'remove': {
        const targets = this.findItems(rows, String(params['.id'] ?? params.numbers ?? ''));
        for (const t of targets) {
          if (base === '/ip/hotspot/active') this.log('hotspot,account,info,debug', `${t.user} (${t.address}): logged out: admin reset`);
          rows.splice(rows.indexOf(t), 1);
        }
        this.store.dirty = true;
        return [];
      }
      case 'enable':
      case 'disable': {
        for (const item of this.findItems(rows, String(params['.id'] ?? params.numbers ?? ''))) {
          item.disabled = action === 'disable' ? 'true' : 'false';
          if (base === '/interface') this.log('interface,info', `${item.name} ${action === 'disable' ? 'disabled' : 'enabled'}`);
        }
        this.store.dirty = true;
        return [];
      }
      default:
        throw new RouterOSError(`no such command or directory (${action})`, undefined, command);
    }
  }
}
