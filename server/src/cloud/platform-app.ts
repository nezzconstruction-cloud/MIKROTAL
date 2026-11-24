import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { z, ZodError } from 'zod';
import { hashPassword, verifyPassword } from '../lib/security.js';
import { ConnectionError, RouterOSError } from '../lib/routeros/types.js';
import { HttpError } from '../services/vouchers.js';
import type { CloudHost } from './host.js';
import { addMonths, MONTH_OPTIONS, validateSlug } from './platform.js';
import { parseCidr } from './net.js';
import { deriveSecret } from './settings.js';

const DAY = 86400_000;

/** Aplikasi di domain utama: pendaftaran pelanggan dan panel admin platform. */
export async function buildPlatformApp(host: CloudHost) {
  const { platform, vpn } = host;
  const base = host.opts.base;
  const app = Fastify({
    logger: host.opts.logger === false ? false : { level: base.logLevel, base: { tenant: '(platform)' } },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  await app.register(fastifyJwt, { secret: deriveSecret(base.appSecret, 'platform-jwt') });
  await app.register(fastifyRateLimit, { global: false });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue?.path?.join('.');
      return reply.status(400).send({ error: issue ? `${field ? field + ': ' : ''}${issue.message}` : 'Data tidak valid' });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    if (err instanceof RouterOSError) return reply.status(400).send({ error: `CHR: ${err.message}` });
    if (err instanceof ConnectionError) return reply.status(502).send({ error: err.message });
    if (err.statusCode === 429) return reply.status(429).send({ error: 'Terlalu banyak percobaan, tunggu sebentar' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error({ err }, 'Unhandled error');
    return reply.status(500).send({ error: 'Terjadi kesalahan pada server' });
  });

  const admin = async (req: FastifyRequest) => {
    let payload: { sub: number; kind?: string };
    try {
      payload = await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'Sesi berakhir, silakan login kembali');
    }
    const a = payload.kind === 'platform' ? platform.db.get<{ id: number; username: string; name: string }>('SELECT id, username, name FROM platform_admins WHERE id = ?', [payload.sub]) : undefined;
    if (!a) throw new HttpError(401, 'Sesi berakhir, silakan login kembali');
    (req as any).admin = a;
  };
  const who = (req: FastifyRequest) => `admin:${(req as any).admin.username}`;
  const id = (v: unknown) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'ID tidak valid');
    return n;
  };

  // ---------------- publik ----------------
  app.get('/api/platform/info', async () => {
    const s = platform.settings.get();
    return {
      brandName: s.brandName,
      baseDomain: host.opts.baseDomain,
      exampleUrl: host.publicUrl('nama-usaha'),
      plans: platform.plans().map((p) => ({ code: p.code, name: p.name, price_monthly: p.price_monthly, max_routers: p.max_routers, description: p.description })),
      trialDays: s.trialDays,
      trialMaxRouters: s.trialMaxRouters,
      signupOpen: s.signupOpen,
      support: { whatsapp: s.supportWhatsapp, email: s.supportEmail },
    };
  });

  app.get('/api/platform/slug', async (req) => {
    const slug = String((req.query as any)?.slug ?? '').toLowerCase();
    return { slug, url: host.publicUrl(slug), ...platform.slugAvailable(slug) };
  });

  app.post('/api/platform/signup', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    const b = z
      .object({
        businessName: z.string().trim().min(2, 'Nama usaha wajib diisi').max(80),
        slug: z
          .string()
          .trim()
          .toLowerCase()
          .superRefine((s, c) => {
            const err = validateSlug(s);
            if (err) c.addIssue({ code: 'custom', message: err });
          }),
        ownerName: z.string().trim().min(2, 'Nama pemilik wajib diisi').max(80),
        email: z.string().trim().toLowerCase().email('Email tidak valid').max(120),
        phone: z.string().trim().min(8, 'Nomor WhatsApp wajib diisi').max(20),
        username: z
          .string()
          .trim()
          .min(3, 'Username minimal 3 karakter')
          .max(32)
          .regex(/^[a-zA-Z0-9._-]+$/, 'Username hanya huruf, angka, titik, minus, garis bawah'),
        password: z.string().min(8, 'Password minimal 8 karakter').max(128),
      })
      .parse(req.body);
    const t = await host.signup(b);
    return { slug: t.slug, url: host.publicUrl(t.slug), periodEnd: t.period_end };
  });

  // ---------------- admin platform ----------------
  app.post('/api/platform/admin/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
    const a = platform.db.get<any>('SELECT * FROM platform_admins WHERE username = ?', [b.username.trim()]);
    if (!a || !verifyPassword(b.password, a.password_hash)) {
      platform.audit(b.username, 'admin.login.failed', req.ip);
      throw new HttpError(401, 'Username atau password salah');
    }
    platform.db.run('UPDATE platform_admins SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), a.id]);
    platform.audit(`admin:${a.username}`, 'admin.login', req.ip);
    return { token: app.jwt.sign({ sub: a.id, kind: 'platform' } as any, { expiresIn: '12h' }), admin: { username: a.username, name: a.name } };
  });

  app.get('/api/platform/admin/me', { preHandler: admin }, async (req) => (req as any).admin);

  app.post('/api/platform/admin/password', { preHandler: admin }, async (req) => {
    const b = z.object({ current: z.string().min(1), password: z.string().min(10, 'Password baru minimal 10 karakter') }).parse(req.body);
    const a = platform.db.get<any>('SELECT * FROM platform_admins WHERE id = ?', [(req as any).admin.id]);
    if (!verifyPassword(b.current, a.password_hash)) throw new HttpError(400, 'Password lama salah');
    platform.db.run('UPDATE platform_admins SET password_hash = ? WHERE id = ?', [hashPassword(b.password), a.id]);
    platform.audit(who(req), 'admin.password');
    return { ok: true };
  });

  const tenantOut = (t: ReturnType<typeof platform.tenants>[number]) => {
    const inst = host.loaded(t.slug);
    const routers = inst ? inst.ctx.db.get<{ n: number; online: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(status = 'online'), 0) AS online FROM routers WHERE simulate = 0") : undefined;
    return {
      ...t,
      url: host.publicUrl(t.slug),
      state: platform.status(t),
      routers: routers?.n ?? 0,
      routersOnline: routers?.online ?? 0,
      vpnPeers: vpn.peers(t.id).length,
    };
  };

  app.get('/api/platform/admin/overview', { preHandler: admin }, async () => {
    const tenants = platform.tenants();
    const phases: Record<string, number> = {};
    let mrr = 0;
    for (const t of tenants) {
      const st = platform.status(t);
      phases[st.phase] = (phases[st.phase] ?? 0) + 1;
      if (st.phase === 'active' || st.phase === 'grace') mrr += platform.plan(t.plan_id)?.price_monthly ?? 0;
    }
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const paid = platform.db.get<{ total: number; n: number }>("SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM invoices WHERE status = 'paid' AND paid_at >= ?", [monthStart.toISOString()])!;
    const review = platform.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM invoices WHERE status = 'review'")!.n;
    return { tenants: tenants.length, phases, mrr, paidThisMonth: paid.total, paidCountThisMonth: paid.n, invoicesToReview: review, vpn: vpn.readiness() };
  });

  app.get('/api/platform/admin/tenants', { preHandler: admin }, async () => platform.tenants().map(tenantOut));

  app.patch('/api/platform/admin/tenants/:id', { preHandler: admin }, async (req) => {
    const t = platform.requireTenant(id((req.params as any).id));
    const b = z
      .object({
        status: z.enum(['active', 'suspended']).optional(),
        suspended_reason: z.string().max(300).optional(),
        notes: z.string().max(2000).optional(),
        plan_code: z.string().optional(),
        trial: z.boolean().optional(),
        period_end: z.string().datetime().optional(),
        extend_days: z.coerce.number().int().min(-365).max(3650).optional(),
        extend_months: z.coerce.number().int().min(1).max(36).optional(),
      })
      .parse(req.body);
    const patch: Parameters<typeof platform.updateTenant>[1] = {};
    if (b.status) patch.status = b.status;
    if (b.suspended_reason !== undefined) patch.suspended_reason = b.suspended_reason;
    if (b.notes !== undefined) patch.notes = b.notes;
    if (b.trial !== undefined) patch.trial = b.trial ? 1 : 0;
    if (b.plan_code) {
      const p = platform.planByCode(b.plan_code);
      if (!p) throw new HttpError(400, 'Paket tidak ditemukan');
      patch.plan_id = p.id;
    }
    if (b.period_end) patch.period_end = b.period_end;
    const from = Math.max(Date.now(), Date.parse(b.period_end ?? t.period_end));
    if (b.extend_days) patch.period_end = new Date(from + b.extend_days * DAY).toISOString();
    if (b.extend_months) patch.period_end = addMonths(new Date(from).toISOString(), b.extend_months);
    const next = platform.updateTenant(t.id, patch);
    platform.audit(who(req), 'tenant.update', t.slug, b);
    if (b.status === 'suspended') host.notify(t.slug, 'critical', 'Akun dihentikan sementara', b.suspended_reason || 'Hubungi admin MIKROTAL Cloud.');
    if (b.status === 'active' && t.status === 'suspended') host.notify(t.slug, 'info', 'Akun aktif kembali', 'Akun Anda sudah diaktifkan kembali oleh admin.');
    await host.tick();
    return tenantOut(next);
  });

  app.post('/api/platform/admin/tenants/:id/reset-password', { preHandler: admin }, async (req) => {
    const t = platform.requireTenant(id((req.params as any).id));
    const b = z.object({ password: z.string().min(8, 'Password minimal 8 karakter') }).parse(req.body);
    const username = await host.resetOwnerPassword(t, b.password);
    platform.audit(who(req), 'tenant.reset-password', t.slug, { username });
    return { username };
  });

  app.post('/api/platform/admin/tenants/:id/delete', { preHandler: admin }, async (req) => {
    const t = platform.requireTenant(id((req.params as any).id));
    const b = z.object({ confirm: z.string() }).parse(req.body);
    if (b.confirm !== t.slug) throw new HttpError(400, `Ketik "${t.slug}" untuk konfirmasi`);
    await host.deleteTenant(t, who(req));
    return { ok: true };
  });

  app.get('/api/platform/admin/invoices', { preHandler: admin }, async (req) => {
    const status = String((req.query as any)?.status ?? '') || undefined;
    return platform.invoices({ status }).map((i) => ({ ...i, has_proof: !!i.proof_file }));
  });

  app.get('/api/platform/admin/invoices/:id/proof', { preHandler: admin }, async (req, reply: FastifyReply) => {
    const inv = platform.requireInvoice(id((req.params as any).id));
    const p = platform.proofPath(inv);
    if (!p) throw new HttpError(404, 'Bukti transfer tidak ditemukan');
    const ext = path.extname(p).toLowerCase();
    const type = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return reply.header('content-type', type).header('cache-control', 'private, no-store').send(fs.readFileSync(p));
  });

  app.post('/api/platform/admin/invoices/:id/confirm', { preHandler: admin }, async (req) => {
    const r = platform.confirmInvoice(id((req.params as any).id), who(req));
    const end = new Date(r.tenant.period_end).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    host.notify(r.tenant.slug, 'info', 'Pembayaran diterima', `Tagihan ${r.invoice.number} lunas. Langganan aktif sampai ${end}. Terima kasih!`);
    await host.tick();
    return r;
  });

  app.post('/api/platform/admin/invoices/:id/reject', { preHandler: admin }, async (req) => {
    const b = z.object({ reason: z.string().trim().min(3, 'Isi alasan penolakan').max(300) }).parse(req.body);
    const inv = platform.rejectInvoice(id((req.params as any).id), who(req), b.reason);
    const t = platform.requireTenant(inv.tenant_id);
    host.notify(t.slug, 'warning', 'Bukti transfer ditolak', `Tagihan ${inv.number}: ${b.reason}. Unggah ulang bukti yang benar di menu Langganan & VPN.`);
    return inv;
  });

  // ---- paket ----
  const planSchema = z.object({
    code: z.string().trim().regex(/^[a-z0-9-]{2,20}$/, 'Kode 2-20 karakter: huruf kecil, angka, minus'),
    name: z.string().trim().min(1).max(40),
    price_monthly: z.coerce.number().int().min(0),
    max_routers: z.coerce.number().int().min(1).max(1000),
    description: z.string().trim().max(300).default(''),
    active: z.boolean().default(true),
    sort: z.coerce.number().int().default(0),
  });
  app.get('/api/platform/admin/plans', { preHandler: admin }, async () => platform.plans(true).map((p) => ({ ...p, active: !!p.active })));
  app.post('/api/platform/admin/plans', { preHandler: admin }, async (req) => {
    const b = planSchema.parse(req.body);
    if (platform.planByCode(b.code)) throw new HttpError(400, 'Kode paket sudah dipakai');
    platform.db.run('INSERT INTO plans (code, name, price_monthly, max_routers, description, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      b.code,
      b.name,
      b.price_monthly,
      b.max_routers,
      b.description,
      b.active,
      b.sort,
    ]);
    platform.audit(who(req), 'plan.create', b.code, b);
    return { ok: true };
  });
  app.put('/api/platform/admin/plans/:id', { preHandler: admin }, async (req) => {
    const pid = id((req.params as any).id);
    const b = planSchema.omit({ code: true }).parse(req.body);
    // Harga baru berlaku untuk tagihan berikutnya; tagihan yang sudah dibuat tidak berubah
    platform.db.run('UPDATE plans SET name = ?, price_monthly = ?, max_routers = ?, description = ?, active = ?, sort = ? WHERE id = ?', [
      b.name,
      b.price_monthly,
      b.max_routers,
      b.description,
      b.active,
      b.sort,
      pid,
    ]);
    platform.audit(who(req), 'plan.update', String(pid), b);
    return { ok: true };
  });

  // ---- pengaturan ----
  const settingsOut = () => {
    const s = platform.settings.get();
    const { passwordEnc, ipsecSecretEnc, ...chr } = s.chr;
    return { ...s, chr: { ...chr, hasPassword: !!passwordEnc, hasIpsecSecret: !!ipsecSecretEnc }, months: MONTH_OPTIONS };
  };
  app.get('/api/platform/admin/settings', { preHandler: admin }, async () => settingsOut());
  app.put('/api/platform/admin/settings', { preHandler: admin }, async (req) => {
    const b = z
      .object({
        brandName: z.string().trim().min(1).max(60).optional(),
        supportWhatsapp: z.string().trim().max(30).optional(),
        supportEmail: z.string().trim().max(120).optional(),
        trialDays: z.coerce.number().int().min(0).max(90).optional(),
        trialMaxRouters: z.coerce.number().int().min(1).max(100).optional(),
        graceDays: z.coerce.number().int().min(0).max(30).optional(),
        invoiceDays: z.coerce.number().int().min(1).max(30).optional(),
        bankAccounts: z
          .array(z.object({ bank: z.string().trim().min(1).max(40), number: z.string().trim().min(3).max(40), holder: z.string().trim().min(1).max(80) }))
          .max(10)
          .optional(),
        paymentNote: z.string().max(500).optional(),
        demoForNewTenants: z.boolean().optional(),
        signupOpen: z.boolean().optional(),
        chr: z
          .object({
            host: z.string().trim().max(255).optional(),
            port: z.coerce.number().int().min(1).max(65535).optional(),
            username: z.string().trim().max(64).optional(),
            password: z.string().max(256).optional(),
            tls: z.boolean().optional(),
            simulate: z.boolean().optional(),
            endpoint: z.string().trim().max(255).optional(),
            wgInterface: z.string().trim().max(32).optional(),
            wgPort: z.coerce.number().int().min(1).max(65535).optional(),
            pppProfile: z.string().trim().max(32).optional(),
            sstpPort: z.coerce.number().int().min(1).max(65535).optional(),
            tunnelNetwork: z.string().trim().optional(),
          })
          .optional(),
      })
      .parse(req.body);
    const { chr, ...rest } = b;
    const chrPatch: Record<string, unknown> = {};
    if (chr) {
      const { password, ...c } = chr;
      Object.assign(chrPatch, c);
      if (password) chrPatch.passwordEnc = platform.box.encrypt(password);
      if (c.tunnelNetwork && c.tunnelNetwork !== platform.settings.get().chr.tunnelNetwork) {
        parseCidr(c.tunnelNetwork);
        if (platform.db.get('SELECT id FROM vpn_peers LIMIT 1')) throw new HttpError(400, 'Jaringan tunnel tidak bisa diubah setelah ada router yang terhubung');
      }
    }
    platform.settings.update({ ...rest, ...(chr ? { chr: chrPatch as any } : {}) });
    vpn.resetConnection();
    platform.audit(who(req), 'settings.update', '', { ...b, chr: chr ? { ...chr, password: chr.password ? '***' : undefined } : undefined });
    return settingsOut();
  });

  app.post('/api/platform/admin/chr/test', { preHandler: admin }, async () => {
    vpn.resetConnection();
    return vpn.testChr();
  });
  app.post('/api/platform/admin/chr/setup', { preHandler: admin }, async (req) => {
    const r = await vpn.setupChr();
    platform.audit(who(req), 'chr.setup');
    return r;
  });

  app.get('/api/platform/admin/audit', { preHandler: admin }, async () => platform.db.all('SELECT * FROM platform_audit ORDER BY id DESC LIMIT 300'));

  // ---- frontend platform (web/dist/platform.html) ----
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = base.webDist ?? [path.resolve(here, '../../../web/dist'), path.resolve(here, '../../web/dist'), path.resolve(process.cwd(), 'web/dist')].find((p) => fs.existsSync(path.join(p, 'platform.html')));
  if (webDist && fs.existsSync(path.join(webDist, 'platform.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', index: false });
    const page = (_req: FastifyRequest, reply: FastifyReply) => reply.sendFile('platform.html');
    app.get('/', page);
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.status(404).send({ error: 'Endpoint tidak ditemukan' }) : page(req, reply)));
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Endpoint tidak ditemukan' }));
  }

  return app;
}
