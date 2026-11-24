import crypto from 'node:crypto';
import type { DB } from '../db/index.js';
import { formatDuration, parseDuration } from '../lib/duration.js';
import { parseMikhmonMeta, parseRouterDate } from '../lib/mikhmon.js';
import type { RosRow } from '../lib/routeros/types.js';
import type { AlertService, Hub } from './alerts.js';
import type { RouterManager } from './routers.js';
import type { SettingsService } from './settings.js';

export const CHARSETS: Record<string, string> = {
  numeric: '0123456789',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghjkmnpqrstuvwxyz',
  'alnum-upper': 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  'alnum-lower': 'abcdefghjkmnpqrstuvwxyz23456789',
  'alnum-mixed': 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789',
};

export function randomCode(charset: string, length: number): string {
  const chars = CHARSETS[charset] ?? CHARSETS['alnum-upper'];
  let out = '';
  for (let i = 0; i < length; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

/** Hasilkan `qty` kode unik yang tidak bentrok dengan `taken`. */
export function generateCodes(opts: { qty: number; length: number; charset: string; prefix?: string; taken?: Set<string> }): string[] {
  const taken = opts.taken ?? new Set<string>();
  const out: string[] = [];
  const space = Math.pow((CHARSETS[opts.charset] ?? CHARSETS['alnum-upper']).length, opts.length);
  if (space < opts.qty * 4) throw new Error('Kombinasi kode terlalu sedikit. Tambah panjang kode atau ganti jenis karakter.');
  let guard = 0;
  while (out.length < opts.qty) {
    if (++guard > opts.qty * 200) throw new Error('Gagal membuat kode unik, coba tambah panjang kode.');
    const code = `${opts.prefix ?? ''}${randomCode(opts.charset, opts.length)}`;
    if (taken.has(code)) continue;
    taken.add(code);
    out.push(code);
  }
  return out;
}

export interface GenerateOptions {
  routerId: number;
  profile: string;
  qty: number;
  length: number;
  charset: string;
  prefix?: string;
  mode: 'same' | 'separate';
  passwordLength?: number;
  passwordCharset?: string;
  price?: number;
  validity?: string;
  timeLimit?: string;
  dataLimit?: number;
  server?: string;
  resellerId?: number | null;
  note?: string;
}

export interface VoucherRow {
  id: number;
  batch_id: number | null;
  router_id: number;
  code: string;
  password: string;
  profile: string;
  price: number;
  validity: string;
  time_limit: string;
  data_limit: number;
  status: 'unused' | 'active' | 'used' | 'expired' | 'removed' | 'disabled';
  reseller_id: number | null;
  mac: string;
  ip: string;
  uptime_seconds: number;
  bytes_in: number;
  bytes_out: number;
  activated_at: string | null;
  expires_at: string | null;
  last_seen_at: string | null;
  router_item_id: string;
  created_at: string;
  raw_uptime: number;
  raw_bytes_in: number;
  raw_bytes_out: number;
  uptime_offset: number;
  bytes_in_offset: number;
  bytes_out_offset: number;
  counter_resets: number;
}

/** Bila sebanyak ini voucher hilang sekaligus dari router, anggap data router belum lengkap (mis. baru reboot/update). */
const MASS_MISSING_MIN = 4;
const MASS_MISSING_RATIO = 0.5;
/** Lama penundaan paling lama. Setelah itu voucher yang tetap hilang dianggap memang dihapus (mis. lewat Winbox). */
const MASS_MISSING_GRACE_MS = 15 * 60_000;

export const VOUCHER_COMMENT_PREFIX = 'MIKROTAL';

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export class VoucherService {
  private syncing = new Set<number>();
  private timer?: NodeJS.Timeout;
  /** Sejak kapan banyak voucher hilang sekaligus, per router. */
  private massMissingSince = new Map<number, number>();
  /** Bisa diubah di tes. */
  massMissingGraceMs = MASS_MISSING_GRACE_MS;

  constructor(
    private readonly db: DB,
    private readonly routers: RouterManager,
    private readonly settings: SettingsService,
    private readonly hub: Hub,
    private readonly log: { warn: (...a: any[]) => void } = console,
    private readonly alerts?: AlertService,
  ) {}

  start() {
    const loop = async () => {
      for (const r of this.routers.list().filter((x) => x.enabled)) {
        await this.sync(r.id).catch(() => undefined);
      }
      this.timer = setTimeout(loop, Math.max(15, this.settings.get().voucher.syncSeconds) * 1000);
    };
    this.timer = setTimeout(loop, 5000);
  }

  stop() {
    clearTimeout(this.timer);
  }

  profileMeta(routerId: number, profile: string) {
    return this.db.get<{ price: number; reseller_price: number; validity: string; time_limit: string; data_limit: number; lock_mac: number }>(
      'SELECT * FROM profile_meta WHERE router_id = ? AND profile = ?',
      [routerId, profile],
    );
  }

  async generate(opts: GenerateOptions, actor: string) {
    if (opts.qty < 1 || opts.qty > 1000) throw new HttpError(400, 'Jumlah voucher harus 1 - 1000');
    const router = this.routers.require(opts.routerId);
    const meta = this.profileMeta(router.id, opts.profile);
    const price = opts.price ?? meta?.price ?? 0;
    const validity = opts.validity ?? meta?.validity ?? '';
    const timeLimit = opts.timeLimit ?? meta?.time_limit ?? '';
    const dataLimit = opts.dataLimit ?? meta?.data_limit ?? 0;

    // Biaya reseller
    let reseller: { id: number; name: string; balance: number; discount: number; active: number } | undefined;
    let unitCost = 0;
    if (opts.resellerId) {
      reseller = this.db.get('SELECT * FROM resellers WHERE id = ?', [opts.resellerId]);
      if (!reseller) throw new HttpError(404, 'Reseller tidak ditemukan');
      if (!reseller.active) throw new HttpError(400, 'Reseller nonaktif');
      if (!(price > 0)) throw new HttpError(400, `Profil "${opts.profile}" belum diberi harga, jadi tidak bisa dijual lewat reseller`);
      unitCost = meta?.reseller_price && meta.reseller_price > 0 ? meta.reseller_price : price * (1 - (reseller.discount || 0) / 100);
      const total = unitCost * opts.qty;
      if (total > reseller.balance + 1e-6) {
        throw new HttpError(400, `Saldo reseller tidak cukup. Dibutuhkan ${total.toLocaleString('id-ID')}, saldo ${reseller.balance.toLocaleString('id-ID')}.`);
      }
    }

    // Pastikan profil ada di router
    const profiles = await this.routers.exec(router.id, '/ip/hotspot/user/profile/print', { '.proplist': 'name' });
    if (!profiles.some((p) => p.name === opts.profile)) throw new HttpError(400, `Profil "${opts.profile}" tidak ada di router`);

    const existing = await this.routers.exec(router.id, '/ip/hotspot/user/print', { '.proplist': 'name' });
    const taken = new Set<string>(existing.map((u) => u.name));
    for (const v of this.db.all<{ code: string }>('SELECT code FROM vouchers WHERE router_id = ?', [router.id])) taken.add(v.code);

    const codes = generateCodes({ qty: opts.qty, length: opts.length, charset: opts.charset, prefix: opts.prefix, taken });
    const batchCode = `B${Date.now().toString(36).toUpperCase()}${randomCode('alnum-upper', 3)}`;
    const items = codes.map((code) => ({
      code,
      password: opts.mode === 'separate' ? randomCode(opts.passwordCharset ?? 'numeric', opts.passwordLength ?? 4) : code,
    }));

    const results = await mapLimit(items, 8, async (item) => {
      const rows = await this.routers.exec(router.id, '/ip/hotspot/user/add', {
        name: item.code,
        password: item.password,
        profile: opts.profile,
        server: opts.server && opts.server !== 'all' ? opts.server : undefined,
        'limit-uptime': timeLimit || undefined,
        'limit-bytes-total': dataLimit > 0 ? dataLimit : undefined,
        comment: `${VOUCHER_COMMENT_PREFIX}|${batchCode}|${validity || '-'}`,
      });
      return rows[0]?.ret ?? '';
    });

    const ok = items.map((item, i) => ({ ...item, result: results[i] })).filter((x) => x.result.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (!ok.length) {
      throw new HttpError(502, `Gagal menambahkan voucher ke router: ${failed[0]?.reason?.message ?? 'unknown'}`);
    }

    const now = new Date().toISOString();
    const batch = this.db.transaction(() => {
      const totalCost = unitCost * ok.length;
      const { lastId: batchId } = this.db.run(
        `INSERT INTO voucher_batches (code, router_id, profile, server, qty, price, validity, time_limit, data_limit, mode, reseller_id, cost, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [batchCode, router.id, opts.profile, opts.server ?? 'all', ok.length, price, validity, timeLimit, dataLimit, opts.mode, reseller?.id ?? null, totalCost, opts.note ?? '', actor, now],
      );
      for (const v of ok) {
        this.db.run(
          `INSERT INTO vouchers (batch_id, router_id, code, password, profile, price, validity, time_limit, data_limit, status, reseller_id, router_item_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unused', ?, ?, ?)`,
          [batchId, router.id, v.code, v.password, opts.profile, price, validity, timeLimit, dataLimit, reseller?.id ?? null, (v.result as PromiseFulfilledResult<string>).value, now],
        );
      }
      if (reseller && totalCost > 0) {
        // Saldo dibaca ulang: selama voucher dibuat di router bisa ada top up atau pembelian lain
        this.db.run('UPDATE resellers SET balance = balance - ? WHERE id = ?', [totalCost, reseller.id]);
        const balance = this.db.get<{ balance: number }>('SELECT balance FROM resellers WHERE id = ?', [reseller.id])!.balance;
        this.db.run(
          `INSERT INTO reseller_tx (reseller_id, type, amount, balance_after, ref, note, created_by, created_at) VALUES (?, 'purchase', ?, ?, ?, ?, ?, ?)`,
          [reseller.id, -totalCost, balance, batchCode, `${ok.length} voucher ${opts.profile}`, actor, now],
        );
      }
      return this.db.get('SELECT * FROM voucher_batches WHERE id = ?', [batchId])!;
    });

    this.hub.emit('vouchers', { routerId: router.id, batchId: batch.id });
    return { batch, created: ok.length, failed: failed.length, errors: failed.slice(0, 3).map((f) => f.reason?.message ?? String(f.reason)) };
  }

  /**
   * Sinkronkan status voucher dengan router: aktivasi, pemakaian, kedaluwarsa.
   * Tahan terhadap reboot/update RouterOS: counter yang tereset dijumlahkan, dan voucher tidak
   * ditandai "dihapus" bila daftar user di router mendadak kosong/tidak lengkap.
   */
  async sync(routerId: number) {
    if (this.syncing.has(routerId)) return { skipped: true };
    this.syncing.add(routerId);
    try {
      const vouchers = this.db.all<VoucherRow>(`SELECT * FROM vouchers WHERE router_id = ? AND status IN ('unused','active','used','disabled','removed')`, [routerId]);
      if (!vouchers.length) return { checked: 0, activated: 0, expired: 0, missing: 0, resets: 0, restored: 0 };
      const [users, active] = await Promise.all([
        this.routers.exec(routerId, '/ip/hotspot/user/print', { '.proplist': '.id,name,uptime,bytes-in,bytes-out,disabled,comment,mac-address' }),
        this.routers.exec(routerId, '/ip/hotspot/active/print', { '.proplist': '.id,user,address,mac-address,uptime,bytes-in,bytes-out' }),
      ]);
      const userMap = new Map<string, RosRow>(users.map((u) => [u.name, u]));
      const activeMap = new Map<string, RosRow>(active.map((a) => [a.user, a]));
      const s = this.settings.get();
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const stats = { checked: vouchers.length, activated: 0, expired: 0, missing: 0, resets: 0, restored: 0, deferred: false };

      // Banyak voucher hilang sekaligus → jangan langsung tandai dihapus, tunggu router stabil.
      // Penundaan dibatasi waktu: bila tetap hilang, voucher memang dihapus (mis. satu batch dihapus lewat Winbox).
      const tracked = vouchers.filter((v) => v.status !== 'removed');
      const missingNow = tracked.filter((v) => !userMap.has(v.code));
      const massMissing = missingNow.length >= MASS_MISSING_MIN && missingNow.length >= tracked.length * MASS_MISSING_RATIO;
      let deferMissing = false;
      if (massMissing) {
        const since = this.massMissingSince.get(routerId);
        const graceMin = Math.round(this.massMissingGraceMs / 60_000);
        if (since === undefined) {
          this.massMissingSince.set(routerId, now);
          deferMissing = true;
          this.alerts?.create({
            routerId,
            level: 'warning',
            type: 'voucher.sync.deferred',
            title: 'Sinkronisasi voucher ditunda',
            message: `${missingNow.length} dari ${tracked.length} voucher tidak terlihat di router sekaligus (mungkin router baru reboot/update). Status voucher tidak diubah selama ${graceMin} menit sambil menunggu data router lengkap kembali.`,
          });
        } else if (now - since < this.massMissingGraceMs) {
          deferMissing = true;
        } else {
          this.massMissingSince.delete(routerId);
          this.alerts?.create({
            routerId,
            level: 'info',
            type: 'voucher.sync.removed',
            title: 'Voucher ditandai dihapus',
            message: `${missingNow.length} voucher tetap tidak ada di router setelah ${graceMin} menit, jadi ditandai dihapus. Bila muncul lagi di router, voucher dipulihkan otomatis.`,
          });
        }
      } else {
        this.massMissingSince.delete(routerId);
      }
      stats.deferred = deferMissing;
      const lockProfiles = new Set(
        this.db.all<{ profile: string }>('SELECT profile FROM profile_meta WHERE router_id = ? AND lock_mac = 1', [routerId]).map((r) => r.profile),
      );

      for (const v of vouchers) {
        const u = userMap.get(v.code);
        const a = activeMap.get(v.code);
        if (!u) {
          if (v.status !== 'removed' && !deferMissing) {
            this.db.run(`UPDATE vouchers SET status = 'removed' WHERE id = ?`, [v.id]);
            stats.missing++;
          }
          continue;
        }
        if (v.status === 'removed') stats.restored++;

        const rawUptime = parseDuration(u.uptime);
        const rawIn = Number(u['bytes-in'] ?? 0);
        const rawOut = Number(u['bytes-out'] ?? 0);
        let { uptime_offset: upOff, bytes_in_offset: inOff, bytes_out_offset: outOff } = v;
        // Counter mundur = tereset di router (reboot tak bersih, update, reset-counters)
        const reset = rawUptime + 5 < v.raw_uptime || rawIn + rawOut < v.raw_bytes_in + v.raw_bytes_out;
        if (reset) {
          upOff += v.raw_uptime;
          inOff += v.raw_bytes_in;
          outOff += v.raw_bytes_out;
          stats.resets++;
        }
        const uptime = upOff + rawUptime;
        const bytesIn = inOff + rawIn;
        const bytesOut = outOff + rawOut;
        const used = !!a || uptime > 0 || bytesIn + bytesOut > 0 || !!v.activated_at;
        let activatedAt = v.activated_at;
        let expiresAt = v.expires_at;
        if (used && !activatedAt) {
          activatedAt = nowIso;
          const validSecs = parseDuration(v.validity);
          expiresAt = validSecs > 0 ? new Date(now + validSecs * 1000).toISOString() : null;
          stats.activated++;
          this.hub.emit('voucher.activated', { routerId, code: v.code, profile: v.profile, price: v.price });
        }
        const timeLimit = parseDuration(v.time_limit);
        const isExpired =
          (expiresAt && Date.parse(expiresAt) <= now) ||
          (timeLimit > 0 && uptime >= timeLimit) ||
          (v.data_limit > 0 && bytesIn + bytesOut >= v.data_limit);

        // Setelah counter tereset, batas di router disesuaikan dengan sisa yang sebenarnya
        if (reset && !isExpired && (timeLimit > 0 || v.data_limit > 0)) {
          const params: Record<string, string> = { '.id': u['.id'] };
          if (timeLimit > 0) params['limit-uptime'] = formatDuration(Math.max(1, timeLimit - upOff));
          if (v.data_limit > 0) params['limit-bytes-total'] = String(Math.max(1, v.data_limit - inOff - outOff));
          await this.routers.exec(routerId, '/ip/hotspot/user/set', params).catch((err) => this.log.warn({ err }, `Gagal menyesuaikan batas voucher ${v.code}`));
        }

        // Kunci ke perangkat pertama yang login (pengganti "Lock User" Mikhmon)
        if (!isExpired && a?.['mac-address'] && !u['mac-address'] && lockProfiles.has(v.profile)) {
          await this.routers
            .exec(routerId, '/ip/hotspot/user/set', { '.id': u['.id'], 'mac-address': a['mac-address'] })
            .catch((err) => this.log.warn({ err }, `Gagal mengunci voucher ${v.code} ke MAC ${a['mac-address']}`));
        }

        let status: VoucherRow['status'] = u.disabled === 'true' ? 'disabled' : a ? 'active' : used ? 'used' : 'unused';
        if (isExpired) {
          status = 'expired';
          stats.expired++;
          try {
            if (a) await this.routers.exec(routerId, '/ip/hotspot/active/remove', { '.id': a['.id'] });
            if (s.voucher.autoRemoveExpired) await this.routers.exec(routerId, '/ip/hotspot/user/remove', { '.id': u['.id'] });
            else if (u.disabled !== 'true') await this.routers.exec(routerId, '/ip/hotspot/user/disable', { '.id': u['.id'] });
          } catch (err) {
            this.log.warn({ err }, `Gagal menghapus voucher kedaluwarsa ${v.code}`);
          }
        }
        this.db.run(
          `UPDATE vouchers SET status = ?, uptime_seconds = ?, bytes_in = ?, bytes_out = ?, activated_at = ?, expires_at = ?,
             mac = COALESCE(NULLIF(?, ''), mac), ip = COALESCE(NULLIF(?, ''), ip), last_seen_at = CASE WHEN ? THEN ? ELSE last_seen_at END,
             router_item_id = ?, raw_uptime = ?, raw_bytes_in = ?, raw_bytes_out = ?, uptime_offset = ?, bytes_in_offset = ?, bytes_out_offset = ?,
             counter_resets = counter_resets + ?
           WHERE id = ?`,
          [status, uptime, bytesIn, bytesOut, activatedAt, expiresAt, a?.['mac-address'] ?? '', a?.address ?? '', a ? 1 : 0, nowIso, u['.id'] ?? v.router_item_id, rawUptime, rawIn, rawOut, upOff, inOff, outOff, reset ? 1 : 0, v.id],
        );
      }
      if (stats.activated || stats.expired || stats.missing || stats.resets || stats.restored) this.hub.emit('vouchers', { routerId });
      return stats;
    } finally {
      this.syncing.delete(routerId);
    }
  }

  async removeVoucher(id: number) {
    const v = this.db.get<VoucherRow>('SELECT * FROM vouchers WHERE id = ?', [id]);
    if (!v) throw new HttpError(404, 'Voucher tidak ditemukan');
    await this.removeFromRouter(v.router_id, [v.code]).catch(() => undefined);
    this.db.run('DELETE FROM vouchers WHERE id = ?', [id]);
    return v;
  }

  private async removeFromRouter(routerId: number, codes: string[]) {
    if (!codes.length) return;
    const set = new Set(codes);
    const [users, active] = await Promise.all([
      this.routers.exec(routerId, '/ip/hotspot/user/print', { '.proplist': '.id,name' }),
      this.routers.exec(routerId, '/ip/hotspot/active/print', { '.proplist': '.id,user' }),
    ]);
    const activeIds = active.filter((a) => set.has(a.user)).map((a) => a['.id']);
    const userIds = users.filter((u) => set.has(u.name)).map((u) => u['.id']);
    for (let i = 0; i < activeIds.length; i += 50) {
      await this.routers.exec(routerId, '/ip/hotspot/active/remove', { '.id': activeIds.slice(i, i + 50).join(',') });
    }
    for (let i = 0; i < userIds.length; i += 50) {
      await this.routers.exec(routerId, '/ip/hotspot/user/remove', { '.id': userIds.slice(i, i + 50).join(',') });
    }
  }

  async deleteBatch(batchId: number, opts: { refund: boolean; actor: string }) {
    const batch = this.db.get<any>('SELECT * FROM voucher_batches WHERE id = ? AND deleted_at IS NULL', [batchId]);
    if (!batch) throw new HttpError(404, 'Batch tidak ditemukan');
    const vouchers = this.db.all<VoucherRow>('SELECT * FROM vouchers WHERE batch_id = ?', [batchId]);
    await this.removeFromRouter(
      batch.router_id,
      vouchers.filter((v) => v.status !== 'removed').map((v) => v.code),
    ).catch((err) => {
      throw new HttpError(502, `Gagal menghapus dari router: ${err.message}`);
    });
    this.db.transaction(() => {
      if (opts.refund && batch.reseller_id && batch.qty > 0) {
        const unused = vouchers.filter((v) => v.status === 'unused').length;
        const refund = (batch.cost / batch.qty) * unused;
        if (refund > 0) {
          const r = this.db.get<{ balance: number }>('SELECT balance FROM resellers WHERE id = ?', [batch.reseller_id]);
          if (r) {
            const balance = r.balance + refund;
            this.db.run('UPDATE resellers SET balance = ? WHERE id = ?', [balance, batch.reseller_id]);
            this.db.run(
              `INSERT INTO reseller_tx (reseller_id, type, amount, balance_after, ref, note, created_by, created_at) VALUES (?, 'refund', ?, ?, ?, ?, ?, ?)`,
              [batch.reseller_id, refund, balance, batch.code, `Refund ${unused} voucher belum terpakai`, opts.actor, new Date().toISOString()],
            );
          }
        }
      }
      // Voucher yang sudah terjual tetap disimpan (status dihapus) agar pendapatannya tetap di laporan
      this.db.run('DELETE FROM vouchers WHERE batch_id = ? AND activated_at IS NULL', [batchId]);
      this.db.run(`UPDATE vouchers SET status = 'removed' WHERE batch_id = ? AND status != 'expired'`, [batchId]);
      this.db.run('UPDATE voucher_batches SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), batchId]);
    });
    return { removed: vouchers.length };
  }

  /**
   * Impor pengguna hotspot yang sudah ada di router (mis. dari Mikhmon) ke database voucher.
   * Harga & masa aktif diambil dari Profil & Harga, atau dari metadata Mikhmon di script on-login.
   * Tanggal habis yang ditulis Mikhmon di komentar user (format lama maupun 7.10+) dipakai apa adanya,
   * agar voucher yang sudah berjalan tidak mendapat masa aktif baru.
   * Voucher yang tanggal habisnya sudah lewat saat diimpor hanya dinonaktifkan di router, tidak dihapus:
   * tanggal itu ditulis script lama yang bisa saja keliru, jadi operator yang memutuskan menghapusnya.
   */
  async importFromRouter(routerId: number, opts: { profile?: string; commentContains?: string; filter?: (u: RosRow) => boolean }) {
    const [users, profiles] = await Promise.all([
      this.routers.exec(routerId, '/ip/hotspot/user/print'),
      this.routers.exec(routerId, '/ip/hotspot/user/profile/print', { '.proplist': 'name,on-login' }).catch(() => [] as RosRow[]),
    ]);
    const mikhmon = new Map(profiles.map((p) => [p.name, parseMikhmonMeta(p['on-login'])]));
    const existing = new Set(this.db.all<{ code: string }>('SELECT code FROM vouchers WHERE router_id = ?', [routerId]).map((r) => r.code));
    const offset = this.settings.get().brand.timezoneOffset;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    let imported = 0;
    let withExpiry = 0;
    let restarted = 0;
    let metaFilled = 0;
    const expiredAtImport: { code: string; id: string }[] = [];
    this.db.transaction(() => {
      // Profil tanpa harga di MIKROTAL: isi dari metadata Mikhmon
      for (const [profile, mm] of mikhmon) {
        if (!mm || !profile) continue;
        if (this.profileMeta(routerId, profile)) continue;
        this.db.run('INSERT INTO profile_meta (router_id, profile, price, reseller_price, validity, lock_mac) VALUES (?, ?, ?, ?, ?, ?)', [
          routerId,
          profile,
          mm.price,
          mm.resellerPrice,
          mm.validity,
          /^enable/i.test(mm.lockUser) ? 1 : 0,
        ]);
        metaFilled++;
      }
      for (const u of users) {
        if (!u.name || existing.has(u.name) || u.name === 'default-trial') continue;
        if (opts.profile && u.profile !== opts.profile) continue;
        if (opts.commentContains && !(u.comment ?? '').toLowerCase().includes(opts.commentContains.toLowerCase())) continue;
        if (opts.filter && !opts.filter(u)) continue;
        const profile = u.profile ?? 'default';
        const meta = this.profileMeta(routerId, profile);
        const mm = mikhmon.get(profile);
        const price = meta?.price || mm?.price || 0;
        const validity = meta?.validity || mm?.validity || '';
        const uptime = parseDuration(u.uptime);
        const bytesIn = Number(u['bytes-in'] ?? 0);
        const bytesOut = Number(u['bytes-out'] ?? 0);
        const used = uptime > 0 || bytesIn + bytesOut > 0;
        const exp = parseRouterDate(u.comment, offset);
        let activatedAt: string | null = null;
        let expiresAt: string | null = null;
        if (exp) {
          // Tanggal habis dari Mikhmon: pakai itu, mundurkan tanggal aktivasi sesuai masa aktif
          expiresAt = exp.toISOString();
          const v = parseDuration(validity);
          activatedAt = new Date(v > 0 ? Math.min(nowMs, exp.getTime() - v * 1000) : nowMs).toISOString();
          withExpiry++;
        } else if (used) {
          // Sudah terpakai tapi tanggal habis tidak terbaca (komentar rusak oleh script lama): hitung mulai sekarang
          activatedAt = now;
          const v = parseDuration(validity);
          expiresAt = v > 0 ? new Date(nowMs + v * 1000).toISOString() : null;
          restarted++;
        }
        const expiredNow = !!expiresAt && Date.parse(expiresAt) <= nowMs;
        if (expiredNow) expiredAtImport.push({ code: u.name, id: u['.id'] ?? '' });
        this.db.run(
          `INSERT INTO vouchers (batch_id, router_id, code, password, profile, price, validity, time_limit, data_limit, status, router_item_id, created_at,
             activated_at, expires_at, uptime_seconds, bytes_in, bytes_out, raw_uptime, raw_bytes_in, raw_bytes_out)
           VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            routerId,
            u.name,
            u.password ?? '',
            profile,
            price,
            validity,
            u['limit-uptime'] ?? '',
            Number(u['limit-bytes-total'] ?? 0),
            expiredNow ? 'expired' : activatedAt ? 'used' : 'unused',
            u['.id'] ?? '',
            now,
            activatedAt,
            expiresAt,
            uptime,
            bytesIn,
            bytesOut,
            uptime,
            bytesIn,
            bytesOut,
          ],
        );
        imported++;
      }
    });
    // Sudah lewat tanggal: putuskan sesi dan nonaktifkan saja (status "expired" tidak disentuh sinkronisasi berikutnya)
    let expiredDisabled = 0;
    if (expiredAtImport.length) {
      const active = await this.routers.exec(routerId, '/ip/hotspot/active/print', { '.proplist': '.id,user' }).catch(() => [] as RosRow[]);
      for (const e of expiredAtImport) {
        try {
          const a = active.find((x) => x.user === e.code);
          if (a) await this.routers.exec(routerId, '/ip/hotspot/active/remove', { '.id': a['.id'] });
          const u = users.find((x) => x.name === e.code);
          if (u?.disabled !== 'true') await this.routers.exec(routerId, '/ip/hotspot/user/disable', { '.id': e.id });
          expiredDisabled++;
        } catch (err) {
          this.log.warn({ err }, `Gagal menonaktifkan voucher kedaluwarsa ${e.code}`);
        }
      }
    }
    if (imported) await this.sync(routerId).catch(() => undefined);
    return { imported, withExpiry, restarted, metaFilled, expiredDisabled };
  }
}
