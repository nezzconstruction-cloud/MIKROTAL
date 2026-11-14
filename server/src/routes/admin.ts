import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFrom, makeAuth, type AppContext } from '../context.js';
import { formatDuration, parseDuration } from '../lib/duration.js';
import { sendTelegram } from '../services/alerts.js';
import { isMasked } from '../services/settings.js';
import { HttpError } from '../services/vouchers.js';
import { dayRange, salesReport, todayLocal } from './business.js';

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = makeAuth(ctx);

  app.get('/api/dashboard', { preHandler: auth() }, async (req) => {
    const s = ctx.settings.get();
    const off = s.brand.timezoneOffset;
    const today = todayLocal(off);
    const monthStart = today.slice(0, 8) + '01';
    const d7 = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
    const isReseller = req.user.role === 'reseller';
    const resellerId = isReseller ? req.user.reseller_id ?? -1 : undefined;

    const week = salesReport(ctx, { from: d7, to: today, resellerId });
    const month = salesReport(ctx, { from: monthStart, to: today, resellerId });
    const todayRow = week.daily[week.daily.length - 1];

    const vf = isReseller ? 'WHERE reseller_id = ?' : '';
    const vp = isReseller ? [resellerId] : [];
    const counts = Object.fromEntries(
      ctx.db.all<{ status: string; n: number }>(`SELECT status, COUNT(*) AS n FROM vouchers ${vf} GROUP BY status`, vp).map((r) => [r.status, r.n]),
    );

    const { start } = dayRange(today, today, off);
    const activatedToday = ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vouchers WHERE activated_at >= ? ${isReseller ? 'AND reseller_id = ?' : ''}`,
      [start, ...vp],
    )!.n;

    const routers = isReseller
      ? []
      : ctx.routers.list().map((r) => ({
          id: r.id,
          name: r.name,
          location: r.location,
          status: r.status,
          status_message: r.status_message,
          enabled: !!r.enabled,
          simulate: !!r.simulate,
          snapshot: ctx.monitor.latest.get(r.id) ?? null,
        }));
    const online = routers.filter((r) => r.snapshot?.online).length;
    const reseller = isReseller ? ctx.db.get('SELECT * FROM resellers WHERE id = ?', [resellerId]) : null;
    const topProfiles = month.byProfile.slice(0, 5);

    return {
      routers,
      totals: {
        routers: routers.length,
        online,
        offline: routers.filter((r) => r.enabled && r.snapshot && !r.snapshot.online).length,
        hotspotActive: routers.reduce((sum, r) => sum + (r.snapshot?.hotspotActive ?? 0), 0),
        pppActive: routers.reduce((sum, r) => sum + (r.snapshot?.pppActive ?? 0), 0),
        rx: routers.reduce((sum, r) => sum + (r.snapshot?.rx ?? 0), 0),
        tx: routers.reduce((sum, r) => sum + (r.snapshot?.tx ?? 0), 0),
      },
      revenue: {
        today: (todayRow?.direct ?? 0) + (todayRow?.reseller ?? 0) + (todayRow?.pppoe ?? 0),
        week: week.totals.total,
        month: month.totals.total,
        daily: week.daily,
      },
      vouchers: { ...counts, activatedToday },
      pppoe: isReseller ? null : ctx.pppoe.summary(),
      topProfiles,
      alerts: isReseller ? [] : ctx.alerts.list({ limit: 8 }),
      unreadAlerts: isReseller ? 0 : ctx.alerts.unreadCount(),
      reseller,
    };
  });

  // ---- Alert ----
  app.get('/api/alerts', { preHandler: auth('router.view') }, async (req) => {
    const q = req.query as any;
    return { rows: ctx.alerts.list({ limit: Number(q.limit ?? 100), unread: q.unread === '1', routerId: q.routerId ? Number(q.routerId) : undefined }), unread: ctx.alerts.unreadCount() };
  });

  app.post('/api/alerts/read-all', { preHandler: auth('router.view') }, async () => {
    ctx.alerts.markAllRead();
    return { ok: true };
  });

  // ---- Audit log ----
  app.get('/api/audit', { preHandler: auth('audit.view') }, async (req) => {
    const q = req.query as any;
    const where: string[] = [];
    const params: any[] = [];
    if (q.q) {
      where.push('(username LIKE ? OR action LIKE ? OR target LIKE ?)');
      params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
    }
    const limit = Math.min(Number(q.limit ?? 200), 1000);
    return ctx.db.all(`SELECT * FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`, [...params, limit]);
  });

  // ---- Pengaturan ----
  app.get('/api/settings', { preHandler: auth() }, async (req) => {
    const pub = ctx.settings.public();
    if (req.user.role !== 'superadmin') {
      pub.alerts.telegram = { enabled: pub.alerts.telegram.enabled, botToken: '', chatId: '' };
    }
    return pub;
  });

  const settingsSchema = z.object({
    brand: z
      .object({
        name: z.string().trim().min(1).max(40),
        tagline: z.string().max(80),
        currency: z.string().max(8),
        phone: z.string().max(40),
        address: z.string().max(200),
        timezoneOffset: z.number().int().min(-720).max(840),
      })
      .partial()
      .optional(),
    monitor: z
      .object({ pollSeconds: z.number().int().min(3).max(600), metricsEverySeconds: z.number().int().min(10).max(3600), retentionDays: z.number().int().min(1).max(365) })
      .partial()
      .optional(),
    alerts: z
      .object({
        cpu: z.number().min(0).max(100),
        memory: z.number().min(0).max(100),
        temperature: z.number().min(0).max(150),
        offline: z.boolean(),
        interfaceDown: z.boolean(),
        telegram: z.object({ enabled: z.boolean(), botToken: z.string().max(200), chatId: z.string().max(64) }).partial(),
      })
      .partial()
      .optional(),
    voucher: z
      .object({
        syncSeconds: z.number().int().min(15).max(3600),
        autoRemoveExpired: z.boolean(),
        defaultCharset: z.string(),
        defaultLength: z.number().int().min(3).max(16),
        defaultPrefix: z.string().max(10),
        loginUrl: z.string().max(200),
      })
      .partial()
      .optional(),
    pppoe: z
      .object({
        isolirProfile: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/, 'Nama profil hanya huruf, angka, titik, strip'),
        isolirPool: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/),
        isolirPoolRange: z.string().trim().max(80).regex(/^[0-9.,\-\/ ]+$/, 'Rentang IP tidak valid'),
        isolirGateway: z.string().trim().max(40).regex(/^[0-9.]+$/, 'Alamat IP tidak valid'),
        portalAddress: z.string().trim().max(40).regex(/^[0-9.]*$/, 'Alamat IP tidak valid'),
        portalPort: z.number().int().min(1).max(65535),
        remindDays: z.number().int().min(0).max(30),
        voucherLength: z.number().int().min(6).max(16),
        voucherCharset: z.enum(['numeric', 'alnum-upper']),
        voucherPrefix: z.string().trim().max(6).regex(/^[A-Za-z0-9]*$/),
        topupUrl: z.string().trim().max(200),
        odpDownAlert: z.boolean(),
      })
      .partial()
      .optional(),
    backup: z.object({ enabled: z.boolean(), hour: z.number().int().min(0).max(23) }).partial().optional(),
  });

  app.put('/api/settings', { preHandler: auth('settings.manage') }, async (req) => {
    const b = settingsSchema.parse(req.body);
    if (b.alerts?.telegram?.botToken !== undefined && isMasked(b.alerts.telegram.botToken)) delete b.alerts.telegram.botToken;
    ctx.settings.update(b);
    auditFrom(ctx, req, 'settings.update', '', Object.keys(b));
    return ctx.settings.public();
  });

  app.post('/api/settings/telegram/test', { preHandler: auth('settings.manage') }, async (req) => {
    const b = z.object({ botToken: z.string().optional(), chatId: z.string().optional() }).parse(req.body ?? {});
    const cur = ctx.settings.get().alerts.telegram;
    const token = b.botToken && !isMasked(b.botToken) ? b.botToken : cur.botToken;
    const chatId = b.chatId || cur.chatId;
    if (!token || !chatId) throw new HttpError(400, 'Isi Bot Token dan Chat ID terlebih dahulu');
    try {
      await sendTelegram(token, chatId, `✅ <b>${ctx.settings.get().brand.name}</b>\nNotifikasi Telegram berhasil terhubung.`);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    return { ok: true };
  });

  // ---- Utilitas ----
  app.get('/api/util/duration', { preHandler: auth() }, async (req) => {
    const v = String((req.query as any).v ?? '');
    const secs = parseDuration(v);
    return { seconds: secs, formatted: formatDuration(secs) };
  });
}
