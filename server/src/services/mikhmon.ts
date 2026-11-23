import type { DB } from '../db/index.js';
import { isExpiryScheduler, isMikhmonVoucher, parseMikhmonMeta, parseRouterDate } from '../lib/mikhmon.js';
import type { RouterManager } from './routers.js';
import type { SettingsService } from './settings.js';
import type { VoucherService } from './vouchers.js';
import { HttpError } from './vouchers.js';

/**
 * Pindah dari Mikhmon: impor voucher beserta tanggal habisnya, lalu nonaktifkan script Mikhmon
 * (on-login profil user & scheduler pengecek kedaluwarsa) agar masa aktif diatur MIKROTAL.
 * Script asli disimpan dan bisa dikembalikan.
 */
export class MikhmonService {
  constructor(
    private readonly db: DB,
    private readonly routers: RouterManager,
    private readonly settings: SettingsService,
    private readonly vouchers: VoucherService,
  ) {}

  backups(routerId: number) {
    return this.db.all<{ kind: 'profile' | 'scheduler'; name: string; value: string; created_at: string }>('SELECT kind, name, value, created_at FROM mikhmon_backups WHERE router_id = ? ORDER BY kind, name', [routerId]);
  }

  async detect(routerId: number) {
    this.routers.require(routerId);
    const [profiles, schedulers, users] = await Promise.all([
      this.routers.exec(routerId, '/ip/hotspot/user/profile/print', { '.proplist': '.id,name,on-login' }).catch(() => []),
      this.routers.exec(routerId, '/system/scheduler/print', { '.proplist': '.id,name,on-event,interval,disabled' }).catch(() => []),
      this.routers.exec(routerId, '/ip/hotspot/user/print', { '.proplist': 'name,comment,uptime,profile' }).catch(() => []),
    ]);
    const offset = this.settings.get().brand.timezoneOffset;
    const tracked = new Set(this.db.all<{ code: string }>('SELECT code FROM vouchers WHERE router_id = ?', [routerId]).map((r) => r.code));
    const mProfiles = profiles
      .map((p) => ({ name: p.name, meta: parseMikhmonMeta(p['on-login']), hasScript: !!(p['on-login'] ?? '').trim() }))
      .filter((p) => p.meta);
    const names = new Set(mProfiles.map((p) => p.name));
    const mSched = schedulers.filter((s) => isExpiryScheduler(s, names)).map((s) => ({ name: s.name, interval: s.interval ?? '', disabled: s.disabled === 'true' }));
    const now = Date.now();
    let datedFuture = 0;
    let datedPast = 0;
    let badComment = 0;
    let vouchers = 0;
    for (const u of users) {
      if (u.name === 'default-trial') continue;
      if (isMikhmonVoucher(u.comment, offset)) vouchers++;
      const c = (u.comment ?? '').trim();
      const d = parseRouterDate(c, offset);
      if (d) d.getTime() > now ? datedFuture++ : datedPast++;
      else if (/\d{4}|\/\d{2}\//.test(c) && !/^vc-|^up-/i.test(c)) badComment++;
    }
    const backups = this.backups(routerId);
    return {
      detected: mProfiles.length > 0 || mSched.length > 0,
      profiles: mProfiles.map((p) => ({ name: p.name, ...p.meta!, scriptActive: p.hasScript })),
      schedulers: mSched,
      users: {
        total: users.filter((u) => u.name !== 'default-trial').length,
        untracked: users.filter((u) => u.name !== 'default-trial' && !tracked.has(u.name)).length,
        vouchers,
        vouchersUntracked: users.filter((u) => u.name !== 'default-trial' && !tracked.has(u.name) && isMikhmonVoucher(u.comment, offset)).length,
        datedFuture,
        datedPast,
        badComment,
      },
      takenOver: backups.length > 0,
      autoRemoveExpired: this.settings.get().voucher.autoRemoveExpired,
      backups: backups.map((b) => ({ kind: b.kind, name: b.name, at: b.created_at })),
    };
  }

  /** Impor semua user hotspot, lalu (bila diminta) nonaktifkan script Mikhmon dengan cadangan. */
  async takeover(routerId: number, opts: { disableScripts: boolean }) {
    const info = await this.detect(routerId);
    const offset = this.settings.get().brand.timezoneOffset;
    // hanya voucher Mikhmon; akun member tetap tidak disentuh
    const imported = await this.vouchers.importFromRouter(routerId, { filter: (u) => isMikhmonVoucher(u.comment, offset) });
    const steps: string[] = [
      `${imported.imported} voucher Mikhmon diimpor (${imported.withExpiry} dengan tanggal habis dari Mikhmon, ${imported.restarted} terpakai tanpa tanggal terbaca → masa aktif dihitung mulai sekarang)`,
    ];
    if (imported.expiredDisabled)
      steps.push(`${imported.expiredDisabled} voucher yang tanggal habisnya sudah lewat hanya dinonaktifkan, tidak dihapus. Periksa dulu di daftar voucher sebelum menghapusnya`);
    if (imported.metaFilled) steps.push(`${imported.metaFilled} profil diberi harga & masa aktif dari data Mikhmon`);
    if (!opts.disableScripts) return { steps, imported };

    // Fitur "Lock User" Mikhmon ada di script on-login yang akan dikosongkan: MIKROTAL yang mengunci MAC
    const locked = info.profiles.filter((p) => /^enable/i.test(p.lockUser));
    for (const p of locked) {
      this.db.run(
        `INSERT INTO profile_meta (router_id, profile, price, reseller_price, validity, lock_mac) VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(router_id, profile) DO UPDATE SET lock_mac = 1`,
        [routerId, p.name, p.price, p.resellerPrice, p.validity],
      );
    }

    const now = new Date().toISOString();
    const save = (kind: 'profile' | 'scheduler', name: string, value: string) =>
      this.db.run(
        `INSERT INTO mikhmon_backups (router_id, kind, name, value, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(router_id, kind, name) DO NOTHING`,
        [routerId, kind, name, value, now],
      );
    const profiles = await this.routers.exec(routerId, '/ip/hotspot/user/profile/print', { '.proplist': '.id,name,on-login' });
    let cleared = 0;
    for (const p of profiles) {
      if (!info.profiles.some((x) => x.name === p.name) || !(p['on-login'] ?? '').trim()) continue;
      save('profile', p.name, p['on-login'] ?? '');
      await this.routers.exec(routerId, '/ip/hotspot/user/profile/set', { '.id': p['.id'], 'on-login': '' });
      cleared++;
    }
    const schedulers = await this.routers.exec(routerId, '/system/scheduler/print', { '.proplist': '.id,name,disabled' });
    let disabled = 0;
    for (const s of schedulers) {
      if (!info.schedulers.some((x) => x.name === s.name) || s.disabled === 'true') continue;
      save('scheduler', s.name, 'enabled');
      await this.routers.exec(routerId, '/system/scheduler/disable', { '.id': s['.id'] });
      disabled++;
    }
    steps.push(`Script on-login Mikhmon dikosongkan di ${cleared} profil dan ${disabled} scheduler dinonaktifkan (cadangan disimpan di MIKROTAL)`);
    if (locked.length) steps.push(`Kunci MAC (Lock User Mikhmon) kini dijalankan MIKROTAL untuk profil ${locked.map((p) => p.name).join(', ')}`);
    const autoRemove = this.settings.get().voucher.autoRemoveExpired;
    steps.push(`Masa aktif voucher kini diatur MIKROTAL. Voucher yang habis selanjutnya akan ${autoRemove ? 'dihapus' : 'dinonaktifkan'} dari router (Pengaturan → Voucher)`);
    const notifyOnly = info.profiles.filter((p) => /^ntf/i.test(p.expMode));
    if (autoRemove && notifyOnly.length)
      steps.push(`Perhatian: profil ${notifyOnly.map((p) => p.name).join(', ')} di Mikhmon diatur hanya memberi tahu saat habis, tetapi MIKROTAL diatur menghapus voucher habis. Matikan "hapus otomatis" di Pengaturan bila ingin tetap seperti Mikhmon`);
    return { steps, imported };
  }

  async restore(routerId: number) {
    const backups = this.backups(routerId);
    if (!backups.length) throw new HttpError(400, 'Tidak ada cadangan script Mikhmon untuk router ini');
    const [profiles, schedulers] = await Promise.all([
      this.routers.exec(routerId, '/ip/hotspot/user/profile/print', { '.proplist': '.id,name' }),
      this.routers.exec(routerId, '/system/scheduler/print', { '.proplist': '.id,name' }),
    ]);
    let restored = 0;
    const missing: string[] = [];
    for (const b of backups) {
      const list = b.kind === 'profile' ? profiles : schedulers;
      const item = list.find((x) => x.name === b.name);
      if (!item) {
        missing.push(b.name);
        continue;
      }
      if (b.kind === 'profile') await this.routers.exec(routerId, '/ip/hotspot/user/profile/set', { '.id': item['.id'], 'on-login': b.value });
      else await this.routers.exec(routerId, '/system/scheduler/enable', { '.id': item['.id'] });
      restored++;
    }
    this.db.run('DELETE FROM mikhmon_backups WHERE router_id = ?', [routerId]);
    return { restored, missing };
  }
}
