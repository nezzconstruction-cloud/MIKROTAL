import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFrom, idParam, makeAuth, type AppContext } from '../context.js';
import { isValidDuration } from '../lib/duration.js';
import type { SimulatedRouter } from '../lib/routeros/simulator.js';
import { PPP_VOUCHER_CHARSETS } from '../services/pppoe.js';
import { HttpError } from '../services/vouchers.js';
import { toCsv } from './business.js';

const duration = (msg: string) => z.string().trim().max(32).refine(isValidDuration, msg);
const username = z
  .string()
  .trim()
  .min(2, 'Username minimal 2 karakter')
  .max(64)
  .regex(/^[A-Za-z0-9._@-]+$/, 'Username hanya huruf, angka, titik, strip, @');

const lat = z.number().min(-90).max(90).nullable().optional();
const lng = z.number().min(-180).max(180).nullable().optional();

const packageSchema = z.object({
  routerId: z.number().int().positive(),
  name: z.string().trim().min(1, 'Nama paket wajib diisi').max(60),
  profile: z.string().trim().min(1, 'Pilih profil PPP'),
  price: z.coerce.number().min(0).default(0),
  resellerPrice: z.coerce.number().min(0).default(0),
  validity: duration('Format masa aktif tidak valid (contoh 30d)').default('30d'),
  active: z.boolean().default(true),
});

const customerSchema = z.object({
  routerId: z.number().int().positive(),
  name: z.string().trim().min(1, 'Nama pelanggan wajib diisi').max(100),
  phone: z.string().trim().max(32).default(''),
  address: z.string().trim().max(300).default(''),
  username,
  password: z.string().min(3, 'Password minimal 3 karakter').max(64),
  packageId: z.number().int().positive().nullable().optional(),
  odpId: z.number().int().positive().nullable().optional(),
  odpPort: z.number().int().positive().nullable().optional(),
  lat,
  lng,
  initialValidity: duration('Format masa aktif tidak valid (contoh 30d)').default(''),
  unlimited: z.boolean().default(false),
  note: z.string().max(500).default(''),
});

const customerPatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().max(32).optional(),
  address: z.string().trim().max(300).optional(),
  password: z.string().max(64).optional(),
  packageId: z.number().int().positive().nullable().optional(),
  odpId: z.number().int().positive().nullable().optional(),
  odpPort: z.number().int().positive().nullable().optional(),
  lat,
  lng,
  expiresAt: z.string().datetime().nullable().optional(),
  unlimited: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

const odcSchema = z.object({
  routerId: z.number().int().positive(),
  name: z.string().trim().min(1, 'Nama ODC wajib diisi').max(60),
  location: z.string().trim().max(200).default(''),
  ports: z.coerce.number().int().min(1).max(288).default(12),
  lat,
  lng,
  note: z.string().max(500).default(''),
});

const odpSchema = z.object({
  routerId: z.number().int().positive(),
  name: z.string().trim().min(1, 'Nama ODP wajib diisi').max(60),
  odcId: z.number().int().positive().nullable().optional(),
  odcPort: z.number().int().positive().nullable().optional(),
  location: z.string().trim().max(200).default(''),
  ports: z.coerce.number().int().min(1).max(64).default(8),
  lat,
  lng,
  note: z.string().max(500).default(''),
});

const CUSTOMER_SELECT = `SELECT c.*, p.name AS package_name, p.price AS package_price, o.name AS odp_name, d.name AS odc_name, r.name AS router_name
  FROM customers c LEFT JOIN ppp_packages p ON p.id = c.package_id LEFT JOIN odps o ON o.id = c.odp_id
  LEFT JOIN odcs d ON d.id = o.odc_id LEFT JOIN routers r ON r.id = c.router_id`;

export async function pppoeRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = makeAuth(ctx);
  const scope = (req: FastifyRequest) => (req.user.role === 'reseller' ? req.user.reseller_id ?? -1 : undefined);

  // ---- Ringkasan ----
  app.get('/api/pppoe/summary', { preHandler: auth('customer.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    return ctx.pppoe.summary(q.routerId ? Number(q.routerId) : undefined);
  });

  app.post('/api/pppoe/sync', { preHandler: auth('customer.view') }, async (req) => {
    const b = z.object({ routerId: z.number().int().positive() }).parse(req.body);
    return ctx.pppoe.sync(b.routerId);
  });

  app.post('/api/pppoe/isolir/setup', { preHandler: auth('config.write') }, async (req) => {
    const b = z.object({ routerId: z.number().int().positive() }).parse(req.body);
    const r = await ctx.pppoe.setupIsolir(b.routerId);
    auditFrom(ctx, req, 'pppoe.isolir.setup', String(b.routerId), r.done);
    return r;
  });

  // ---- Paket ----
  app.get('/api/pppoe/packages', { preHandler: auth('voucher.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    return ctx.pppoe.packages(q.routerId ? Number(q.routerId) : undefined);
  });

  app.get('/api/pppoe/profiles', { preHandler: auth('customer.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const rows = await ctx.routers.exec(idParam(q.routerId), '/ppp/profile/print', { '.proplist': 'name,rate-limit' });
    const isolir = ctx.settings.get().pppoe.isolirProfile;
    return rows.filter((r) => r.name !== isolir).map((r) => ({ name: r.name, rate_limit: r['rate-limit'] ?? '' }));
  });

  app.post('/api/pppoe/packages', { preHandler: auth('customer.write') }, async (req) => {
    const p = await ctx.pppoe.savePackage(packageSchema.parse(req.body));
    auditFrom(ctx, req, 'pppoe.package.create', p.name);
    return p;
  });

  app.put('/api/pppoe/packages/:id', { preHandler: auth('customer.write') }, async (req) => {
    const p = await ctx.pppoe.savePackage({ ...packageSchema.parse(req.body), id: idParam((req.params as any).id) });
    auditFrom(ctx, req, 'pppoe.package.update', p.name);
    return p;
  });

  app.delete('/api/pppoe/packages/:id', { preHandler: auth('customer.write') }, async (req) => {
    const p = ctx.pppoe.deletePackage(idParam((req.params as any).id));
    auditFrom(ctx, req, 'pppoe.package.delete', p.name);
    return { ok: true };
  });

  // ---- Pelanggan ----
  const customerFilter = (q: Record<string, string>) => {
    const where: string[] = [];
    const params: any[] = [];
    if (q.routerId) {
      where.push('c.router_id = ?');
      params.push(Number(q.routerId));
    }
    if (q.status === 'online') where.push('c.online = 1');
    else if (q.status === 'offline') where.push(`c.online = 0 AND c.status = 'active'`);
    else if (q.status === 'expiring') {
      where.push(`c.status = 'active' AND c.expires_at IS NOT NULL AND c.expires_at <= ?`);
      params.push(new Date(Date.now() + ctx.settings.get().pppoe.remindDays * 86400_000).toISOString());
    } else if (q.status) {
      where.push('c.status = ?');
      params.push(q.status);
    }
    if (q.packageId) {
      where.push('c.package_id = ?');
      params.push(Number(q.packageId));
    }
    if (q.odpId) {
      where.push('c.odp_id = ?');
      params.push(Number(q.odpId));
    }
    if (q.q) {
      where.push('(c.name LIKE ? OR c.username LIKE ? OR c.phone LIKE ? OR c.address LIKE ?)');
      const like = `%${q.q}%`;
      params.push(like, like, like, like);
    }
    return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  };

  app.get('/api/customers', { preHandler: auth('customer.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const { w, params } = customerFilter(q);
    const limit = Math.min(Number(q.limit ?? 50), 1000);
    const page = Math.max(1, Number(q.page ?? 1));
    const total = ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM customers c ${w}`, params)!.n;
    const rows = ctx.db.all(`${CUSTOMER_SELECT} ${w} ORDER BY c.name COLLATE NOCASE LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
    return { rows, total, page, limit };
  });

  app.get('/api/customers.csv', { preHandler: auth('customer.view') }, async (req, reply) => {
    const { w, params } = customerFilter(req.query as Record<string, string>);
    const rows = ctx.db.all<any>(`${CUSTOMER_SELECT} ${w} ORDER BY c.name COLLATE NOCASE LIMIT 20000`, params);
    const csv = toCsv(rows, [
      ['name', 'Nama'],
      ['phone', 'Telepon'],
      ['address', 'Alamat'],
      ['username', 'Username PPPoE'],
      ['package_name', 'Paket'],
      ['status', 'Status'],
      ['expires_at', 'Masa Aktif Sampai'],
      ['odc_name', 'ODC'],
      ['odp_name', 'ODP'],
      ['odp_port', 'Port'],
      ['ip', 'IP Terakhir'],
      ['last_seen_at', 'Terakhir Online'],
      ['router_name', 'Router'],
    ]);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="pelanggan.csv"');
    return csv;
  });

  app.get('/api/customers/:id', { preHandler: auth('customer.view') }, async (req) => {
    const id = idParam((req.params as any).id);
    const customer = ctx.db.get(`${CUSTOMER_SELECT} WHERE c.id = ?`, [id]);
    if (!customer) throw new HttpError(404, 'Pelanggan tidak ditemukan');
    const history = ctx.db.all('SELECT * FROM customer_tx WHERE customer_id = ? ORDER BY id DESC LIMIT 200', [id]);
    return { customer, history };
  });

  app.post('/api/customers', { preHandler: auth('customer.write') }, async (req) => {
    const c = await ctx.pppoe.createCustomer(customerSchema.parse(req.body), req.user.username);
    auditFrom(ctx, req, 'customer.create', c.username, { name: c.name });
    return c;
  });

  app.post('/api/customers/import', { preHandler: auth('customer.write') }, async (req) => {
    const b = z.object({ routerId: z.number().int().positive() }).parse(req.body);
    const r = await ctx.pppoe.importFromRouter(b.routerId);
    auditFrom(ctx, req, 'customer.import', String(b.routerId), r);
    return r;
  });

  app.patch('/api/customers/:id', { preHandler: auth('customer.write') }, async (req) => {
    const r = await ctx.pppoe.updateCustomer(idParam((req.params as any).id), customerPatch.parse(req.body));
    auditFrom(ctx, req, 'customer.update', r.customer.username);
    return r;
  });

  app.delete('/api/customers/:id', { preHandler: auth('customer.write') }, async (req) => {
    const keep = (req.query as any).keepSecret === '1';
    const c = await ctx.pppoe.deleteCustomer(idParam((req.params as any).id), { removeFromRouter: !keep });
    auditFrom(ctx, req, 'customer.delete', c.username, { keepSecret: keep });
    return { ok: true };
  });

  app.post('/api/customers/:id/redeem', { preHandler: auth('customer.write') }, async (req) => {
    const b = z.object({ code: z.string().trim().min(1, 'Masukkan kode voucher').max(40) }).parse(req.body);
    const r = await ctx.pppoe.redeem({ code: b.code, customerId: idParam((req.params as any).id) }, req.user.username);
    auditFrom(ctx, req, 'customer.redeem', r.customer.username, { code: r.voucher.code });
    return r;
  });

  app.post('/api/customers/:id/extend', { preHandler: auth('customer.write') }, async (req) => {
    const b = z
      .object({
        validity: duration('Format masa aktif tidak valid (contoh 30d)').optional(),
        packageId: z.number().int().positive().nullable().optional(),
        amount: z.coerce.number().min(0).optional(),
        note: z.string().max(200).default(''),
      })
      .parse(req.body ?? {});
    const r = await ctx.pppoe.extend(idParam((req.params as any).id), b, req.user.username);
    auditFrom(ctx, req, 'customer.extend', r.customer.username, { validity: b.validity, amount: b.amount });
    return r;
  });

  app.post('/api/customers/:id/status', { preHandler: auth('customer.write') }, async (req) => {
    const b = z.object({ status: z.enum(['active', 'isolated', 'disabled']) }).parse(req.body);
    const r = await ctx.pppoe.setStatus(idParam((req.params as any).id), b.status, req.user.username);
    auditFrom(ctx, req, `customer.${b.status}`, r.customer.username);
    return r;
  });

  app.post('/api/customers/:id/kick', { preHandler: auth('customer.write') }, async (req) => {
    const c = ctx.pppoe.requireCustomer(idParam((req.params as any).id));
    const n = await ctx.pppoe.kick(c);
    auditFrom(ctx, req, 'customer.kick', c.username);
    return { disconnected: n };
  });

  // ---- Voucher PPPoE ----
  app.post('/api/pppoe/vouchers/generate', { preHandler: auth('voucher.write') }, async (req) => {
    const b = z
      .object({
        packageId: z.number().int().positive(),
        qty: z.number().int().min(1, 'Minimal 1 voucher').max(1000, 'Maksimal 1000 voucher per batch'),
        length: z.number().int().min(6, 'Panjang kode minimal 6').max(16).optional(),
        charset: z.enum(PPP_VOUCHER_CHARSETS).optional(),
        prefix: z.string().trim().max(6).regex(/^[A-Za-z0-9]*$/, 'Prefix hanya huruf/angka').optional(),
        resellerId: z.number().int().positive().nullable().optional(),
        note: z.string().max(200).default(''),
      })
      .parse(req.body);
    const own = scope(req);
    const resellerId = own !== undefined ? own : b.resellerId ?? null;
    const r = await ctx.pppoe.generateVouchers({ ...b, resellerId }, req.user.username);
    auditFrom(ctx, req, 'pppoe.voucher.generate', r.batch.code, { package: r.batch.package_name, qty: r.created, resellerId });
    return r;
  });

  const voucherFilter = (req: FastifyRequest) => {
    const q = req.query as Record<string, string>;
    const where: string[] = [];
    const params: any[] = [];
    const own = scope(req);
    if (own !== undefined) {
      where.push('v.reseller_id = ?');
      params.push(own);
    } else if (q.resellerId) {
      where.push('v.reseller_id = ?');
      params.push(Number(q.resellerId));
    }
    if (q.routerId) {
      where.push('v.router_id = ?');
      params.push(Number(q.routerId));
    }
    if (q.status) {
      where.push('v.status = ?');
      params.push(q.status);
    }
    if (q.packageId) {
      where.push('v.package_id = ?');
      params.push(Number(q.packageId));
    }
    if (q.batchId) {
      where.push('v.batch_id = ?');
      params.push(Number(q.batchId));
    }
    if (q.q) {
      where.push('(v.code LIKE ? OR v.customer_name LIKE ?)');
      params.push(`%${q.q}%`, `%${q.q}%`);
    }
    return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', params, q };
  };
  const VOUCHER_SELECT = `SELECT v.*, b.code AS batch_code, rs.name AS reseller_name FROM ppp_vouchers v
    LEFT JOIN ppp_voucher_batches b ON b.id = v.batch_id LEFT JOIN resellers rs ON rs.id = v.reseller_id`;

  app.get('/api/pppoe/vouchers', { preHandler: auth('voucher.view') }, async (req) => {
    const { w, params, q } = voucherFilter(req);
    const limit = Math.min(Number(q.limit ?? 50), 1000);
    const page = Math.max(1, Number(q.page ?? 1));
    const total = ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ppp_vouchers v ${w}`, params)!.n;
    const rows = ctx.db.all(`${VOUCHER_SELECT} ${w} ORDER BY v.id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
    const counts = ctx.db.all<{ status: string; n: number }>(`SELECT v.status, COUNT(*) AS n FROM ppp_vouchers v ${w} GROUP BY v.status`, params);
    return { rows, total, page, limit, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  });

  app.get('/api/pppoe/vouchers.csv', { preHandler: auth('voucher.view') }, async (req, reply) => {
    const { w, params } = voucherFilter(req);
    const rows = ctx.db.all<any>(`${VOUCHER_SELECT} ${w} ORDER BY v.id DESC LIMIT 20000`, params);
    const csv = toCsv(rows, [
      ['code', 'Kode'],
      ['package_name', 'Paket'],
      ['validity', 'Masa Aktif'],
      ['price', 'Harga'],
      ['status', 'Status'],
      ['batch_code', 'Batch'],
      ['reseller_name', 'Reseller'],
      ['customer_name', 'Dipakai Oleh'],
      ['used_at', 'Dipakai Pada'],
      ['created_at', 'Dibuat'],
    ]);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="voucher-pppoe.csv"');
    return csv;
  });

  app.get('/api/pppoe/vouchers/batches', { preHandler: auth('voucher.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const where: string[] = [];
    const params: any[] = [];
    const own = scope(req);
    if (own !== undefined) {
      where.push('b.reseller_id = ?');
      params.push(own);
    }
    if (q.routerId) {
      where.push('b.router_id = ?');
      params.push(Number(q.routerId));
    }
    return ctx.db.all(
      `SELECT b.*, rs.name AS reseller_name,
         (SELECT COUNT(*) FROM ppp_vouchers v WHERE v.batch_id = b.id AND v.status = 'unused') AS unused,
         (SELECT COUNT(*) FROM ppp_vouchers v WHERE v.batch_id = b.id AND v.status = 'used') AS used
       FROM ppp_voucher_batches b LEFT JOIN resellers rs ON rs.id = b.reseller_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.id DESC LIMIT 500`,
      params,
    );
  });

  /** Data untuk halaman cetak voucher PPPoE. */
  app.get('/api/pppoe/vouchers/print', { preHandler: auth('voucher.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const own = scope(req);
    let rows: any[] = [];
    if (q.batchId) {
      const batch = ctx.db.get<any>('SELECT * FROM ppp_voucher_batches WHERE id = ?', [Number(q.batchId)]);
      if (!batch || (own !== undefined && batch.reseller_id !== own)) throw new HttpError(404, 'Batch tidak ditemukan');
      rows = ctx.db.all(`SELECT * FROM ppp_vouchers WHERE batch_id = ? ${q.onlyUnused === '1' ? `AND status = 'unused'` : ''} ORDER BY id`, [batch.id]);
    } else if (q.ids) {
      const ids = q.ids.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 1000);
      if (ids.length) {
        rows = ctx.db.all(`SELECT * FROM ppp_vouchers WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
        if (own !== undefined) rows = rows.filter((r) => r.reseller_id === own);
      }
    }
    return { vouchers: rows, brand: ctx.settings.get().brand, topupUrl: ctx.settings.get().pppoe.topupUrl };
  });

  app.delete('/api/pppoe/vouchers/:id', { preHandler: auth('voucher.write') }, async (req) => {
    if (req.user.role === 'reseller') throw new HttpError(403, 'Reseller tidak dapat menghapus voucher');
    const id = idParam((req.params as any).id);
    const v = ctx.db.get<any>('SELECT * FROM ppp_vouchers WHERE id = ?', [id]);
    if (!v) throw new HttpError(404, 'Voucher tidak ditemukan');
    if (v.status === 'used') throw new HttpError(400, 'Voucher yang sudah dipakai tidak dapat dihapus');
    ctx.db.run('DELETE FROM ppp_vouchers WHERE id = ?', [id]);
    auditFrom(ctx, req, 'pppoe.voucher.delete', v.code);
    return { ok: true };
  });

  app.delete('/api/pppoe/vouchers/batches/:id', { preHandler: auth('voucher.write') }, async (req) => {
    if (req.user.role === 'reseller') throw new HttpError(403, 'Reseller tidak dapat menghapus batch');
    const id = idParam((req.params as any).id);
    const refund = (req.query as any).refund === '1';
    const r = ctx.pppoe.deleteBatch(id, { refund, actor: req.user.username });
    auditFrom(ctx, req, 'pppoe.voucher.batch.delete', String(id), { refund, ...r });
    return r;
  });

  // ---- Topologi ODC / ODP ----
  app.get('/api/topology', { preHandler: auth('customer.view') }, async (req) => {
    return ctx.pppoe.topology(idParam((req.query as any).routerId));
  });

  app.put('/api/topology/server-location', { preHandler: auth('customer.write') }, async (req) => {
    const b = z.object({ routerId: z.number().int().positive(), lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable() }).parse(req.body);
    ctx.pppoe.setServerLocation(b.routerId, b.lat, b.lng);
    auditFrom(ctx, req, 'topology.server-location', String(b.routerId));
    return { ok: true };
  });

  // ---- Troubleshoot jalur ----
  /** Diagnosis cepat dari data terakhir (dipakai peta dan penyegaran otomatis). */
  app.get('/api/troubleshoot', { preHandler: auth('customer.view') }, async (req) => {
    return ctx.pppoe.diagnosis(idParam((req.query as any).routerId));
  });

  /** Scan penuh: ambil status terbaru dari router, cek interface server, lampirkan log. */
  app.post('/api/troubleshoot/scan', { preHandler: auth('customer.view') }, async (req) => {
    const b = z.object({ routerId: z.number().int().positive() }).parse(req.body);
    const r = await ctx.pppoe.scan(b.routerId);
    auditFrom(ctx, req, 'troubleshoot.scan', String(b.routerId), { findings: r.findings.length, offline: r.totals.offline });
    return r;
  });

  /** Simulasi kabel putus, hanya untuk router simulasi (mencoba fitur tanpa gangguan sungguhan). */
  app.post('/api/troubleshoot/simulate', { preHandler: auth('customer.write') }, async (req) => {
    const b = z
      .object({ routerId: z.number().int().positive(), target: z.enum(['odc', 'odp', 'customer', 'clear']), id: z.number().int().positive().optional() })
      .parse(req.body);
    const router = ctx.routers.require(b.routerId);
    if (!router.simulate) throw new HttpError(400, 'Simulasi gangguan hanya tersedia untuk router simulasi');
    const conn = (await ctx.routers.connection(b.routerId)) as SimulatedRouter;
    if (b.target === 'clear') conn.pppClearBlocked();
    else {
      const where = b.target === 'odc' ? 'odp_id IN (SELECT id FROM odps WHERE odc_id = ?)' : b.target === 'odp' ? 'odp_id = ?' : 'id = ?';
      const names = ctx.db.all<{ username: string }>(`SELECT username FROM customers WHERE router_id = ? AND ${where}`, [b.routerId, b.id ?? 0]).map((c) => c.username);
      if (!names.length) throw new HttpError(400, 'Tidak ada pelanggan pada target ini');
      conn.pppSetBlocked(names, true);
    }
    return ctx.pppoe.scan(b.routerId);
  });

  const uniqueGuard = <T>(fn: () => T, msg: string): T => {
    try {
      return fn();
    } catch (err) {
      if (String((err as Error).message).includes('UNIQUE')) throw new HttpError(400, msg);
      throw err;
    }
  };

  app.post('/api/odcs', { preHandler: auth('customer.write') }, async (req) => {
    const b = odcSchema.parse(req.body);
    ctx.routers.require(b.routerId);
    const { lastId } = uniqueGuard(
      () => ctx.db.run('INSERT INTO odcs (router_id, name, location, ports, lat, lng, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [b.routerId, b.name, b.location, b.ports, b.lat ?? null, b.lng ?? null, b.note, new Date().toISOString()]),
      `ODC "${b.name}" sudah ada`,
    );
    auditFrom(ctx, req, 'odc.create', b.name);
    return ctx.db.get('SELECT * FROM odcs WHERE id = ?', [lastId]);
  });

  app.put('/api/odcs/:id', { preHandler: auth('customer.write') }, async (req) => {
    const id = idParam((req.params as any).id);
    const b = odcSchema.parse(req.body);
    const cur = ctx.db.get<any>('SELECT * FROM odcs WHERE id = ?', [id]);
    if (!cur) throw new HttpError(404, 'ODC tidak ditemukan');
    const maxPort = ctx.db.get<{ m: number | null }>('SELECT MAX(odc_port) AS m FROM odps WHERE odc_id = ?', [id])!.m ?? 0;
    if (b.ports < maxPort) throw new HttpError(400, `Port ${maxPort} masih dipakai ODP. Pindahkan dulu sebelum mengurangi jumlah port.`);
    uniqueGuard(() => ctx.db.run('UPDATE odcs SET name = ?, location = ?, ports = ?, lat = ?, lng = ?, note = ? WHERE id = ?', [b.name, b.location, b.ports, b.lat ?? null, b.lng ?? null, b.note, id]), `ODC "${b.name}" sudah ada`);
    auditFrom(ctx, req, 'odc.update', b.name);
    return ctx.db.get('SELECT * FROM odcs WHERE id = ?', [id]);
  });

  app.delete('/api/odcs/:id', { preHandler: auth('customer.write') }, async (req) => {
    const id = idParam((req.params as any).id);
    const cur = ctx.db.get<any>('SELECT * FROM odcs WHERE id = ?', [id]);
    if (!cur) throw new HttpError(404, 'ODC tidak ditemukan');
    ctx.db.transaction(() => {
      ctx.db.run('UPDATE odps SET odc_port = NULL WHERE odc_id = ?', [id]);
      ctx.db.run('DELETE FROM odcs WHERE id = ?', [id]);
    });
    auditFrom(ctx, req, 'odc.delete', cur.name);
    return { ok: true };
  });

  const checkOdcPort = (routerId: number, odcId: number | null | undefined, port: number | null | undefined, exceptOdp = 0) => {
    if (!odcId) return { odcId: null, port: null };
    const odc = ctx.db.get<any>('SELECT * FROM odcs WHERE id = ?', [odcId]);
    if (!odc || odc.router_id !== routerId) throw new HttpError(400, 'ODC tidak ditemukan pada router ini');
    if (!port) return { odcId, port: null };
    if (port > odc.ports) throw new HttpError(400, `Port ${port} tidak ada. ${odc.name} hanya punya ${odc.ports} port.`);
    const used = ctx.db.get<{ name: string }>('SELECT name FROM odps WHERE odc_id = ? AND odc_port = ? AND id != ?', [odcId, port, exceptOdp]);
    if (used) throw new HttpError(400, `Port ${port} di ${odc.name} sudah dipakai ${used.name}`);
    return { odcId, port };
  };

  app.post('/api/odps', { preHandler: auth('customer.write') }, async (req) => {
    const b = odpSchema.parse(req.body);
    ctx.routers.require(b.routerId);
    const up = checkOdcPort(b.routerId, b.odcId, b.odcPort);
    const { lastId } = uniqueGuard(
      () =>
        ctx.db.run('INSERT INTO odps (router_id, odc_id, odc_port, name, location, ports, lat, lng, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          b.routerId,
          up.odcId,
          up.port,
          b.name,
          b.location,
          b.ports,
          b.lat ?? null,
          b.lng ?? null,
          b.note,
          new Date().toISOString(),
        ]),
      `ODP "${b.name}" sudah ada`,
    );
    auditFrom(ctx, req, 'odp.create', b.name);
    return ctx.db.get('SELECT * FROM odps WHERE id = ?', [lastId]);
  });

  app.put('/api/odps/:id', { preHandler: auth('customer.write') }, async (req) => {
    const id = idParam((req.params as any).id);
    const b = odpSchema.parse(req.body);
    const cur = ctx.db.get<any>('SELECT * FROM odps WHERE id = ?', [id]);
    if (!cur) throw new HttpError(404, 'ODP tidak ditemukan');
    const up = checkOdcPort(cur.router_id, b.odcId, b.odcPort, id);
    const maxPort = ctx.db.get<{ m: number | null }>('SELECT MAX(odp_port) AS m FROM customers WHERE odp_id = ?', [id])!.m ?? 0;
    if (b.ports < maxPort) throw new HttpError(400, `Port ${maxPort} masih dipakai pelanggan. Pindahkan dulu sebelum mengurangi jumlah port.`);
    uniqueGuard(
      () => ctx.db.run('UPDATE odps SET odc_id = ?, odc_port = ?, name = ?, location = ?, ports = ?, lat = ?, lng = ?, note = ? WHERE id = ?', [up.odcId, up.port, b.name, b.location, b.ports, b.lat ?? null, b.lng ?? null, b.note, id]),
      `ODP "${b.name}" sudah ada`,
    );
    auditFrom(ctx, req, 'odp.update', b.name);
    return ctx.db.get('SELECT * FROM odps WHERE id = ?', [id]);
  });

  app.delete('/api/odps/:id', { preHandler: auth('customer.write') }, async (req) => {
    const id = idParam((req.params as any).id);
    const cur = ctx.db.get<any>('SELECT * FROM odps WHERE id = ?', [id]);
    if (!cur) throw new HttpError(404, 'ODP tidak ditemukan');
    ctx.db.transaction(() => {
      ctx.db.run('UPDATE customers SET odp_port = NULL WHERE odp_id = ?', [id]);
      ctx.db.run('DELETE FROM odps WHERE id = ?', [id]);
    });
    auditFrom(ctx, req, 'odp.delete', cur.name);
    return { ok: true };
  });
}
