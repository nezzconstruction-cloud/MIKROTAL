import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppContext } from '../context.js';
import { hasPermission, type Role } from '../lib/security.js';
import { parseDuration } from '../lib/duration.js';
import { HttpError } from '../services/vouchers.js';
import crypto from 'node:crypto';
import { z } from 'zod';

function maskName(name: string) {
  return name
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w : w[0] + '*'.repeat(Math.min(w.length - 2, 6)) + w[w.length - 1]))
    .join(' ');
}

function publicCustomer(c: any) {
  return {
    username: c.username,
    name: maskName(c.name ?? ''),
    package: c.package_name ?? '',
    price: c.package_price ?? 0,
    status: c.status,
    expires_at: c.expires_at,
    online: !!c.online,
  };
}

export async function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  app.get('/api/public/brand', async () => {
    const b = ctx.settings.get().brand;
    return { name: b.name, tagline: b.tagline, phone: b.phone, currency: b.currency };
  });

  /** Cek status voucher oleh pelanggan (tanpa login). */
  app.get(
    '/api/public/voucher/:code',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const code = String((req.params as any).code ?? '').trim();
      if (!code || code.length > 32) throw new HttpError(400, 'Kode tidak valid');
      const v = ctx.db.get<any>('SELECT * FROM vouchers WHERE code = ? ORDER BY id DESC LIMIT 1', [code]);
      if (!v) throw new HttpError(404, 'Voucher tidak ditemukan');
      const timeLimit = parseDuration(v.time_limit);
      return {
        code: v.code,
        profile: v.profile,
        status: v.status,
        price: v.price,
        validity: v.validity,
        activated_at: v.activated_at,
        expires_at: v.expires_at,
        time_limit: v.time_limit,
        time_used: v.uptime_seconds,
        time_left: timeLimit ? Math.max(0, timeLimit - v.uptime_seconds) : null,
        data_limit: v.data_limit,
        data_used: v.bytes_in + v.bytes_out,
      };
    },
  );

  /** Cek masa aktif PPPoE oleh pelanggan (tanpa login). Nama disamarkan. */
  app.get('/api/public/pppoe/:username', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const username = String((req.params as any).username ?? '').trim();
    if (!username || username.length > 64) throw new HttpError(400, 'Username tidak valid');
    const c = ctx.db.get<any>(
      `SELECT c.*, p.name AS package_name, p.price AS package_price FROM customers c LEFT JOIN ppp_packages p ON p.id = c.package_id WHERE c.username = ? ORDER BY c.id LIMIT 1`,
      [username],
    );
    if (!c) throw new HttpError(404, 'Akun PPPoE tidak ditemukan');
    return publicCustomer(c);
  });

  /** Isi ulang masa aktif PPPoE dengan kode voucher (tanpa login) — dipakai halaman isolir. */
  app.post('/api/public/pppoe/redeem', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req) => {
    const b = z
      .object({ username: z.string().trim().min(1, 'Masukkan username PPPoE').max(64), code: z.string().trim().min(1, 'Masukkan kode voucher').max(40) })
      .parse(req.body);
    const r = await ctx.pppoe.redeem({ code: b.code, username: b.username }, 'pelanggan');
    ctx.audit.record({ username: 'pelanggan', action: 'customer.redeem.public', target: r.customer.username, detail: { code: r.voucher.code }, ip: req.ip });
    const pkg = r.customer.package_id ? ctx.db.get<any>('SELECT name, price FROM ppp_packages WHERE id = ?', [r.customer.package_id]) : undefined;
    return { ok: true, voucher: r.voucher, customer: publicCustomer({ ...r.customer, package_name: pkg?.name, package_price: pkg?.price }) };
  });

  // ---- WebSocket realtime ----
  app.get('/api/ws', { websocket: true }, (socket: WebSocket, req) => {
    const token = String((req.query as any).token ?? '');
    let user: { id: number; role: Role } | undefined;
    try {
      const payload = app.jwt.verify<{ sub: number }>(token);
      const u = ctx.db.get<{ id: number; role: Role; active: number }>('SELECT id, role, active FROM users WHERE id = ?', [payload.sub]);
      if (u && u.active) user = { id: u.id, role: u.role };
    } catch {
      /* token tidak valid */
    }
    if (!user) {
      socket.close(4401, 'unauthorized');
      return;
    }
    const clientId = crypto.randomUUID();
    const canRouter = hasPermission(user.role, 'router.view');
    const send = (type: string, data: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type, data }));
    };
    const trafficRouters = new Set<number>();

    const onStatus = (snap: any) => canRouter && send('status', snap);
    const onTraffic = (t: any) => trafficRouters.has(t.routerId) && send('traffic', t);
    const onAlert = (a: any) => canRouter && send('alert', a);
    const onVouchers = (v: any) => send('vouchers', v);
    const onActivated = (v: any) => canRouter && send('voucher.activated', v);
    const onCustomers = (v: any) => canRouter && send('customers', v);
    const onPppVouchers = (v: any) => send('ppp-vouchers', v);
    ctx.hub.on('status', onStatus);
    ctx.hub.on('traffic', onTraffic);
    ctx.hub.on('alert', onAlert);
    ctx.hub.on('vouchers', onVouchers);
    ctx.hub.on('voucher.activated', onActivated);
    ctx.hub.on('customers', onCustomers);
    ctx.hub.on('ppp-vouchers', onPppVouchers);

    if (canRouter) {
      for (const snap of ctx.monitor.latest.values()) send('status', snap);
    }

    socket.on('message', (raw: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg?.type === 'traffic.subscribe' && canRouter) {
        const routerId = Number(msg.routerId);
        const ifaces = Array.isArray(msg.interfaces) ? msg.interfaces.map(String).filter((s: string) => s.length < 64) : [];
        if (!ctx.routers.get(routerId)) return;
        // satu langganan trafik per koneksi
        ctx.monitor.unsubscribeTraffic(clientId);
        trafficRouters.clear();
        if (ifaces.length) {
          trafficRouters.add(routerId);
          ctx.monitor.subscribeTraffic(routerId, clientId, ifaces);
        }
      } else if (msg?.type === 'traffic.unsubscribe') {
        ctx.monitor.unsubscribeTraffic(clientId);
        trafficRouters.clear();
      } else if (msg?.type === 'ping') {
        send('pong', Date.now());
      }
    });

    socket.on('close', () => {
      ctx.hub.off('status', onStatus);
      ctx.hub.off('traffic', onTraffic);
      ctx.hub.off('alert', onAlert);
      ctx.hub.off('vouchers', onVouchers);
      ctx.hub.off('voucher.activated', onActivated);
      ctx.hub.off('customers', onCustomers);
      ctx.hub.off('ppp-vouchers', onPppVouchers);
      ctx.monitor.unsubscribeTraffic(clientId);
    });
  });
}
