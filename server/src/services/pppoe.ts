import type { DB } from '../db/index.js';
import { parseDuration } from '../lib/duration.js';
import type { RosRow } from '../lib/routeros/types.js';
import type { AlertService, Hub } from './alerts.js';
import { diagnose, type Diagnosis } from './diagnosis.js';
import type { RouterManager } from './routers.js';
import type { SettingsService } from './settings.js';
import { generateCodes, HttpError, randomCode } from './vouchers.js';

export type CustomerStatus = 'active' | 'isolated' | 'disabled';

export interface CustomerRow {
  id: number;
  router_id: number;
  name: string;
  phone: string;
  address: string;
  username: string;
  password: string;
  package_id: number | null;
  profile: string;
  odp_id: number | null;
  odp_port: number | null;
  lat: number | null;
  lng: number | null;
  status: CustomerStatus;
  expires_at: string | null;
  online: number;
  on_router: number;
  ip: string;
  mac: string;
  uptime_seconds: number;
  last_seen_at: string | null;
  note: string;
  created_at: string;
}

export interface PackageRow {
  id: number;
  router_id: number;
  name: string;
  profile: string;
  price: number;
  reseller_price: number;
  validity: string;
  active: number;
  created_at: string;
}

export interface PppVoucherRow {
  id: number;
  batch_id: number | null;
  router_id: number;
  code: string;
  package_id: number | null;
  package_name: string;
  price: number;
  validity: string;
  status: 'unused' | 'used';
  reseller_id: number | null;
  customer_id: number | null;
  customer_name: string;
  used_at: string | null;
  created_at: string;
}

export interface CustomerInput {
  routerId: number;
  name: string;
  phone?: string;
  address?: string;
  username: string;
  password: string;
  packageId?: number | null;
  odpId?: number | null;
  odpPort?: number | null;
  lat?: number | null;
  lng?: number | null;
  /** Masa aktif awal, mis. "30d". Kosong = langsung terisolir sampai diisi voucher. */
  initialValidity?: string;
  /** true = tanpa batas masa aktif (mis. akun kantor). */
  unlimited?: boolean;
  note?: string;
}

export const PPP_COMMENT_PREFIX = 'MIKROTAL';
export const ISOLIR_COMMENT = 'MIKROTAL-ISOLIR';
/** Karakter voucher PPPoE dibatasi agar mudah diketik pelanggan. */
export const PPP_VOUCHER_CHARSETS = ['numeric', 'alnum-upper'] as const;

export function normalizeVoucherCode(input: string) {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

const SECRET_PROPS = '.id,name,profile,disabled';
const ACTIVE_PROPS = '.id,name,address,caller-id,uptime';

export class PppoeService {
  private syncing = new Set<number>();
  private timer?: NodeJS.Timeout;
  /** Gangguan jalur (feeder/distribusi/server) yang sedang aktif dan sudah diberitahukan. */
  private activeFaults = new Map<number, Map<string, string>>();

  constructor(
    private readonly db: DB,
    private readonly routers: RouterManager,
    private readonly settings: SettingsService,
    private readonly hub: Hub,
    private readonly alerts: AlertService,
    private readonly log: { warn: (...a: any[]) => void } = console,
  ) {}

  start() {
    const loop = async () => {
      for (const r of this.routers.list().filter((x) => x.enabled)) {
        await this.sync(r.id).catch(() => undefined);
      }
      this.timer = setTimeout(loop, Math.max(15, this.settings.get().voucher.syncSeconds) * 1000);
    };
    this.timer = setTimeout(loop, 7000);
  }

  stop() {
    clearTimeout(this.timer);
  }

  private get isolirProfile() {
    return this.settings.get().pppoe.isolirProfile || 'ISOLIR';
  }

  // ---------------------------------------------------------------- Paket

  packages(routerId?: number) {
    return this.db.all<PackageRow & { customers: number }>(
      `SELECT p.*, (SELECT COUNT(*) FROM customers c WHERE c.package_id = p.id) AS customers
       FROM ppp_packages p ${routerId ? 'WHERE p.router_id = ?' : ''} ORDER BY p.price, p.name COLLATE NOCASE`,
      routerId ? [routerId] : [],
    );
  }

  requirePackage(id: number) {
    const p = this.db.get<PackageRow>('SELECT * FROM ppp_packages WHERE id = ?', [id]);
    if (!p) throw new HttpError(404, 'Paket tidak ditemukan');
    return p;
  }

  async savePackage(input: { id?: number; routerId: number; name: string; profile: string; price: number; resellerPrice: number; validity: string; active: boolean }) {
    this.routers.require(input.routerId);
    if (parseDuration(input.validity) <= 0) throw new HttpError(400, 'Masa aktif paket wajib diisi (contoh 30d)');
    if (input.profile === this.isolirProfile) throw new HttpError(400, 'Profil isolir tidak boleh dipakai sebagai paket');
    const profiles = await this.routers.exec(input.routerId, '/ppp/profile/print', { '.proplist': 'name' });
    if (!profiles.some((p) => p.name === input.profile)) throw new HttpError(400, `Profil PPP "${input.profile}" tidak ada di router`);
    const dup = this.db.get<{ id: number }>('SELECT id FROM ppp_packages WHERE router_id = ? AND name = ? AND id != ?', [input.routerId, input.name, input.id ?? 0]);
    if (dup) throw new HttpError(400, `Paket "${input.name}" sudah ada`);
    if (input.id) {
      const cur = this.requirePackage(input.id);
      this.db.run('UPDATE ppp_packages SET name = ?, profile = ?, price = ?, reseller_price = ?, validity = ?, active = ? WHERE id = ?', [
        input.name,
        input.profile,
        input.price,
        input.resellerPrice,
        input.validity,
        input.active,
        input.id,
      ]);
      if (cur.profile !== input.profile) {
        // pelanggan paket ini ikut pindah profil; router disesuaikan pada sinkronisasi
        this.db.run('UPDATE customers SET profile = ? WHERE package_id = ?', [input.profile, input.id]);
        void this.sync(cur.router_id).catch(() => undefined);
      }
      return this.requirePackage(input.id);
    }
    const { lastId } = this.db.run(
      'INSERT INTO ppp_packages (router_id, name, profile, price, reseller_price, validity, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [input.routerId, input.name, input.profile, input.price, input.resellerPrice, input.validity, input.active, new Date().toISOString()],
    );
    return this.requirePackage(lastId);
  }

  deletePackage(id: number) {
    const p = this.requirePackage(id);
    this.db.run('DELETE FROM ppp_packages WHERE id = ?', [id]);
    return p;
  }

  // ------------------------------------------------------------ Pelanggan

  requireCustomer(id: number) {
    const c = this.db.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', [id]);
    if (!c) throw new HttpError(404, 'Pelanggan tidak ditemukan');
    return c;
  }

  private checkPort(routerId: number, odpId: number | null | undefined, port: number | null | undefined, exceptCustomer = 0) {
    if (!odpId) return { odpId: null, port: null };
    const odp = this.db.get<{ id: number; router_id: number; ports: number; name: string }>('SELECT * FROM odps WHERE id = ?', [odpId]);
    if (!odp || odp.router_id !== routerId) throw new HttpError(400, 'ODP tidak ditemukan pada router ini');
    if (!port) return { odpId, port: null };
    if (port < 1 || port > odp.ports) throw new HttpError(400, `Port ${port} tidak ada. ${odp.name} hanya punya ${odp.ports} port.`);
    const used = this.db.get<{ name: string }>('SELECT name FROM customers WHERE odp_id = ? AND odp_port = ? AND id != ?', [odpId, port, exceptCustomer]);
    if (used) throw new HttpError(400, `Port ${port} di ${odp.name} sudah dipakai ${used.name}`);
    return { odpId, port };
  }

  private secretComment(c: { name: string }) {
    return `${PPP_COMMENT_PREFIX}|${c.name}`.slice(0, 120);
  }

  private async findSecret(routerId: number, username: string) {
    const rows = await this.routers.exec(routerId, '/ppp/secret/print', { '.proplist': SECRET_PROPS }, [`?name=${username}`]);
    return rows.find((r) => r.name === username);
  }

  async createCustomer(input: CustomerInput, actor: string) {
    const router = this.routers.require(input.routerId);
    const pkg = input.packageId ? this.requirePackage(input.packageId) : undefined;
    if (pkg && pkg.router_id !== router.id) throw new HttpError(400, 'Paket bukan milik router ini');
    if (this.db.get('SELECT id FROM customers WHERE router_id = ? AND username = ?', [router.id, input.username])) {
      throw new HttpError(400, `Username PPPoE "${input.username}" sudah dipakai`);
    }
    const { odpId, port } = this.checkPort(router.id, input.odpId, input.odpPort);
    const now = Date.now();
    const validSecs = parseDuration(input.initialValidity ?? '');
    const expiresAt = input.unlimited ? null : new Date(now + validSecs * 1000).toISOString();
    const status: CustomerStatus = !input.unlimited && validSecs <= 0 ? 'isolated' : 'active';
    const profile = pkg?.profile ?? 'default';
    if (status === 'isolated') await this.ensureIsolirProfile(router.id);

    const existing = await this.findSecret(router.id, input.username);
    if (existing) throw new HttpError(400, `Akun PPPoE "${input.username}" sudah ada di router. Gunakan "Impor dari router".`);
    await this.routers.exec(router.id, '/ppp/secret/add', {
      name: input.username,
      password: input.password,
      service: 'pppoe',
      profile: status === 'isolated' ? this.isolirProfile : profile,
      comment: this.secretComment(input),
    });

    const nowIso = new Date(now).toISOString();
    const { lastId } = this.db.run(
      `INSERT INTO customers (router_id, name, phone, address, username, password, package_id, profile, odp_id, odp_port, lat, lng, status, expires_at, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [router.id, input.name, input.phone ?? '', input.address ?? '', input.username, input.password, pkg?.id ?? null, profile, odpId, port, input.lat ?? null, input.lng ?? null, status, expiresAt, input.note ?? '', nowIso],
    );
    if (validSecs > 0 && !input.unlimited) {
      this.db.run(
        `INSERT INTO customer_tx (customer_id, router_id, type, package_name, amount, validity, expires_after, note, created_by, created_at)
         VALUES (?, ?, 'manual', ?, 0, ?, ?, 'Masa aktif awal', ?, ?)`,
        [lastId, router.id, pkg?.name ?? '', input.initialValidity ?? '', expiresAt, actor, nowIso],
      );
    }
    this.hub.emit('customers', { routerId: router.id });
    return this.requireCustomer(lastId);
  }

  async updateCustomer(
    id: number,
    patch: Partial<Pick<CustomerInput, 'name' | 'phone' | 'address' | 'password' | 'packageId' | 'odpId' | 'odpPort' | 'lat' | 'lng' | 'note' | 'unlimited'>> & { expiresAt?: string | null },
  ) {
    const cur = this.requireCustomer(id);
    const next = { ...cur };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.phone !== undefined) next.phone = patch.phone;
    if (patch.address !== undefined) next.address = patch.address;
    if (patch.note !== undefined) next.note = patch.note;
    if (patch.password !== undefined && patch.password !== '') next.password = patch.password;
    if (patch.packageId !== undefined) {
      const pkg = patch.packageId ? this.requirePackage(patch.packageId) : undefined;
      if (pkg && pkg.router_id !== cur.router_id) throw new HttpError(400, 'Paket bukan milik router ini');
      next.package_id = pkg?.id ?? null;
      if (pkg) next.profile = pkg.profile;
    }
    if (patch.odpId !== undefined || patch.odpPort !== undefined) {
      const r = this.checkPort(cur.router_id, patch.odpId !== undefined ? patch.odpId : cur.odp_id, patch.odpPort !== undefined ? patch.odpPort : cur.odp_port, id);
      next.odp_id = r.odpId;
      next.odp_port = r.port;
    }
    if (patch.lat !== undefined) next.lat = patch.lat;
    if (patch.lng !== undefined) next.lng = patch.lng;
    if (patch.unlimited) next.expires_at = null;
    else if (patch.expiresAt !== undefined) next.expires_at = patch.expiresAt;
    // tanggal dimajukan/dimundurkan manual: status mengikuti
    if (next.status !== 'disabled') {
      const expired = !!next.expires_at && Date.parse(next.expires_at) <= Date.now();
      if (expired && next.status === 'active') next.status = 'isolated';
      if (!expired && next.status === 'isolated' && (patch.expiresAt !== undefined || patch.unlimited)) next.status = 'active';
    }

    this.db.run(
      `UPDATE customers SET name = ?, phone = ?, address = ?, password = ?, package_id = ?, profile = ?, odp_id = ?, odp_port = ?, lat = ?, lng = ?, status = ?, expires_at = ?, note = ? WHERE id = ?`,
      [next.name, next.phone, next.address, next.password, next.package_id, next.profile, next.odp_id, next.odp_port, next.lat, next.lng, next.status, next.expires_at, next.note, id],
    );
    let routerError: string | undefined;
    try {
      const secret = await this.findSecret(cur.router_id, cur.username);
      if (secret && (next.password !== cur.password || next.name !== cur.name)) {
        await this.routers.exec(cur.router_id, '/ppp/secret/set', { '.id': secret['.id'], password: next.password, comment: this.secretComment(next) });
      }
      await this.applyState(next, secret);
    } catch (err) {
      routerError = (err as Error).message;
    }
    this.hub.emit('customers', { routerId: cur.router_id });
    return { customer: this.requireCustomer(id), routerError };
  }

  async deleteCustomer(id: number, opts: { removeFromRouter: boolean }) {
    const c = this.requireCustomer(id);
    if (opts.removeFromRouter) {
      const secret = await this.findSecret(c.router_id, c.username);
      await this.kick(c).catch(() => undefined);
      if (secret) await this.routers.exec(c.router_id, '/ppp/secret/remove', { '.id': secret['.id'] });
    }
    this.db.run('DELETE FROM customers WHERE id = ?', [id]);
    this.hub.emit('customers', { routerId: c.router_id });
    return c;
  }

  /** Putuskan sesi PPPoE aktif agar router klien menyambung ulang dengan profil terbaru. */
  async kick(c: Pick<CustomerRow, 'router_id' | 'username'>) {
    const rows = await this.routers.exec(c.router_id, '/ppp/active/print', { '.proplist': '.id,name' }, [`?name=${c.username}`]);
    const ids = rows.filter((r) => r.name === c.username).map((r) => r['.id']);
    if (ids.length) await this.routers.exec(c.router_id, '/ppp/active/remove', { '.id': ids.join(',') });
    return ids.length;
  }

  /**
   * Samakan akun di router dengan status di aplikasi:
   * aktif → profil paket, terisolir → profil isolir, nonaktif → secret disabled.
   */
  private async applyState(c: CustomerRow, secret: RosRow | undefined) {
    if (!secret) return false;
    const wantDisabled = c.status === 'disabled';
    const wantProfile = c.status === 'isolated' ? this.isolirProfile : c.profile;
    let changed = false;
    if (wantProfile && secret.profile !== wantProfile) {
      if (c.status === 'isolated') await this.ensureIsolirProfile(c.router_id);
      await this.routers.exec(c.router_id, '/ppp/secret/set', { '.id': secret['.id'], profile: wantProfile });
      changed = true;
    }
    const isDisabled = secret.disabled === 'true';
    if (wantDisabled !== isDisabled) {
      await this.routers.exec(c.router_id, wantDisabled ? '/ppp/secret/disable' : '/ppp/secret/enable', { '.id': secret['.id'] });
      changed = true;
    }
    if (changed) await this.kick(c);
    return changed;
  }

  private async applyNow(c: CustomerRow) {
    try {
      await this.applyState(c, await this.findSecret(c.router_id, c.username));
      return undefined;
    } catch (err) {
      // router sedang tidak terjangkau: sinkronisasi berikutnya akan menerapkannya
      this.log.warn({ err }, `Gagal menerapkan status PPPoE ${c.username}`);
      return (err as Error).message;
    }
  }

  private tx(c: CustomerRow, t: { type: string; voucherCode?: string; resellerId?: number | null; packageName?: string; amount?: number; validity?: string; before?: string | null; after?: string | null; note?: string; actor: string }) {
    this.db.run(
      `INSERT INTO customer_tx (customer_id, router_id, type, voucher_code, reseller_id, package_name, amount, validity, expires_before, expires_after, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.router_id, t.type, t.voucherCode ?? '', t.resellerId ?? null, t.packageName ?? '', t.amount ?? 0, t.validity ?? '', t.before ?? null, t.after ?? null, t.note ?? '', t.actor, new Date().toISOString()],
    );
  }

  /** Tambah masa aktif. Sisa masa aktif yang masih ada tidak hangus. */
  private extendInDb(c: CustomerRow, opts: { validity: string; pkg?: PackageRow }) {
    const secs = parseDuration(opts.validity);
    if (secs <= 0) throw new HttpError(400, 'Masa aktif tidak valid');
    const now = Date.now();
    const base = c.expires_at && Date.parse(c.expires_at) > now ? Date.parse(c.expires_at) : now;
    const after = new Date(base + secs * 1000).toISOString();
    const profile = opts.pkg?.profile ?? c.profile;
    this.db.run(`UPDATE customers SET expires_at = ?, status = 'active', package_id = ?, profile = ? WHERE id = ?`, [after, opts.pkg?.id ?? c.package_id, profile, c.id]);
    return after;
  }

  /** Perpanjangan manual oleh admin/operator (pembayaran tunai, transfer, dsb). */
  async extend(id: number, opts: { validity?: string; packageId?: number | null; amount?: number; note?: string }, actor: string) {
    const c = this.requireCustomer(id);
    const pkgId = opts.packageId ?? c.package_id;
    const pkg = pkgId ? this.requirePackage(pkgId) : undefined;
    if (pkg && pkg.router_id !== c.router_id) throw new HttpError(400, 'Paket bukan milik router ini');
    const validity = opts.validity || pkg?.validity || '';
    if (!c.profile && !pkg) throw new HttpError(400, 'Pilih paket untuk pelanggan ini terlebih dahulu');
    const after = this.db.transaction(() => {
      const a = this.extendInDb(c, { validity, pkg });
      this.tx(c, { type: 'manual', packageName: pkg?.name, amount: opts.amount ?? pkg?.price ?? 0, validity, before: c.expires_at, after: a, note: opts.note, actor });
      return a;
    });
    const routerError = await this.applyNow(this.requireCustomer(id));
    this.hub.emit('customers', { routerId: c.router_id });
    return { customer: this.requireCustomer(id), expires_at: after, routerError };
  }

  /** Isi ulang dengan kode voucher. */
  async redeem(opts: { code: string; customerId?: number; username?: string }, actor: string) {
    const code = normalizeVoucherCode(opts.code);
    const v = code ? this.db.get<PppVoucherRow>('SELECT * FROM ppp_vouchers WHERE code = ?', [code]) : undefined;
    if (!v) throw new HttpError(404, 'Kode voucher tidak ditemukan');
    if (v.status !== 'unused') throw new HttpError(400, 'Voucher sudah pernah dipakai');
    const c = opts.customerId
      ? this.requireCustomer(opts.customerId)
      : this.db.get<CustomerRow>('SELECT * FROM customers WHERE router_id = ? AND username = ?', [v.router_id, (opts.username ?? '').trim()]);
    if (!c) throw new HttpError(404, 'Akun PPPoE tidak ditemukan');
    if (c.router_id !== v.router_id) throw new HttpError(400, 'Voucher ini untuk server lain');
    const pkg = v.package_id ? this.db.get<PackageRow>('SELECT * FROM ppp_packages WHERE id = ?', [v.package_id]) : undefined;
    if (!pkg && !c.profile) throw new HttpError(400, 'Paket voucher sudah dihapus. Hubungi admin.');

    const after = this.db.transaction(() => {
      const used = this.db.run(`UPDATE ppp_vouchers SET status = 'used', customer_id = ?, customer_name = ?, used_at = ? WHERE id = ? AND status = 'unused'`, [
        c.id,
        c.name,
        new Date().toISOString(),
        v.id,
      ]);
      if (used.changes !== 1) throw new HttpError(400, 'Voucher sudah pernah dipakai');
      const a = this.extendInDb(c, { validity: v.validity, pkg });
      this.tx(c, { type: 'voucher', voucherCode: v.code, resellerId: v.reseller_id, packageName: v.package_name, amount: v.price, validity: v.validity, before: c.expires_at, after: a, actor });
      return a;
    });
    const routerError = await this.applyNow(this.requireCustomer(c.id));
    this.hub.emit('customers', { routerId: c.router_id });
    this.hub.emit('ppp-vouchers', { routerId: c.router_id });
    return { customer: this.requireCustomer(c.id), voucher: { code: v.code, package_name: v.package_name, validity: v.validity, price: v.price }, expires_at: after, routerError };
  }

  async setStatus(id: number, status: CustomerStatus, actor: string) {
    const c = this.requireCustomer(id);
    if (status === 'active' && c.expires_at && Date.parse(c.expires_at) <= Date.now()) {
      throw new HttpError(400, 'Masa aktif sudah habis. Isi voucher atau perpanjang terlebih dahulu.');
    }
    if (status === 'active' && !c.profile) throw new HttpError(400, 'Pilih paket untuk pelanggan ini terlebih dahulu');
    if (c.status !== status) {
      this.db.run('UPDATE customers SET status = ? WHERE id = ?', [status, id]);
      if (status === 'isolated') this.tx(c, { type: 'isolate', note: 'Diisolir manual', actor });
      if (status === 'active') this.tx(c, { type: 'restore', note: c.status === 'disabled' ? 'Diaktifkan kembali' : 'Isolir dibuka', actor });
    }
    const routerError = await this.applyNow(this.requireCustomer(id));
    this.hub.emit('customers', { routerId: c.router_id });
    return { customer: this.requireCustomer(id), routerError };
  }

  /** Impor akun PPPoE yang sudah ada di router sebagai pelanggan (tanpa batas masa aktif sampai diatur). */
  async importFromRouter(routerId: number) {
    this.routers.require(routerId);
    const secrets = await this.routers.exec(routerId, '/ppp/secret/print');
    const existing = new Set(this.db.all<{ username: string }>('SELECT username FROM customers WHERE router_id = ?', [routerId]).map((r) => r.username));
    const pkgs = this.db.all<PackageRow>('SELECT * FROM ppp_packages WHERE router_id = ?', [routerId]);
    const now = new Date().toISOString();
    let imported = 0;
    this.db.transaction(() => {
      for (const s of secrets) {
        if (!s.name || existing.has(s.name)) continue;
        if (s.service && !['pppoe', 'any'].includes(s.service)) continue;
        const isolated = s.profile === this.isolirProfile;
        const pkg = pkgs.find((p) => p.profile === s.profile);
        const comment = (s.comment ?? '').replace(new RegExp(`^${PPP_COMMENT_PREFIX}\\|`), '').trim();
        this.db.run(
          `INSERT INTO customers (router_id, name, username, password, package_id, profile, status, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [routerId, comment || s.name, s.name, s.password ?? '', pkg?.id ?? null, isolated ? '' : s.profile ?? 'default', s.disabled === 'true' ? 'disabled' : isolated ? 'isolated' : 'active', isolated ? now : null, now],
        );
        imported++;
      }
    });
    if (imported) await this.sync(routerId).catch(() => undefined);
    return { imported, total: secrets.length };
  }

  // -------------------------------------------------------- Sinkronisasi

  /** Perbarui status online, isolir pelanggan yang masa aktifnya habis, dan samakan router dengan aplikasi. */
  async sync(routerId: number) {
    if (this.syncing.has(routerId)) return { skipped: true };
    this.syncing.add(routerId);
    try {
      const customers = this.db.all<CustomerRow>('SELECT * FROM customers WHERE router_id = ?', [routerId]);
      const stats = { checked: customers.length, online: 0, isolated: 0, fixed: 0, missing: 0 };
      if (!customers.length) return stats;
      const [secrets, active] = await Promise.all([
        this.routers.exec(routerId, '/ppp/secret/print', { '.proplist': SECRET_PROPS }),
        this.routers.exec(routerId, '/ppp/active/print', { '.proplist': ACTIVE_PROPS }),
      ]);
      const secretMap = new Map<string, RosRow>(secrets.map((s) => [s.name, s]));
      const activeMap = new Map<string, RosRow>(active.map((a) => [a.name, a]));
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      let changed = false;

      for (const c of customers) {
        const secret = secretMap.get(c.username);
        let a = activeMap.get(c.username);
        if (c.status === 'active' && c.expires_at && Date.parse(c.expires_at) <= now) {
          c.status = 'isolated';
          this.db.run(`UPDATE customers SET status = 'isolated' WHERE id = ?`, [c.id]);
          this.tx(c, { type: 'isolate', note: 'Masa aktif habis', before: c.expires_at, actor: 'sistem' });
          stats.isolated++;
          changed = true;
        }
        if (!secret) stats.missing++;
        else {
          try {
            if (await this.applyState(c, secret)) {
              stats.fixed++;
              a = undefined; // sesi diputus, akan tersambung lagi dengan profil baru
            }
          } catch (err) {
            this.log.warn({ err }, `Gagal menerapkan status PPPoE ${c.username}`);
          }
        }
        const online = a ? 1 : 0;
        if (online) stats.online++;
        if (online !== c.online || (secret ? 1 : 0) !== c.on_router) changed = true;
        this.db.run(
          `UPDATE customers SET online = ?, on_router = ?, ip = CASE WHEN ? THEN ? ELSE ip END, mac = CASE WHEN ? THEN ? ELSE mac END,
             uptime_seconds = ?, last_seen_at = CASE WHEN ? THEN ? ELSE last_seen_at END WHERE id = ?`,
          [online, secret ? 1 : 0, online, a?.address ?? '', online, a?.['caller-id'] ?? '', a ? parseDuration(a.uptime) : 0, online, nowIso, c.id],
        );
      }
      this.checkOdps(routerId);
      if (changed) this.hub.emit('customers', { routerId });
      return stats;
    } finally {
      this.syncing.delete(routerId);
    }
  }

  /** Kirim notifikasi saat pola offline menunjukkan kabel feeder/distribusi putus, dan saat pulih. */
  private checkOdps(routerId: number) {
    const d = this.diagnosis(routerId);
    const now = new Map(d.findings.filter((f) => f.severity === 'critical').map((f) => [f.key, f]));
    const prev = this.activeFaults.get(routerId) ?? new Map<string, string>();
    const notify = this.settings.get().pppoe.odpDownAlert;
    for (const [key, f] of now) {
      if (prev.has(key) || !notify) continue;
      const names = f.affected.slice(0, 6).map((a) => a.name).join(', ');
      this.alerts.create({
        routerId,
        level: 'critical',
        type: `fiber.${f.kind}`,
        title: f.title,
        message: `${f.affected.length} pelanggan offline${names ? `: ${names}${f.affected.length > 6 ? ', ...' : ''}` : ''}. Buka menu Troubleshoot Jalur untuk langkah pengecekan.`,
      });
    }
    for (const [key, title] of prev) {
      if (now.has(key) || !notify) continue;
      this.alerts.create({ routerId, level: 'success', type: 'fiber.recovered', title: `Pulih: ${title}`, message: 'Pelanggan di jalur ini sudah kembali online.' });
    }
    this.activeFaults.set(routerId, new Map([...now].map(([k, f]) => [k, f.title])));
  }

  // --------------------------------------------------------- Troubleshoot

  /** Diagnosis dari data terakhir di database (tanpa menghubungi router). */
  diagnosis(routerId: number, extra: { serverPortRunning?: { name: string; running: boolean }[] } = {}): Diagnosis {
    const r = this.routers.require(routerId) as any;
    return diagnose({
      server: { type: 'server', id: r.id, name: r.name, lat: r.lat ?? null, lng: r.lng ?? null },
      odcs: this.db.all('SELECT id, name, lat, lng FROM odcs WHERE router_id = ?', [routerId]),
      odps: this.db.all('SELECT id, odc_id, odc_port, name, lat, lng FROM odps WHERE router_id = ?', [routerId]),
      customers: this.db.all('SELECT id, name, username, phone, status, online, on_router, odp_id, odp_port, last_seen_at, lat, lng FROM customers WHERE router_id = ?', [routerId]),
      ...extra,
    });
  }

  /**
   * Scan jalur: ambil status PPPoE terbaru dari router, cek interface PPPoE server,
   * lalu lampirkan baris log router terakhir untuk tiap pelanggan terdampak.
   */
  async scan(routerId: number): Promise<Diagnosis & { syncError?: string }> {
    let syncError: string | undefined;
    let serverPortRunning: { name: string; running: boolean }[] | undefined;
    let logs: RosRow[] = [];
    try {
      await this.sync(routerId);
      const [servers, ifaces] = await Promise.all([
        this.routers.exec(routerId, '/interface/pppoe-server/server/print', { '.proplist': 'interface,disabled' }),
        this.routers.exec(routerId, '/interface/print', { '.proplist': 'name,running,disabled' }),
      ]);
      const state = new Map(ifaces.map((i) => [i.name, i.running === 'true' && i.disabled !== 'true']));
      serverPortRunning = servers.filter((s) => s.disabled !== 'true' && s.interface && state.has(s.interface)).map((s) => ({ name: s.interface, running: state.get(s.interface)! }));
      logs = await this.routers.exec(routerId, '/log/print').catch(() => []);
    } catch (err) {
      syncError = (err as Error).message;
    }
    const d = this.diagnosis(routerId, { serverPortRunning });
    if (logs.length) {
      for (const f of d.findings) {
        for (const a of f.affected) {
          const re = new RegExp(`(^|[^A-Za-z0-9._@-])${a.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9._@-])`);
          // utamakan baris yang menyebut penyebab putus, mis. "terminating... - peer is not responding"
          let fallback: string | undefined;
          for (let i = logs.length - 1; i >= 0 && i >= logs.length - 2000; i--) {
            const msg = logs[i].message ?? '';
            if (!/pppoe|ppp/.test(logs[i].topics ?? '') || !re.test(msg) || /logged in|connected$/.test(msg)) continue;
            const line = `${logs[i].time ?? ''} ${msg}`.trim();
            if (/terminat|disconnect|not responding|timeout|hung ?up|peer/i.test(msg)) {
              a.lastLog = line;
              break;
            }
            fallback ??= line;
          }
          a.lastLog ??= fallback;
        }
      }
    }
    return { ...d, syncError };
  }

  setServerLocation(routerId: number, lat: number | null, lng: number | null) {
    this.routers.require(routerId);
    this.db.run('UPDATE routers SET lat = ?, lng = ? WHERE id = ?', [lat, lng, routerId]);
  }

  // --------------------------------------------------------------- Isolir

  /** Pastikan pool dan profil isolir ada di router. */
  async ensureIsolirProfile(routerId: number) {
    const s = this.settings.get().pppoe;
    const done: string[] = [];
    const profiles = await this.routers.exec(routerId, '/ppp/profile/print', { '.proplist': 'name' });
    if (profiles.some((p) => p.name === this.isolirProfile)) return done;
    const pools = await this.routers.exec(routerId, '/ip/pool/print', { '.proplist': 'name' });
    if (!pools.some((p) => p.name === s.isolirPool)) {
      await this.routers.exec(routerId, '/ip/pool/add', { name: s.isolirPool, ranges: s.isolirPoolRange, comment: ISOLIR_COMMENT });
      done.push(`Pool ${s.isolirPool} (${s.isolirPoolRange})`);
    }
    await this.routers.exec(routerId, '/ppp/profile/add', {
      name: this.isolirProfile,
      'local-address': s.isolirGateway,
      'remote-address': s.isolirPool,
      'rate-limit': '512k/512k',
      'address-list': 'isolir',
      'only-one': 'yes',
      comment: ISOLIR_COMMENT,
    });
    done.push(`Profil PPP ${this.isolirProfile}`);
    return done;
  }

  /**
   * Pasang aturan firewall isolir: pelanggan terisolir hanya bisa DNS dan halaman isi ulang,
   * akses web lain dialihkan ke halaman isolir MIKROTAL.
   */
  async setupIsolir(routerId: number) {
    this.routers.require(routerId);
    const s = this.settings.get().pppoe;
    const done = await this.ensureIsolirProfile(routerId);
    const [filter, nat] = await Promise.all([
      this.routers.exec(routerId, '/ip/firewall/filter/print', { '.proplist': '.id,comment' }),
      this.routers.exec(routerId, '/ip/firewall/nat/print', { '.proplist': '.id,comment' }),
    ]);
    const has = (rows: RosRow[], name: string) => rows.some((r) => r.comment === `${ISOLIR_COMMENT}: ${name}`);
    const firstFilter = filter[0]?.['.id'];
    const firstNat = nat[0]?.['.id'];
    const addFilter = async (name: string, params: Record<string, string>) => {
      if (has(filter, name)) return;
      await this.routers.exec(routerId, '/ip/firewall/filter/add', { chain: 'forward', 'src-address-list': 'isolir', ...params, comment: `${ISOLIR_COMMENT}: ${name}`, 'place-before': firstFilter });
      done.push(`Filter: ${name}`);
    };
    await addFilter('izinkan DNS', { protocol: 'udp', 'dst-port': '53', action: 'accept' });
    if (s.portalAddress) await addFilter('izinkan halaman isi ulang', { 'dst-address': s.portalAddress, action: 'accept' });
    await addFilter('blokir internet', { action: 'drop' });
    if (s.portalAddress && !has(nat, 'alihkan ke halaman isolir')) {
      await this.routers.exec(routerId, '/ip/firewall/nat/add', {
        chain: 'dstnat',
        'src-address-list': 'isolir',
        protocol: 'tcp',
        'dst-port': '80',
        'dst-address': `!${s.portalAddress}`,
        action: 'dst-nat',
        'to-addresses': s.portalAddress,
        'to-ports': String(s.portalPort || 80),
        comment: `${ISOLIR_COMMENT}: alihkan ke halaman isolir`,
        'place-before': firstNat,
      });
      done.push('NAT: alihkan ke halaman isolir');
    }
    return { done, portal: !!s.portalAddress };
  }

  // -------------------------------------------------------------- Voucher

  async generateVouchers(opts: { packageId: number; qty: number; length?: number; charset?: string; prefix?: string; resellerId?: number | null; note?: string }, actor: string) {
    if (opts.qty < 1 || opts.qty > 1000) throw new HttpError(400, 'Jumlah voucher harus 1 - 1000');
    const pkg = this.requirePackage(opts.packageId);
    if (!pkg.active) throw new HttpError(400, 'Paket nonaktif');
    const s = this.settings.get().pppoe;

    let reseller: { id: number; name: string; balance: number; discount: number; active: number } | undefined;
    let unitCost = 0;
    if (opts.resellerId) {
      reseller = this.db.get('SELECT * FROM resellers WHERE id = ?', [opts.resellerId]);
      if (!reseller) throw new HttpError(404, 'Reseller tidak ditemukan');
      if (!reseller.active) throw new HttpError(400, 'Reseller nonaktif');
      unitCost = pkg.reseller_price > 0 ? pkg.reseller_price : pkg.price * (1 - (reseller.discount || 0) / 100);
      const total = unitCost * opts.qty;
      if (total > reseller.balance + 1e-6) {
        throw new HttpError(400, `Saldo reseller tidak cukup. Dibutuhkan ${total.toLocaleString('id-ID')}, saldo ${reseller.balance.toLocaleString('id-ID')}.`);
      }
    }

    const taken = new Set(this.db.all<{ code: string }>('SELECT code FROM ppp_vouchers').map((r) => r.code));
    const charset = (PPP_VOUCHER_CHARSETS as readonly string[]).includes(opts.charset ?? '') ? opts.charset! : s.voucherCharset;
    let codes: string[];
    try {
      codes = generateCodes({ qty: opts.qty, length: opts.length ?? s.voucherLength, charset, prefix: (opts.prefix ?? s.voucherPrefix).toUpperCase(), taken });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    const batchCode = `P${Date.now().toString(36).toUpperCase()}${randomCode('alnum-upper', 3)}`;
    const now = new Date().toISOString();
    const batch = this.db.transaction(() => {
      const totalCost = unitCost * codes.length;
      const { lastId: batchId } = this.db.run(
        `INSERT INTO ppp_voucher_batches (code, router_id, package_id, package_name, qty, price, validity, reseller_id, cost, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [batchCode, pkg.router_id, pkg.id, pkg.name, codes.length, pkg.price, pkg.validity, reseller?.id ?? null, totalCost, opts.note ?? '', actor, now],
      );
      for (const code of codes) {
        this.db.run(
          `INSERT INTO ppp_vouchers (batch_id, router_id, code, package_id, package_name, price, validity, reseller_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [batchId, pkg.router_id, code, pkg.id, pkg.name, pkg.price, pkg.validity, reseller?.id ?? null, now],
        );
      }
      if (reseller && totalCost > 0) {
        const balance = reseller.balance - totalCost;
        this.db.run('UPDATE resellers SET balance = ? WHERE id = ?', [balance, reseller.id]);
        this.db.run(
          `INSERT INTO reseller_tx (reseller_id, type, amount, balance_after, ref, note, created_by, created_at) VALUES (?, 'purchase', ?, ?, ?, ?, ?, ?)`,
          [reseller.id, -totalCost, balance, batchCode, `${codes.length} voucher PPPoE ${pkg.name}`, actor, now],
        );
      }
      return this.db.get<any>('SELECT * FROM ppp_voucher_batches WHERE id = ?', [batchId])!;
    });
    this.hub.emit('ppp-vouchers', { routerId: pkg.router_id, batchId: batch.id });
    return { batch, created: codes.length };
  }

  /** Hapus batch: voucher yang belum dipakai ikut terhapus, yang sudah dipakai tetap tercatat di riwayat pelanggan. */
  deleteBatch(batchId: number, opts: { refund: boolean; actor: string }) {
    const batch = this.db.get<any>('SELECT * FROM ppp_voucher_batches WHERE id = ?', [batchId]);
    if (!batch) throw new HttpError(404, 'Batch tidak ditemukan');
    return this.db.transaction(() => {
      const unused = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ppp_vouchers WHERE batch_id = ? AND status = 'unused'`, [batchId])!.n;
      if (opts.refund && batch.reseller_id && batch.qty > 0 && unused > 0) {
        const refund = (batch.cost / batch.qty) * unused;
        const r = this.db.get<{ balance: number }>('SELECT balance FROM resellers WHERE id = ?', [batch.reseller_id]);
        if (r && refund > 0) {
          const balance = r.balance + refund;
          this.db.run('UPDATE resellers SET balance = ? WHERE id = ?', [balance, batch.reseller_id]);
          this.db.run(
            `INSERT INTO reseller_tx (reseller_id, type, amount, balance_after, ref, note, created_by, created_at) VALUES (?, 'refund', ?, ?, ?, ?, ?, ?)`,
            [batch.reseller_id, refund, balance, batch.code, `Refund ${unused} voucher PPPoE belum terpakai`, opts.actor, new Date().toISOString()],
          );
        }
      }
      this.db.run(`DELETE FROM ppp_vouchers WHERE batch_id = ? AND status = 'unused'`, [batchId]);
      this.db.run('UPDATE ppp_vouchers SET batch_id = NULL WHERE batch_id = ?', [batchId]);
      this.db.run('DELETE FROM ppp_voucher_batches WHERE id = ?', [batchId]);
      return { removed: unused };
    });
  }

  // ------------------------------------------------------------- Topologi

  topology(routerId: number) {
    const odcs = this.db.all<any>('SELECT * FROM odcs WHERE router_id = ? ORDER BY name COLLATE NOCASE', [routerId]);
    const odps = this.db.all<any>('SELECT * FROM odps WHERE router_id = ? ORDER BY odc_port IS NULL, odc_port, name COLLATE NOCASE', [routerId]);
    const customers = this.db.all<any>(
      `SELECT c.id, c.name, c.username, c.status, c.online, c.on_router, c.odp_id, c.odp_port, c.lat, c.lng, c.expires_at, c.last_seen_at, p.name AS package_name
       FROM customers c LEFT JOIN ppp_packages p ON p.id = c.package_id WHERE c.router_id = ? ORDER BY c.odp_port IS NULL, c.odp_port, c.name COLLATE NOCASE`,
      [routerId],
    );
    const shape = (o: any) => {
      const list = customers.filter((c) => c.odp_id === o.id);
      const live = list.filter((c) => c.status !== 'disabled');
      const online = list.filter((c) => c.online).length;
      return { ...o, customers: list, used: list.length, online, down: live.length >= 2 && online === 0 };
    };
    const r = this.routers.require(routerId) as any;
    return {
      server: { id: r.id, name: r.name, location: r.location ?? '', lat: r.lat ?? null, lng: r.lng ?? null },
      odcs: odcs.map((d) => {
        const children = odps.filter((o) => o.odc_id === d.id).map(shape);
        return { ...d, odps: children, used: children.length, customers: children.reduce((n, o) => n + o.used, 0), online: children.reduce((n, o) => n + o.online, 0) };
      }),
      looseOdps: odps.filter((o) => !o.odc_id).map(shape),
      unassigned: customers.filter((c) => !c.odp_id),
    };
  }

  // ------------------------------------------------------------ Ringkasan

  summary(routerId?: number) {
    const rf = routerId ? ' AND router_id = ?' : '';
    const rp = routerId ? [routerId] : [];
    const remindDays = this.settings.get().pppoe.remindDays;
    const now = Date.now();
    const soon = new Date(now + remindDays * 86400_000).toISOString();
    const nowIso = new Date(now).toISOString();
    const c = this.db.get<any>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(online), 0) AS online,
         COALESCE(SUM(status = 'active'), 0) AS active, COALESCE(SUM(status = 'isolated'), 0) AS isolated, COALESCE(SUM(status = 'disabled'), 0) AS disabled,
         COALESCE(SUM(status = 'active' AND online = 0), 0) AS offline,
         COALESCE(SUM(status = 'active' AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?), 0) AS expiring
       FROM customers WHERE 1 = 1${rf}`,
      [nowIso, soon, ...rp],
    );
    const expiringList = this.db.all<any>(
      `SELECT c.id, c.name, c.username, c.phone, c.expires_at, c.online, p.name AS package_name FROM customers c LEFT JOIN ppp_packages p ON p.id = c.package_id
       WHERE c.status = 'active' AND c.expires_at IS NOT NULL AND c.expires_at <= ?${rf.replace('router_id', 'c.router_id')} ORDER BY c.expires_at LIMIT 8`,
      [soon, ...rp],
    );
    const vouchers = this.db.get<any>(
      `SELECT COALESCE(SUM(status = 'unused'), 0) AS unused, COALESCE(SUM(status = 'used'), 0) AS used FROM ppp_vouchers WHERE 1 = 1${rf}`,
      rp,
    );
    const odp = this.db.get<any>(`SELECT COUNT(*) AS total, COALESCE(SUM(ports), 0) AS ports FROM odps WHERE 1 = 1${rf}`, rp);
    const odpUsed = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM customers WHERE odp_id IS NOT NULL${rf}`, rp)!.n;
    return {
      customers: c,
      remindDays,
      expiringList,
      vouchers,
      odp: { total: odp.total, ports: odp.ports, used: odpUsed, down: [...this.activeFaults.entries()].filter(([id]) => !routerId || id === routerId).reduce((n, [, m]) => n + m.size, 0) },
    };
  }
}
