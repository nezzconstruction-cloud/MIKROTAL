import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFrom, idParam, makeAuth, type AppContext } from '../context.js';
import { sanitizeParams } from '../lib/resources.js';
import { RouterOSError } from '../lib/routeros/types.js';
import { HttpError } from '../services/vouchers.js';

/** Path menu RouterOS yang boleh dibuka lewat "Semua Menu Router", mis. /interface/ovpn-server/server. */
const PATH_RE = /^(\/[a-z0-9][a-z0-9-]*){1,6}$/;
/** Menu yang bisa mengunci akses atau menghapus sistem: ubah hanya oleh Super Admin. */
const SUPER_ONLY = [/^\/user(\/|$)/, /^\/ip\/service$/, /^\/system\/package(\/|$)/, /^\/certificate(\/|$)/, /^\/system\/routerboard(\/|$)/, /^\/system\/license$/, /^\/file$/];
/** Bukan menu: perintah yang tidak boleh dipanggil sebagai path. */
const BLOCKED = [/^\/system\/(reset-configuration|shutdown|reboot)$/, /^\/quit$/, /^\/login$/];

function checkPath(raw: unknown) {
  const path = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '/')
    .replace(/\/+$/, '');
  if (!PATH_RE.test(path)) throw new HttpError(400, 'Path menu tidak valid. Contoh: /ip/firewall/filter');
  if (BLOCKED.some((r) => r.test(path))) throw new HttpError(400, 'Path ini perintah, bukan menu');
  return path;
}

function itemIds(v: unknown): string[] {
  const ids = (Array.isArray(v) ? v : [v]).map(String);
  if (!ids.length || ids.some((s) => !/^\*[0-9A-Fa-f]+$/.test(s))) throw new HttpError(400, 'ID item tidak valid');
  return ids;
}

function friendly(err: unknown, path: string): never {
  if (err instanceof RouterOSError && /no such command|unknown command|no such item.*prefix/i.test(err.message)) {
    throw new HttpError(404, `Menu ${path} tidak ada di RouterOS router ini (beda versi atau paket belum aktif)`);
  }
  throw err;
}

function mask(p: Record<string, string>) {
  const out = { ...p };
  for (const k of Object.keys(out)) if (/password|secret|key/i.test(k)) out[k] = '***';
  return out;
}

export async function explorerRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = makeAuth(ctx);
  const rid = (req: FastifyRequest) => {
    const id = idParam((req.params as any).id);
    ctx.routers.require(id);
    return id;
  };
  const guardWrite = (req: FastifyRequest, path: string) => {
    if (SUPER_ONLY.some((r) => r.test(path)) && req.user.role !== 'superadmin') throw new HttpError(403, `Menu ${path} hanya bisa diubah Super Admin`);
  };

  app.get('/api/routers/:id/ros', { preHandler: auth('config.view') }, async (req) => {
    const id = rid(req);
    const path = checkPath((req.query as any).path);
    const rows = await ctx.routers.exec(id, `${path}/print`).catch((e) => friendly(e, path));
    return { path, rows, singleton: rows.length === 1 && !rows[0]['.id'] };
  });

  app.post('/api/routers/:id/ros/add', { preHandler: auth('system.danger') }, async (req) => {
    const id = rid(req);
    const b = z.object({ path: z.string(), params: z.record(z.string(), z.unknown()) }).parse(req.body);
    const path = checkPath(b.path);
    guardWrite(req, path);
    const params = sanitizeParams(b.params);
    if (!Object.keys(params).length) throw new HttpError(400, 'Isi minimal satu properti');
    const rows = await ctx.routers.exec(id, `${path}/add`, params).catch((e) => friendly(e, path));
    auditFrom(ctx, req, 'router.ros.add', path, { routerId: id, ...mask(params) });
    return { id: rows[0]?.ret ?? null };
  });

  app.post('/api/routers/:id/ros/set', { preHandler: auth('system.danger') }, async (req) => {
    const id = rid(req);
    const b = z.object({ path: z.string(), id: z.string().optional(), params: z.record(z.string(), z.unknown()) }).parse(req.body);
    const path = checkPath(b.path);
    guardWrite(req, path);
    const params = sanitizeParams(b.params);
    if (!Object.keys(params).length) return { ok: true, unchanged: true };
    const target = b.id ? { '.id': itemIds(b.id)[0] } : {};
    await ctx.routers.exec(id, `${path}/set`, { ...target, ...params }).catch((e) => friendly(e, path));
    auditFrom(ctx, req, 'router.ros.set', `${path}${b.id ? ' ' + b.id : ''}`, { routerId: id, ...mask(params) });
    return { ok: true };
  });

  app.post('/api/routers/:id/ros/action', { preHandler: auth('system.danger') }, async (req) => {
    const id = rid(req);
    const b = z.object({ path: z.string(), ids: z.array(z.string()).min(1).max(500), action: z.enum(['enable', 'disable', 'remove']) }).parse(req.body);
    const path = checkPath(b.path);
    guardWrite(req, path);
    const ids = itemIds(b.ids);
    for (let i = 0; i < ids.length; i += 50) {
      await ctx.routers.exec(id, `${path}/${b.action}`, { '.id': ids.slice(i, i + 50).join(',') }).catch((e) => friendly(e, path));
    }
    auditFrom(ctx, req, `router.ros.${b.action}`, path, { routerId: id, count: ids.length });
    return { ok: true, count: ids.length };
  });
}
