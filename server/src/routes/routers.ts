import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFrom, idParam, makeAuth, type AppContext } from '../context.js';
import { RESOURCE_RULES, SINGLETON_RULES, sanitizeParams } from '../lib/resources.js';
import { hasPermission } from '../lib/security.js';
import { publicRouter, type RouterRecord } from '../services/routers.js';
import { HttpError } from '../services/vouchers.js';
import { MAX_SIMULATED_ROUTERS } from '../cloud/bridge.js';

const routerSchema = z.object({
  name: z.string().trim().min(1, 'Nama router wajib diisi').max(64),
  host: z.string().trim().min(1, 'Host/IP wajib diisi').max(255),
  port: z.coerce.number().int().min(1).max(65535).default(8728),
  username: z.string().trim().min(1, 'Username wajib diisi').max(64),
  password: z.string().max(256).optional(),
  use_tls: z.boolean().default(false),
  simulate: z.boolean().default(false),
  location: z.string().trim().max(128).default(''),
  wan_interface: z.string().trim().max(64).default(''),
  hotspot_dns: z.string().trim().max(128).default(''),
  notes: z.string().max(1000).default(''),
  enabled: z.boolean().default(true),
});

function itemId(v: unknown): string {
  const s = String(v ?? '');
  if (!/^\*[0-9A-Fa-f]+$/.test(s)) throw new HttpError(400, 'ID item tidak valid');
  return s;
}

function resourcePath(q: unknown): string {
  const p = String((q as any)?.path ?? '');
  if (!RESOURCE_RULES[p]) throw new HttpError(400, `Menu ${p || '(kosong)'} tidak diizinkan`);
  return p;
}

export async function routerRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = makeAuth(ctx);

  const rid = (req: FastifyRequest) => {
    const id = idParam((req.params as any).id);
    ctx.routers.require(id);
    return id;
  };

  const checkWrite = (req: FastifyRequest, path: string, action: 'add' | 'set' | 'remove' | 'toggle') => {
    const rule = RESOURCE_RULES[path];
    if (rule.readOnly) throw new HttpError(400, 'Menu ini hanya baca');
    if (action === 'add' && rule.noAdd) throw new HttpError(400, 'Menu ini tidak mendukung penambahan item');
    const perm = rule.group === 'hotspot' ? 'hotspot.write' : 'config.write';
    if (!hasPermission(req.user.role, perm)) throw new HttpError(403, 'Anda tidak memiliki akses mengubah menu ini');
    if (rule.danger && !hasPermission(req.user.role, 'system.danger')) throw new HttpError(403, 'Menu sensitif, hanya admin');
  };

  /** Mode cloud: batas jumlah router sesuai paket, dan alamat router harus boleh dihubungi. */
  const cloudCheck = async (b: { host: string; simulate: boolean }, exceptId?: number) => {
    if (!ctx.cloud) return;
    const count = (simulate: boolean) =>
      ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM routers WHERE simulate = ? AND id != ?', [simulate ? 1 : 0, exceptId ?? 0])!.n;
    if (b.simulate) {
      if (count(true) >= MAX_SIMULATED_ROUTERS) throw new HttpError(400, `Router simulasi maksimal ${MAX_SIMULATED_ROUTERS}`);
      return;
    }
    const st = ctx.cloud.status();
    if (count(false) >= st.maxRouters)
      throw new HttpError(402, `Paket ${st.planName} maksimal ${st.maxRouters} router. Upgrade paket di menu Langganan & VPN untuk menambah router.`);
    await ctx.cloud.resolveRouterHost(b.host);
  };

  // ---- CRUD router ----
  app.get('/api/routers', { preHandler: auth() }, async (req) => {
    const list = ctx.routers.list();
    if (!hasPermission(req.user.role, 'router.view')) {
      // Reseller cukup tahu nama router untuk memilih tempat voucher dibuat
      return list
        .filter((r) => r.enabled)
        .map((r) => ({ id: r.id, name: r.name, location: r.location, enabled: true, simulate: !!r.simulate, hotspot_dns: r.hotspot_dns, snapshot: null }));
    }
    return list.map((r) => ({ ...publicRouter(r), snapshot: ctx.monitor.latest.get(r.id) ?? null }));
  });

  app.get('/api/routers/:id', { preHandler: auth('router.view') }, async (req) => {
    const r = ctx.routers.require(idParam((req.params as any).id));
    return { ...publicRouter(r), snapshot: ctx.monitor.latest.get(r.id) ?? null };
  });

  app.post('/api/routers/test', { preHandler: auth('router.manage') }, async (req) => {
    const b = routerSchema.extend({ id: z.number().optional() }).parse(req.body);
    if (ctx.cloud && !b.simulate) await ctx.cloud.resolveRouterHost(b.host);
    let password = b.password ?? '';
    if (!password && b.id) password = ctx.box.decrypt(ctx.routers.get(b.id)?.password_enc ?? '');
    return ctx.routers.test({ host: b.host, port: b.port, username: b.username, password, tls: b.use_tls, simulate: b.simulate, name: b.name });
  });

  app.post('/api/routers', { preHandler: auth('router.manage') }, async (req) => {
    const b = routerSchema.parse(req.body);
    await cloudCheck(b);
    const { lastId } = ctx.db.run(
      `INSERT INTO routers (name, host, port, username, password_enc, use_tls, simulate, location, wan_interface, hotspot_dns, notes, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.name, b.host, b.port, b.username, ctx.box.encrypt(b.password ?? ''), b.use_tls, b.simulate, b.location, b.wan_interface, b.hotspot_dns, b.notes, b.enabled, new Date().toISOString()],
    );
    auditFrom(ctx, req, 'router.create', b.name, { host: b.host, port: b.port });
    const r = ctx.routers.require(lastId);
    void ctx.monitor.pollRouter(r);
    return publicRouter(r);
  });

  app.patch('/api/routers/:id', { preHandler: auth('router.manage') }, async (req) => {
    const id = rid(req);
    const cur = ctx.routers.require(id);
    const b = routerSchema.partial().parse(req.body);
    const next = { ...cur, ...b } as any;
    // Mengubah router yang sudah ada tidak dihitung menambah, kecuali router simulasi dijadikan router asli
    if (ctx.cloud && !!cur.simulate !== !!next.simulate) await cloudCheck({ host: next.host, simulate: !!next.simulate }, id);
    else if (ctx.cloud && !next.simulate && b.host !== undefined) await ctx.cloud.resolveRouterHost(next.host);
    ctx.db.run(
      `UPDATE routers SET name = ?, host = ?, port = ?, username = ?, use_tls = ?, simulate = ?, location = ?, wan_interface = ?, hotspot_dns = ?, notes = ?, enabled = ? WHERE id = ?`,
      [next.name, next.host, next.port, next.username, !!next.use_tls, !!next.simulate, next.location, next.wan_interface, next.hotspot_dns, next.notes, !!next.enabled, id],
    );
    if (b.password) ctx.db.run('UPDATE routers SET password_enc = ? WHERE id = ?', [ctx.box.encrypt(b.password), id]);
    ctx.routers.disconnect(id);
    ctx.monitor.forget(id);
    auditFrom(ctx, req, 'router.update', next.name, { ...b, password: b.password ? '***' : undefined });
    const r = ctx.routers.require(id);
    if (r.enabled) void ctx.monitor.pollRouter(r);
    return publicRouter(r);
  });

  app.delete('/api/routers/:id', { preHandler: auth('router.manage') }, async (req) => {
    const id = rid(req);
    const r = ctx.routers.require(id);
    ctx.routers.disconnect(id);
    ctx.monitor.forget(id);
    ctx.db.run('DELETE FROM routers WHERE id = ?', [id]);
    auditFrom(ctx, req, 'router.delete', r.name);
    return { ok: true };
  });

  app.post('/api/routers/:id/reconnect', { preHandler: auth('router.view') }, async (req) => {
    const id = rid(req);
    ctx.routers.disconnect(id);
    const snap = await ctx.monitor.pollRouter(ctx.routers.require(id) as RouterRecord);
    return { snapshot: snap ?? null };
  });

  // ---- Monitoring ----
  app.get('/api/routers/:id/overview', { preHandler: auth('router.view') }, async (req) => {
    const id = rid(req);
    const ex = (cmd: string, params?: Record<string, string>) => ctx.routers.exec(id, cmd, params);
    const safe = async <T>(p: Promise<T>, f: T) => p.catch(() => f);
    const [resource, identity, routerboard, health, clock, interfaces, logs] = await Promise.all([
      ex('/system/resource/print'),
      ex('/system/identity/print'),
      safe(ex('/system/routerboard/print'), []),
      safe(ex('/system/health/print'), []),
      safe(ex('/system/clock/print'), []),
      ex('/interface/print', { '.proplist': '.id,name,type,running,disabled,rx-byte,tx-byte,comment,mac-address,mtu' }),
      safe(ex('/log/print'), []),
    ]);
    return {
      resource: resource[0] ?? {},
      identity: identity[0]?.name ?? '',
      routerboard: routerboard[0] ?? {},
      health,
      clock: clock[0] ?? {},
      interfaces,
      logs: logs.slice(-30).reverse(),
      snapshot: ctx.monitor.latest.get(id) ?? null,
    };
  });

  app.get('/api/routers/:id/metrics', { preHandler: auth('router.view') }, async (req) => {
    const id = rid(req);
    return ctx.monitor.metrics(id, String((req.query as any).range ?? '24h'));
  });

  app.get('/api/routers/:id/traffic', { preHandler: auth('router.view') }, async (req) => {
    const id = rid(req);
    const names = String((req.query as any).interfaces ?? '').split(',').filter(Boolean);
    if (!names.length) throw new HttpError(400, 'Pilih interface');
    const rows = await ctx.routers.exec(id, '/interface/monitor-traffic', { interface: names.join(','), once: '' });
    return rows.map((r) => ({ name: r.name, rx: Number(r['rx-bits-per-second'] ?? 0), tx: Number(r['tx-bits-per-second'] ?? 0) }));
  });

  app.get('/api/routers/:id/logs', { preHandler: auth('router.view') }, async (req) => {
    const id = rid(req);
    const q = req.query as any;
    const limit = Math.min(Number(q.limit ?? 300), 1000);
    let rows = await ctx.routers.exec(id, '/log/print');
    if (q.topic) rows = rows.filter((r) => (r.topics ?? '').includes(String(q.topic)));
    if (q.q) {
      const s = String(q.q).toLowerCase();
      rows = rows.filter((r) => (r.message ?? '').toLowerCase().includes(s));
    }
    return rows.slice(-limit).reverse();
  });

  // ---- Proxy menu RouterOS generik ----
  app.get('/api/routers/:id/res', { preHandler: auth() }, async (req) => {
    const id = rid(req);
    const path = resourcePath(req.query);
    const rule = RESOURCE_RULES[path];
    const perm = rule.group === 'hotspot' ? 'hotspot.view' : 'config.view';
    if (!hasPermission(req.user.role, perm)) throw new HttpError(403, 'Tidak ada akses');
    const proplist = (req.query as any).proplist as string | undefined;
    return ctx.routers.exec(id, `${path}/print`, proplist ? { '.proplist': proplist } : {});
  });

  app.post('/api/routers/:id/res', { preHandler: auth() }, async (req) => {
    const id = rid(req);
    const path = resourcePath(req.query);
    checkWrite(req, path, 'add');
    const params = sanitizeParams(req.body);
    const rows = await ctx.routers.exec(id, `${path}/add`, params);
    auditFrom(ctx, req, 'router.res.add', `${path}`, { routerId: id, ...maskSecrets(params) });
    return { id: rows[0]?.ret ?? null };
  });

  app.patch('/api/routers/:id/res/:item', { preHandler: auth() }, async (req) => {
    const id = rid(req);
    const path = resourcePath(req.query);
    checkWrite(req, path, 'set');
    const item = itemId((req.params as any).item);
    const params = sanitizeParams(req.body);
    await ctx.routers.exec(id, `${path}/set`, { '.id': item, ...params });
    auditFrom(ctx, req, 'router.res.set', `${path} ${item}`, { routerId: id, ...maskSecrets(params) });
    return { ok: true };
  });

  app.delete('/api/routers/:id/res/:item', { preHandler: auth() }, async (req) => {
    const id = rid(req);
    const path = resourcePath(req.query);
    checkWrite(req, path, 'remove');
    const item = itemId((req.params as any).item);
    await ctx.routers.exec(id, `${path}/remove`, { '.id': item });
    auditFrom(ctx, req, 'router.res.remove', `${path} ${item}`, { routerId: id });
    return { ok: true };
  });

  app.post('/api/routers/:id/res/:item/:action', { preHandler: auth() }, async (req) => {
    const id = rid(req);
    const path = resourcePath(req.query);
    const action = String((req.params as any).action);
    if (!['enable', 'disable', 'reset-counters', 'run'].includes(action)) throw new HttpError(400, 'Aksi tidak dikenal');
    checkWrite(req, path, 'toggle');
    const item = itemId((req.params as any).item);
    await ctx.routers.exec(id, `${path}/${action}`, { '.id': item });
    auditFrom(ctx, req, `router.res.${action}`, `${path} ${item}`, { routerId: id });
    return { ok: true };
  });

  app.post('/api/routers/:id/res-bulk', { preHandler: auth() }, async (req) => {
    const id = rid(req);
    const path = resourcePath(req.query);
    const b = z.object({ action: z.enum(['remove', 'enable', 'disable']), ids: z.array(z.string()).min(1).max(500) }).parse(req.body);
    checkWrite(req, path, b.action === 'remove' ? 'remove' : 'toggle');
    const ids = b.ids.map(itemId);
    for (let i = 0; i < ids.length; i += 50) {
      await ctx.routers.exec(id, `${path}/${b.action}`, { '.id': ids.slice(i, i + 50).join(',') });
    }
    auditFrom(ctx, req, `router.res.bulk.${b.action}`, path, { routerId: id, count: ids.length });
    return { ok: true, count: ids.length };
  });

  // ---- Singleton (identity, dns, clock, ntp) ----
  app.get('/api/routers/:id/single', { preHandler: auth('config.view') }, async (req) => {
    const id = rid(req);
    const path = String((req.query as any).path ?? '');
    if (!SINGLETON_RULES[path]) throw new HttpError(400, 'Menu tidak diizinkan');
    const rows = await ctx.routers.exec(id, `${path}/print`);
    return rows[0] ?? {};
  });

  app.patch('/api/routers/:id/single', { preHandler: auth('config.write') }, async (req) => {
    const id = rid(req);
    const path = String((req.query as any).path ?? '');
    const rule = SINGLETON_RULES[path];
    if (!rule || rule.readOnly) throw new HttpError(400, 'Menu tidak dapat diubah');
    const params = sanitizeParams(req.body);
    await ctx.routers.exec(id, `${path}/set`, params);
    auditFrom(ctx, req, 'router.single.set', path, { routerId: id, ...params });
    return { ok: true };
  });

  // ---- Sistem ----
  app.post('/api/routers/:id/reboot', { preHandler: auth('system.danger') }, async (req) => {
    const id = rid(req);
    await ctx.routers.exec(id, '/system/reboot').catch(() => undefined);
    ctx.routers.disconnect(id);
    auditFrom(ctx, req, 'router.reboot', ctx.routers.require(id).name);
    return { ok: true };
  });

  app.post('/api/routers/:id/backup', { preHandler: auth('config.write') }, async (req) => {
    const id = rid(req);
    const r = await ctx.backup.backupRouter(id);
    auditFrom(ctx, req, 'router.backup', r.name, { routerId: id });
    return r;
  });

  app.post('/api/routers/:id/ping', { preHandler: auth('config.view') }, async (req) => {
    const id = rid(req);
    const b = z.object({ address: z.string().trim().min(1).max(255), count: z.number().int().min(1).max(20).default(4) }).parse(req.body);
    const rows = await ctx.routers.exec(id, '/ping', { address: b.address, count: b.count });
    return rows;
  });

  app.post('/api/routers/:id/terminal', { preHandler: auth('terminal') }, async (req) => {
    const id = rid(req);
    const b = z.object({ command: z.string().trim().min(1).max(200), args: z.array(z.string().max(2000)).max(50).default([]) }).parse(req.body);
    let command = b.command.trim();
    if (!command.startsWith('/')) command = '/' + command;
    command = command.replace(/\s+/g, '/');
    if (/^\/(system\/reset-configuration|system\/shutdown|user\/remove|file\/remove)/.test(command) && req.user.role !== 'superadmin') {
      throw new HttpError(403, 'Perintah berbahaya hanya untuk superadmin');
    }
    const params: Record<string, string> = {};
    const queries: string[] = [];
    for (const raw of b.args) {
      const a = raw.trim();
      if (!a) continue;
      if (a.startsWith('?')) queries.push(a);
      else {
        const body = a.startsWith('=') ? a.slice(1) : a;
        const i = body.indexOf('=');
        if (i === -1) params[body] = '';
        else params[body.slice(0, i)] = body.slice(i + 1);
      }
    }
    const started = Date.now();
    auditFrom(ctx, req, 'router.terminal', command, { routerId: id, args: b.args });
    const rows = await ctx.routers.exec(id, command, params, queries);
    return { rows, ms: Date.now() - started };
  });
}

function maskSecrets(p: Record<string, string>) {
  const out = { ...p };
  for (const k of Object.keys(out)) if (/password|secret/i.test(k)) out[k] = '***';
  return out;
}
