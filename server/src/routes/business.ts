import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFrom, idParam, makeAuth, type AppContext } from '../context.js';
import { HttpError } from '../services/vouchers.js';

const resellerSchema = z.object({
  name: z.string().trim().min(1, 'Nama reseller wajib diisi').max(100),
  phone: z.string().trim().max(32).default(''),
  email: z.string().trim().max(100).default(''),
  address: z.string().trim().max(300).default(''),
  discount: z.coerce.number().min(0).max(100).default(0),
  active: z.boolean().default(true),
  note: z.string().max(500).default(''),
});

/** Konversi tanggal lokal (YYYY-MM-DD) + offset menit → rentang ISO UTC. */
export function dayRange(from: string, to: string, offsetMin: number) {
  const start = new Date(`${from}T00:00:00.000Z`).getTime() - offsetMin * 60000;
  const end = new Date(`${to}T00:00:00.000Z`).getTime() + 86400000 - offsetMin * 60000;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

export function localDay(iso: string, offsetMin: number) {
  return new Date(Date.parse(iso) + offsetMin * 60000).toISOString().slice(0, 10);
}

export function todayLocal(offsetMin: number) {
  return localDay(new Date().toISOString(), offsetMin);
}

function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function csvEscape(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns: [string, string][]) {
  const lines = [columns.map(([, label]) => csvEscape(label)).join(',')];
  for (const r of rows) lines.push(columns.map(([key]) => csvEscape(r[key])).join(','));
  return '﻿' + lines.join('\n');
}

export function salesReport(ctx: AppContext, opts: { from: string; to: string; routerId?: number; resellerId?: number }) {
  const off = ctx.settings.get().brand.timezoneOffset;
  const { start, end } = dayRange(opts.from, opts.to, off);
  const rf = opts.routerId ? ' AND v.router_id = ?' : '';
  const rp = opts.routerId ? [opts.routerId] : [];
  const resF = opts.resellerId ? ' AND v.reseller_id = ?' : '';
  const resP = opts.resellerId ? [opts.resellerId] : [];

  // Penjualan langsung: dihitung saat voucher pertama kali dipakai (aktivasi)
  const direct = opts.resellerId
    ? []
    : ctx.db.all<any>(
        `SELECT v.activated_at, v.price, v.profile, v.router_id, r.name AS router_name FROM vouchers v LEFT JOIN routers r ON r.id = v.router_id
         WHERE v.reseller_id IS NULL AND v.activated_at >= ? AND v.activated_at < ?${rf}`,
        [start, end, ...rp],
      );
  // Penjualan reseller: dihitung saat reseller membeli (saldo terpotong)
  const bf = opts.routerId ? ' AND b.router_id = ?' : '';
  const brf = opts.resellerId ? ' AND b.reseller_id = ?' : '';
  const resellerSales = ctx.db.all<any>(
    `SELECT b.created_at, b.cost, b.qty, b.profile, b.router_id, r.name AS router_name, rs.name AS reseller_name, b.reseller_id
     FROM voucher_batches b LEFT JOIN routers r ON r.id = b.router_id LEFT JOIN resellers rs ON rs.id = b.reseller_id
     WHERE b.reseller_id IS NOT NULL AND b.created_at >= ? AND b.created_at < ?${bf}${brf}`,
    [start, end, ...rp, ...resP],
  );
  const activations = ctx.db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM vouchers v WHERE v.activated_at >= ? AND v.activated_at < ?${rf}${resF}`,
    [start, end, ...rp, ...resP],
  )!.n;
  const topups = ctx.db.get<{ s: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM reseller_tx WHERE type = 'topup' AND created_at >= ? AND created_at < ?${opts.resellerId ? ' AND reseller_id = ?' : ''}`,
    [start, end, ...resP],
  )!.s;

  // PPPoE langsung: dihitung saat voucher diisikan ke pelanggan atau perpanjangan manual dicatat
  const pppoe = opts.resellerId
    ? []
    : ctx.db.all<any>(
        `SELECT t.created_at, t.amount, t.package_name, t.type, r.name AS router_name FROM customer_tx t LEFT JOIN routers r ON r.id = t.router_id
         WHERE t.type IN ('voucher','manual') AND t.reseller_id IS NULL AND t.amount > 0 AND t.created_at >= ? AND t.created_at < ?${opts.routerId ? ' AND t.router_id = ?' : ''}`,
        [start, end, ...rp],
      );
  // Voucher PPPoE yang dibeli reseller: dihitung saat saldo terpotong
  const pppResellerSales = ctx.db.all<any>(
    `SELECT b.created_at, b.cost, b.qty, 'PPPoE ' || b.package_name AS profile, b.router_id, r.name AS router_name, rs.name AS reseller_name, b.reseller_id
     FROM ppp_voucher_batches b LEFT JOIN routers r ON r.id = b.router_id LEFT JOIN resellers rs ON rs.id = b.reseller_id
     WHERE b.reseller_id IS NOT NULL AND b.created_at >= ? AND b.created_at < ?${bf}${brf}`,
    [start, end, ...rp, ...resP],
  );
  resellerSales.push(...pppResellerSales);

  const days: Record<string, { date: string; direct: number; reseller: number; pppoe: number; count: number }> = {};
  for (let d = opts.from; d <= opts.to; d = addDays(d, 1)) days[d] = { date: d, direct: 0, reseller: 0, pppoe: 0, count: 0 };
  const byProfile: Record<string, { profile: string; count: number; amount: number }> = {};
  const byRouter: Record<string, { router: string; count: number; amount: number }> = {};
  const byReseller: Record<string, { reseller: string; count: number; amount: number }> = {};

  for (const v of direct) {
    const d = days[localDay(v.activated_at, off)];
    if (d) {
      d.direct += v.price;
      d.count++;
    }
    (byProfile[v.profile] ??= { profile: v.profile, count: 0, amount: 0 }).count++;
    byProfile[v.profile].amount += v.price;
    const rk = v.router_name ?? '-';
    (byRouter[rk] ??= { router: rk, count: 0, amount: 0 }).count++;
    byRouter[rk].amount += v.price;
  }
  for (const t of pppoe) {
    const d = days[localDay(t.created_at, off)];
    if (d) {
      d.pppoe += t.amount;
      d.count++;
    }
    const pk = `PPPoE ${t.package_name || 'tanpa paket'}`;
    (byProfile[pk] ??= { profile: pk, count: 0, amount: 0 }).count++;
    byProfile[pk].amount += t.amount;
    const rk = t.router_name ?? '-';
    (byRouter[rk] ??= { router: rk, count: 0, amount: 0 }).count++;
    byRouter[rk].amount += t.amount;
  }
  for (const b of resellerSales) {
    const d = days[localDay(b.created_at, off)];
    if (d) {
      d.reseller += b.cost;
      d.count += b.qty;
    }
    (byProfile[b.profile] ??= { profile: b.profile, count: 0, amount: 0 }).count += b.qty;
    byProfile[b.profile].amount += b.cost;
    const rk = b.router_name ?? '-';
    (byRouter[rk] ??= { router: rk, count: 0, amount: 0 }).count += b.qty;
    byRouter[rk].amount += b.cost;
    const sk = b.reseller_name ?? '-';
    (byReseller[sk] ??= { reseller: sk, count: 0, amount: 0 }).count += b.qty;
    byReseller[sk].amount += b.cost;
  }

  const stock = ctx.db.all<any>(
    `SELECT v.profile, COUNT(*) AS count, SUM(v.price) AS value FROM vouchers v WHERE v.status = 'unused'${rf}${resF} GROUP BY v.profile ORDER BY count DESC`,
    [...rp, ...resP],
  );

  const pppStock = ctx.db.all<any>(
    `SELECT 'PPPoE ' || v.package_name AS profile, COUNT(*) AS count, SUM(v.price) AS value FROM ppp_vouchers v WHERE v.status = 'unused'${rf}${resF} GROUP BY v.package_name ORDER BY count DESC`,
    [...rp, ...resP],
  );
  stock.push(...pppStock);
  const pppoeTotal = pppoe.reduce((s, t) => s + t.amount, 0);
  const directTotal = direct.reduce((s, v) => s + v.price, 0);
  const resellerTotal = resellerSales.reduce((s, b) => s + b.cost, 0);
  return {
    from: opts.from,
    to: opts.to,
    totals: { direct: directTotal, reseller: resellerTotal, pppoe: pppoeTotal, pppoeCount: pppoe.length, total: directTotal + resellerTotal + pppoeTotal, activations, topups, directCount: direct.length, resellerCount: resellerSales.reduce((s, b) => s + b.qty, 0) },
    daily: Object.values(days),
    byProfile: Object.values(byProfile).sort((a, b) => b.amount - a.amount),
    byRouter: Object.values(byRouter).sort((a, b) => b.amount - a.amount),
    byReseller: Object.values(byReseller).sort((a, b) => b.amount - a.amount),
    stock,
  };
}

export async function businessRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = makeAuth(ctx);

  // ---- Reseller ----
  app.get('/api/resellers', { preHandler: auth() }, async (req) => {
    if (req.user.role === 'reseller') {
      return ctx.db.all('SELECT * FROM resellers WHERE id = ?', [req.user.reseller_id ?? -1]);
    }
    if (!['superadmin', 'admin', 'operator'].includes(req.user.role)) throw new HttpError(403, 'Tidak ada akses');
    return ctx.db.all(
      `SELECT r.*,
        (SELECT COUNT(*) FROM vouchers v WHERE v.reseller_id = r.id) AS vouchers_total,
        (SELECT COUNT(*) FROM vouchers v WHERE v.reseller_id = r.id AND v.status = 'unused') AS vouchers_unused,
        (SELECT COALESCE(SUM(-amount), 0) FROM reseller_tx t WHERE t.reseller_id = r.id AND t.type = 'purchase') AS total_purchase
       FROM resellers r ORDER BY r.name COLLATE NOCASE`,
    );
  });

  app.post('/api/resellers', { preHandler: auth('reseller.write') }, async (req) => {
    const b = resellerSchema.parse(req.body);
    const { lastId } = ctx.db.run(
      'INSERT INTO resellers (name, phone, email, address, discount, active, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [b.name, b.phone, b.email, b.address, b.discount, b.active, b.note, new Date().toISOString()],
    );
    auditFrom(ctx, req, 'reseller.create', b.name);
    return ctx.db.get('SELECT * FROM resellers WHERE id = ?', [lastId]);
  });

  app.patch('/api/resellers/:id', { preHandler: auth('reseller.write') }, async (req) => {
    const id = idParam((req.params as any).id);
    const cur = ctx.db.get<any>('SELECT * FROM resellers WHERE id = ?', [id]);
    if (!cur) throw new HttpError(404, 'Reseller tidak ditemukan');
    const b = { ...cur, ...resellerSchema.partial().parse(req.body) };
    ctx.db.run('UPDATE resellers SET name = ?, phone = ?, email = ?, address = ?, discount = ?, active = ?, note = ? WHERE id = ?', [
      b.name,
      b.phone,
      b.email,
      b.address,
      b.discount,
      !!b.active,
      b.note,
      id,
    ]);
    auditFrom(ctx, req, 'reseller.update', b.name);
    return ctx.db.get('SELECT * FROM resellers WHERE id = ?', [id]);
  });

  app.delete('/api/resellers/:id', { preHandler: auth('reseller.write') }, async (req) => {
    const id = idParam((req.params as any).id);
    const cur = ctx.db.get<any>('SELECT * FROM resellers WHERE id = ?', [id]);
    if (!cur) throw new HttpError(404, 'Reseller tidak ditemukan');
    ctx.db.run('DELETE FROM resellers WHERE id = ?', [id]);
    auditFrom(ctx, req, 'reseller.delete', cur.name);
    return { ok: true };
  });

  app.post('/api/resellers/:id/balance', { preHandler: auth('reseller.write') }, async (req) => {
    const id = idParam((req.params as any).id);
    const b = z
      .object({ type: z.enum(['topup', 'adjust']).default('topup'), amount: z.number().refine((n) => n !== 0, 'Nominal tidak boleh 0'), note: z.string().max(200).default('') })
      .parse(req.body);
    if (b.type === 'topup' && b.amount < 0) throw new HttpError(400, 'Nominal top up harus positif');
    const r = ctx.db.transaction(() => {
      const cur = ctx.db.get<any>('SELECT * FROM resellers WHERE id = ?', [id]);
      if (!cur) throw new HttpError(404, 'Reseller tidak ditemukan');
      const balance = cur.balance + b.amount;
      if (balance < 0) throw new HttpError(400, 'Saldo tidak boleh minus');
      ctx.db.run('UPDATE resellers SET balance = ? WHERE id = ?', [balance, id]);
      ctx.db.run(
        'INSERT INTO reseller_tx (reseller_id, type, amount, balance_after, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, b.type, b.amount, balance, b.note, req.user.username, new Date().toISOString()],
      );
      return ctx.db.get<any>('SELECT * FROM resellers WHERE id = ?', [id]);
    });
    auditFrom(ctx, req, `reseller.${b.type}`, r.name, { amount: b.amount });
    return r;
  });

  app.get('/api/resellers/:id/transactions', { preHandler: auth() }, async (req) => {
    const id = idParam((req.params as any).id);
    if (req.user.role === 'reseller' && req.user.reseller_id !== id) throw new HttpError(403, 'Tidak ada akses');
    if (req.user.role !== 'reseller' && !['superadmin', 'admin', 'operator'].includes(req.user.role)) throw new HttpError(403, 'Tidak ada akses');
    return ctx.db.all('SELECT * FROM reseller_tx WHERE reseller_id = ? ORDER BY id DESC LIMIT 500', [id]);
  });

  // ---- Laporan ----
  const rangeQuery = (q: any) => {
    const off = ctx.settings.get().brand.timezoneOffset;
    const today = todayLocal(off);
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const from = re.test(q.from ?? '') ? q.from : addDays(today, -29);
    const to = re.test(q.to ?? '') ? q.to : today;
    if (from > to) throw new HttpError(400, 'Tanggal awal melebihi tanggal akhir');
    return { from, to, routerId: q.routerId ? Number(q.routerId) : undefined, resellerId: q.resellerId ? Number(q.resellerId) : undefined };
  };

  app.get('/api/reports/sales', { preHandler: auth('report.view') }, async (req) => {
    return salesReport(ctx, rangeQuery(req.query));
  });

  app.get('/api/reports/sales.csv', { preHandler: auth('report.view') }, async (req, reply) => {
    const r = salesReport(ctx, rangeQuery(req.query));
    const csv = toCsv(
      r.daily.map((d) => ({ ...d, total: d.direct + d.reseller + d.pppoe })),
      [
        ['date', 'Tanggal'],
        ['count', 'Transaksi'],
        ['direct', 'Hotspot Langsung'],
        ['pppoe', 'PPPoE Langsung'],
        ['reseller', 'Penjualan Reseller'],
        ['total', 'Total'],
      ],
    );
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="penjualan-${r.from}-${r.to}.csv"`);
    return csv;
  });

  app.get('/api/reports/vouchers.csv', { preHandler: auth('voucher.view') }, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const where: string[] = [];
    const params: any[] = [];
    if (req.user.role === 'reseller') {
      where.push('v.reseller_id = ?');
      params.push(req.user.reseller_id ?? -1);
    }
    if (q.routerId) {
      where.push('v.router_id = ?');
      params.push(Number(q.routerId));
    }
    if (q.status) {
      where.push('v.status = ?');
      params.push(q.status);
    }
    if (q.batchId) {
      where.push('v.batch_id = ?');
      params.push(Number(q.batchId));
    }
    const rows = ctx.db.all<any>(
      `SELECT v.*, r.name AS router_name, b.code AS batch_code, rs.name AS reseller_name FROM vouchers v
       LEFT JOIN routers r ON r.id = v.router_id LEFT JOIN voucher_batches b ON b.id = v.batch_id LEFT JOIN resellers rs ON rs.id = v.reseller_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.id DESC LIMIT 20000`,
      params,
    );
    const csv = toCsv(rows, [
      ['code', 'Kode'],
      ['password', 'Password'],
      ['profile', 'Profil'],
      ['price', 'Harga'],
      ['status', 'Status'],
      ['router_name', 'Router'],
      ['batch_code', 'Batch'],
      ['reseller_name', 'Reseller'],
      ['validity', 'Masa Aktif'],
      ['activated_at', 'Diaktifkan'],
      ['expires_at', 'Kedaluwarsa'],
      ['mac', 'MAC'],
      ['uptime_seconds', 'Uptime (detik)'],
      ['created_at', 'Dibuat'],
    ]);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="voucher.csv"');
    return csv;
  });
}
