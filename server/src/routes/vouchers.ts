import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFrom, idParam, makeAuth, type AppContext } from '../context.js';
import { isValidDuration, parseBytes } from '../lib/duration.js';
import { CHARSETS, HttpError } from '../services/vouchers.js';

const generateSchema = z.object({
  routerId: z.number().int().positive(),
  profile: z.string().trim().min(1, 'Pilih profil'),
  qty: z.number().int().min(1, 'Minimal 1 voucher').max(1000, 'Maksimal 1000 voucher per batch'),
  length: z.number().int().min(3).max(16).default(6),
  charset: z.enum(Object.keys(CHARSETS) as [string, ...string[]]).default('alnum-upper'),
  prefix: z.string().trim().max(10).regex(/^[A-Za-z0-9-]*$/, 'Prefix hanya huruf/angka').default(''),
  mode: z.enum(['same', 'separate']).default('same'),
  passwordLength: z.number().int().min(3).max(16).default(4),
  passwordCharset: z.enum(Object.keys(CHARSETS) as [string, ...string[]]).default('numeric'),
  price: z.number().min(0).optional(),
  validity: z.string().trim().max(32).refine(isValidDuration, 'Format masa aktif tidak valid (contoh 1d, 7d, 30d)').optional(),
  timeLimit: z.string().trim().max(32).refine(isValidDuration, 'Format batas waktu tidak valid (contoh 1h, 3h)').optional(),
  dataLimit: z.union([z.string(), z.number()]).optional(),
  server: z.string().trim().default('all'),
  resellerId: z.number().int().positive().nullable().optional(),
  note: z.string().max(200).default(''),
});

export async function voucherRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = makeAuth(ctx);

  /** Reseller hanya boleh melihat voucher miliknya. */
  const scope = (req: FastifyRequest) => (req.user.role === 'reseller' ? req.user.reseller_id ?? -1 : undefined);

  app.post('/api/vouchers/generate', { preHandler: auth('voucher.write') }, async (req) => {
    const b = generateSchema.parse(req.body);
    const own = scope(req);
    const resellerId = own !== undefined ? own : b.resellerId ?? null;
    const result = await ctx.vouchers.generate(
      {
        ...b,
        resellerId,
        // Reseller memakai harga dan batas dari Profil & Harga apa adanya: tidak bisa memperpanjang voucher murah
        ...(own !== undefined
          ? { price: undefined, validity: undefined, timeLimit: undefined, dataLimit: undefined }
          : { price: b.price, dataLimit: b.dataLimit !== undefined ? parseBytes(b.dataLimit) : undefined }),
      },
      req.user.username,
    );
    auditFrom(ctx, req, 'voucher.generate', result.batch.code, { routerId: b.routerId, profile: b.profile, qty: result.created, resellerId });
    return result;
  });

  app.get('/api/vouchers', { preHandler: auth('voucher.view') }, async (req) => {
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
    if (q.profile) {
      where.push('v.profile = ?');
      params.push(q.profile);
    }
    if (q.batchId) {
      where.push('v.batch_id = ?');
      params.push(Number(q.batchId));
    }
    if (q.q) {
      where.push('(v.code LIKE ? OR v.mac LIKE ?)');
      params.push(`%${q.q}%`, `%${q.q}%`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Number(q.limit ?? 50), 1000);
    const page = Math.max(1, Number(q.page ?? 1));
    const total = ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM vouchers v ${w}`, params)!.n;
    const rows = ctx.db.all(
      `SELECT v.*, b.code AS batch_code, r.name AS router_name, rs.name AS reseller_name
       FROM vouchers v LEFT JOIN voucher_batches b ON b.id = v.batch_id
       LEFT JOIN routers r ON r.id = v.router_id LEFT JOIN resellers rs ON rs.id = v.reseller_id
       ${w} ORDER BY v.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    );
    const counts = ctx.db.all<{ status: string; n: number }>(`SELECT v.status, COUNT(*) AS n FROM vouchers v ${w} GROUP BY v.status`, params);
    return { rows, total, page, limit, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  });

  app.get('/api/vouchers/batches', { preHandler: auth('voucher.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const where: string[] = ['b.deleted_at IS NULL'];
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
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return ctx.db.all(
      `SELECT b.*, r.name AS router_name, rs.name AS reseller_name,
         (SELECT COUNT(*) FROM vouchers v WHERE v.batch_id = b.id AND v.status = 'unused') AS unused,
         (SELECT COUNT(*) FROM vouchers v WHERE v.batch_id = b.id AND v.status = 'active') AS active,
         (SELECT COUNT(*) FROM vouchers v WHERE v.batch_id = b.id AND v.status IN ('used','expired')) AS used
       FROM voucher_batches b LEFT JOIN routers r ON r.id = b.router_id LEFT JOIN resellers rs ON rs.id = b.reseller_id
       ${w} ORDER BY b.id DESC LIMIT 500`,
      params,
    );
  });

  /** Data untuk halaman cetak voucher. */
  app.get('/api/vouchers/print', { preHandler: auth('voucher.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const own = scope(req);
    let rows: any[] = [];
    if (q.batchId) {
      const batch = ctx.db.get<any>('SELECT * FROM voucher_batches WHERE id = ? AND deleted_at IS NULL', [Number(q.batchId)]);
      if (!batch || (own !== undefined && batch.reseller_id !== own)) throw new HttpError(404, 'Batch tidak ditemukan');
      const onlyUnused = q.onlyUnused === '1' ? `AND status = 'unused'` : '';
      rows = ctx.db.all(`SELECT * FROM vouchers WHERE batch_id = ? ${onlyUnused} ORDER BY id`, [batch.id]);
    } else if (q.ids) {
      const ids = q.ids.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 1000);
      if (ids.length) {
        rows = ctx.db.all(`SELECT * FROM vouchers WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
        if (own !== undefined) rows = rows.filter((r) => r.reseller_id === own);
      }
    }
    const routerIds = [...new Set(rows.map((r) => r.router_id))];
    const routers = routerIds.map((id) => {
      const r = ctx.routers.get(id);
      return { id, name: r?.name ?? '', identity: r?.identity ?? '', hotspot_dns: r?.hotspot_dns ?? '' };
    });
    const metas = ctx.db.all<any>(`SELECT * FROM profile_meta WHERE router_id IN (${routerIds.map(() => '?').join(',') || 'NULL'})`, routerIds);
    return { vouchers: rows, routers, metas, brand: ctx.settings.get().brand, loginUrl: ctx.settings.get().voucher.loginUrl };
  });

  app.post('/api/vouchers/sync', { preHandler: auth('voucher.view') }, async (req) => {
    const b = z.object({ routerId: z.number().int().positive().optional() }).parse(req.body ?? {});
    const ids = b.routerId ? [b.routerId] : ctx.routers.list().filter((r) => r.enabled).map((r) => r.id);
    const results: Record<number, unknown> = {};
    for (const id of ids) {
      try {
        results[id] = await ctx.vouchers.sync(id);
      } catch (err) {
        results[id] = { error: (err as Error).message };
      }
    }
    return results;
  });

  app.delete('/api/vouchers/:id', { preHandler: auth('voucher.write') }, async (req) => {
    const id = idParam((req.params as any).id);
    const own = scope(req);
    if (own !== undefined) {
      const v = ctx.db.get<any>('SELECT reseller_id FROM vouchers WHERE id = ?', [id]);
      if (!v || v.reseller_id !== own) throw new HttpError(404, 'Voucher tidak ditemukan');
      throw new HttpError(403, 'Reseller tidak dapat menghapus voucher');
    }
    const v = await ctx.vouchers.removeVoucher(id);
    auditFrom(ctx, req, 'voucher.delete', v.code, { routerId: v.router_id });
    return { ok: true };
  });

  app.delete('/api/vouchers/batches/:id', { preHandler: auth('voucher.write') }, async (req) => {
    if (req.user.role === 'reseller') throw new HttpError(403, 'Reseller tidak dapat menghapus batch');
    const id = idParam((req.params as any).id);
    const refund = (req.query as any).refund === '1';
    const r = await ctx.vouchers.deleteBatch(id, { refund, actor: req.user.username });
    auditFrom(ctx, req, 'voucher.batch.delete', String(id), { refund, ...r });
    return r;
  });
}
