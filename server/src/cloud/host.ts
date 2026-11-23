import http from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { buildApp, startJobs } from '../app.js';
import type { AppConfig } from '../config.js';
import type { AppContext } from '../context.js';
import { hashPassword } from '../lib/security.js';
import { HttpError } from '../services/vouchers.js';
import type { TenantCloud } from './bridge.js';
import { resolveAllowedHost } from './net.js';
import { Platform, type TenantRow, type TenantStatus } from './platform.js';
import { buildPlatformApp } from './platform-app.js';
import { randomToken, VpnService } from './vpn.js';

export interface CloudOptions {
  /** Konfigurasi dasar aplikasi (log, web dist, dsb). dataDir menjadi akar data semua pelanggan. */
  base: AppConfig;
  /** Domain utama, mis. mikrotal.id. Pelanggan di <alamat>.mikrotal.id. Untuk uji lokal: localhost. */
  baseDomain: string;
  /** Skema & port URL publik (untuk tautan di email/halaman). */
  publicScheme: 'http' | 'https';
  publicPort?: number;
  platformAdminUsername: string;
  platformAdminPassword: string;
  /** Tanpa tugas latar (sinkron voucher, monitor, tagihan) — untuk tes. */
  disableJobs?: boolean;
  logger?: boolean;
  /** Database platform di memori (tes). */
  inMemory?: boolean;
}

interface Instance {
  slug: string;
  app: FastifyInstance;
  ctx: AppContext;
  jobs: boolean;
}

const STAGE_RANK: Record<string, number> = { '': 0, d7: 1, d3: 2, d1: 3, grace: 4, expired: 5 };

export class CloudHost {
  readonly platform: Platform;
  readonly vpn: VpnService;
  platformApp!: FastifyInstance;
  readonly server: http.Server;
  private instances = new Map<string, Instance>();
  private loading = new Map<string, Promise<Instance>>();
  private timer?: NodeJS.Timeout;

  constructor(readonly opts: CloudOptions) {
    this.platform = new Platform({
      dataDir: opts.base.dataDir,
      masterSecret: opts.base.appSecret,
      dbFile: opts.inMemory ? ':memory:' : undefined,
      adminUsername: opts.platformAdminUsername,
      adminPassword: opts.platformAdminPassword,
    });
    this.vpn = new VpnService(this.platform);
    this.server = http.createServer((req, res) => void this.handle(req, res));
    this.server.on('upgrade', (req, socket, head) => void this.upgrade(req, socket, head));
  }

  async init() {
    this.platformApp = await buildPlatformApp(this);
    await this.platformApp.ready();
    for (const t of this.platform.tenants()) {
      await this.instance(t.slug).catch((err) => this.platformApp.log.error({ err, tenant: t.slug }, 'Gagal memuat pelanggan'));
    }
    if (!this.opts.disableJobs) {
      await this.tick();
      this.timer = setInterval(() => void this.tick().catch((err) => this.platformApp.log.error({ err }, 'tick gagal')), 60_000);
      this.timer.unref();
    }
    return this;
  }

  async listen(port: number, host: string) {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => resolve());
    });
  }

  publicUrl(slug?: string) {
    const port = this.opts.publicPort && ![80, 443].includes(this.opts.publicPort) ? `:${this.opts.publicPort}` : '';
    return `${this.opts.publicScheme}://${slug ? `${slug}.` : ''}${this.opts.baseDomain}${port}`;
  }

  /** "platform" untuk domain utama, slug pelanggan untuk subdomain, null bila bukan domain kita. */
  route(hostHeader: string | undefined): { kind: 'platform' } | { kind: 'tenant'; slug: string } | null {
    const host = (hostHeader ?? '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    const base = this.opts.baseDomain.toLowerCase();
    if (host === base || host === `www.${base}` || host === `app.${base}`) return { kind: 'platform' };
    if (host.endsWith(`.${base}`)) {
      const sub = host.slice(0, -(base.length + 1));
      if (/^[a-z0-9-]+$/.test(sub)) return { kind: 'tenant', slug: sub };
    }
    return null;
  }

  private async target(req: http.IncomingMessage): Promise<FastifyInstance | null> {
    const r = this.route(req.headers.host);
    if (!r) return null;
    if (r.kind === 'platform') return this.platformApp;
    const t = this.platform.tenantBySlug(r.slug);
    if (!t || t.status === 'deleted') return null;
    return (await this.instance(r.slug)).app;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const app = await this.target(req);
      if (app) return app.routing(req, res);
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Tidak ditemukan</title><body style="font-family:system-ui;padding:40px;text-align:center"><h2>Alamat tidak terdaftar</h2><p>Periksa kembali alamat MIKROTAL Anda, atau daftar di <a href="${this.publicUrl()}">${this.publicUrl()}</a>.</p></body>`,
      );
    } catch (err) {
      this.platformApp?.log.error({ err }, 'Gagal meneruskan permintaan');
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Terjadi kesalahan pada server' }));
    }
  }

  private async upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
    try {
      const app = await this.target(req);
      if (!app || app === this.platformApp) return socket.destroy();
      app.server.emit('upgrade', req, socket, head);
    } catch {
      socket.destroy();
    }
  }

  bridge(slug: string): TenantCloud {
    const platform = this.platform;
    const vpn = this.vpn;
    const tenant = () => {
      const t = platform.tenantBySlug(slug);
      if (!t) throw new HttpError(404, 'Pelanggan tidak ditemukan');
      return t;
    };
    return {
      slug,
      platform,
      vpn,
      tenant,
      status: () => platform.status(tenant()),
      resolveRouterHost: (host) => resolveAllowedHost(host, () => vpn.tunnelIps(tenant().id)),
      publicUrl: this.publicUrl(slug),
    };
  }

  /** Muat aplikasi satu pelanggan (sekali; berikutnya dari cache). */
  async instance(slug: string, firstAdmin?: { username: string; password: string; name: string }): Promise<Instance> {
    const cached = this.instances.get(slug);
    if (cached) return cached;
    const inflight = this.loading.get(slug);
    if (inflight) return inflight;
    const p = (async () => {
      const s = this.platform.settings.get();
      const { app, ctx } = await buildApp({
        logger: this.opts.logger,
        cloud: this.bridge(slug),
        config: {
          ...this.opts.base,
          dataDir: this.platform.tenantDataDir(slug),
          dbFile: this.opts.inMemory ? ':memory:' : undefined,
          appSecret: this.platform.tenantSecret(slug),
          adminUsername: firstAdmin?.username ?? 'admin',
          adminPassword: firstAdmin?.password ?? randomToken(24),
          seedDemo: s.demoForNewTenants && !!firstAdmin,
          disableJobs: true,
        },
      });
      if (firstAdmin) ctx.db.run("UPDATE users SET name = ? WHERE role = 'superadmin'", [firstAdmin.name]);
      await app.ready();
      const inst: Instance = { slug, app, ctx, jobs: false };
      this.instances.set(slug, inst);
      this.syncJobs(inst);
      return inst;
    })();
    this.loading.set(slug, p);
    try {
      return await p;
    } finally {
      this.loading.delete(slug);
    }
  }

  loaded(slug: string) {
    return this.instances.get(slug);
  }

  /** Tugas otomatis (sinkron voucher, isolir, monitor, backup) hanya jalan selama langganan aktif. */
  private syncJobs(inst: Instance, st?: TenantStatus) {
    if (this.opts.disableJobs) return;
    const status = st ?? this.bridge(inst.slug).status();
    if (status.canUse && !inst.jobs) {
      startJobs(inst.ctx);
      inst.jobs = true;
    } else if (!status.canUse && inst.jobs) {
      inst.ctx.monitor.stop();
      inst.ctx.vouchers.stop();
      inst.ctx.pppoe.stop();
      inst.ctx.backup.stop();
      inst.jobs = false;
    }
  }

  async unload(slug: string) {
    const inst = this.instances.get(slug);
    if (!inst) return;
    this.instances.delete(slug);
    await inst.app.close();
  }

  /** Pendaftaran: buat data pelanggan dan akun pemilik (superadmin di aplikasinya sendiri). */
  async signup(input: { slug: string; businessName: string; ownerName: string; email: string; phone: string; username: string; password: string }) {
    if (!this.platform.settings.get().signupOpen) throw new HttpError(403, 'Pendaftaran sedang ditutup');
    const t = this.platform.createTenant(input);
    try {
      await this.instance(t.slug, { username: input.username, password: input.password, name: input.ownerName });
    } catch (err) {
      this.platform.db.run('DELETE FROM tenants WHERE id = ?', [t.id]);
      throw err;
    }
    this.platform.audit(input.email, 'tenant.signup', t.slug);
    this.notify(t.slug, 'info', 'Selamat datang di MIKROTAL Cloud', `Masa uji coba ${this.platform.settings.get().trialDays} hari dimulai. Hubungkan router lewat menu Langganan & VPN.`);
    return t;
  }

  /** Kirim notifikasi ke aplikasi pelanggan (muncul di lonceng & Telegram bila diatur). */
  notify(slug: string, level: 'info' | 'warning' | 'critical', title: string, message: string) {
    const inst = this.instances.get(slug);
    inst?.ctx.alerts.create({ level, type: 'cloud.subscription', title, message });
  }

  async resetOwnerPassword(t: TenantRow, password: string) {
    const inst = await this.instance(t.slug);
    const owner = inst.ctx.db.get<{ id: number; username: string }>("SELECT id, username FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1");
    if (!owner) throw new HttpError(404, 'Akun pemilik tidak ditemukan');
    inst.ctx.db.run('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?', [hashPassword(password), owner.id]);
    return owner.username;
  }

  async deleteTenant(t: TenantRow, actor: string) {
    await this.vpn.removeAll(t);
    this.platform.updateTenant(t.id, { status: 'deleted' });
    await this.unload(t.slug);
    this.platform.audit(actor, 'tenant.delete', t.slug);
  }

  /** Setiap menit: batalkan tagihan kedaluwarsa, nyalakan/hentikan tugas otomatis, kirim pengingat. */
  async tick(now = Date.now()) {
    this.platform.expireInvoices(new Date(now).toISOString());
    for (const t of this.platform.tenants()) {
      const st = this.platform.status(t, now);
      const inst = this.instances.get(t.slug);
      if (inst) this.syncJobs(inst, st);
      const stage =
        st.phase === 'expired'
          ? 'expired'
          : st.phase === 'grace'
            ? 'grace'
            : st.phase === 'trial' || st.phase === 'active'
              ? st.daysLeft <= 1
                ? 'd1'
                : st.daysLeft <= 3
                  ? 'd3'
                  : st.daysLeft <= 7
                    ? 'd7'
                    : ''
              : '';
      if (!stage || STAGE_RANK[stage] <= (STAGE_RANK[t.reminder_stage] ?? 0)) continue;
      this.platform.setReminderStage(t.id, stage);
      const end = new Date(st.periodEnd).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      if (stage === 'expired') this.notify(t.slug, 'critical', 'Langganan berhenti', 'Masa tenggang berakhir. Sinkronisasi voucher, isolir otomatis, dan monitoring dihentikan sampai tagihan dibayar.');
      else if (stage === 'grace')
        this.notify(t.slug, 'critical', 'Masa langganan habis', `Langganan berakhir ${end}. Bayar sebelum ${new Date(st.graceEnd).toLocaleDateString('id-ID')} agar layanan tidak berhenti.`);
      else this.notify(t.slug, 'warning', `${st.trial ? 'Masa uji coba' : 'Langganan'} berakhir ${st.daysLeft} hari lagi`, `Berakhir ${end}. Perpanjang di menu Langganan & VPN.`);
    }
  }

  async close() {
    clearInterval(this.timer);
    for (const slug of [...this.instances.keys()]) await this.unload(slug);
    await this.platformApp?.close();
    this.vpn.close();
    this.platform.close();
    await new Promise<void>((r) => (this.server.listening ? this.server.close(() => r()) : r()));
  }
}
