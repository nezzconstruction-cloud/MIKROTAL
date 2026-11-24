import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFrom, idParam, makeAuth, type AppContext } from '../context.js';
import { isValidDuration, parseBytes } from '../lib/duration.js';
import { HttpError } from '../services/vouchers.js';
import { looksLikeVoucher } from '../lib/mikhmon.js';

const durationField = z
  .string()
  .trim()
  .max(32)
  .default('')
  .refine(isValidDuration, 'Format durasi tidak valid. Contoh: 30m, 3h, 1d, 7d, 1w');

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Nama profil wajib diisi').max(64).regex(/^[^\s"'\\]+$/, 'Nama profil tanpa spasi atau tanda kutip'),
  rate_limit: z.string().trim().max(128).default(''),
  shared_users: z.coerce.number().int().min(1).max(100).default(1),
  session_timeout: durationField,
  idle_timeout: durationField,
  keepalive_timeout: durationField,
  address_pool: z.string().trim().max(64).default(''),
  parent_queue: z.string().trim().max(64).default(''),
  mac_cookie_timeout: durationField,
  price: z.coerce.number().min(0).default(0),
  reseller_price: z.coerce.number().min(0).default(0),
  validity: durationField,
  time_limit: durationField,
  data_limit: z.union([z.string(), z.number()]).default(0),
  /** Kunci voucher ke perangkat pertama yang login. Tidak dikirim = setelan lama dipertahankan. */
  lock_mac: z.boolean().optional(),
  color: z.string().trim().max(16).default(''),
});

export async function hotspotRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = makeAuth(ctx);

  const rid = (v: unknown) => {
    const id = idParam(v);
    ctx.routers.require(id);
    return id;
  };

  app.get('/api/routers/:id/hotspot/profiles', { preHandler: auth() }, async (req) => {
    const id = rid((req.params as any).id);
    const [profiles, users, active] = await Promise.all([
      ctx.routers.exec(id, '/ip/hotspot/user/profile/print'),
      ctx.routers.exec(id, '/ip/hotspot/user/print', { '.proplist': 'profile' }).catch(() => []),
      ctx.routers.exec(id, '/ip/hotspot/active/print', { '.proplist': 'user' }).catch(() => []),
    ]);
    const metas = new Map(ctx.db.all<any>('SELECT * FROM profile_meta WHERE router_id = ?', [id]).map((m) => [m.profile, m]));
    const stock = new Map(
      ctx.db
        .all<{ profile: string; n: number }>(`SELECT profile, COUNT(*) AS n FROM vouchers WHERE router_id = ? AND status = 'unused' GROUP BY profile`, [id])
        .map((r) => [r.profile, r.n]),
    );
    const userCount = new Map<string, number>();
    for (const u of users) userCount.set(u.profile ?? 'default', (userCount.get(u.profile ?? 'default') ?? 0) + 1);
    void active;
    return profiles.map((p) => {
      const m = metas.get(p.name);
      return {
        ...p,
        meta: {
          price: m?.price ?? 0,
          reseller_price: m?.reseller_price ?? 0,
          validity: m?.validity ?? '',
          time_limit: m?.time_limit ?? '',
          data_limit: m?.data_limit ?? 0,
          color: m?.color ?? '',
          lock_mac: !!m?.lock_mac,
        },
        users: userCount.get(p.name) ?? 0,
        stock: stock.get(p.name) ?? 0,
      };
    });
  });

  /** Diperiksa sebelum router diubah. */
  const checkPrices = (b: z.infer<typeof profileSchema>) => {
    if (b.price > 0 && b.reseller_price > b.price) throw new HttpError(400, 'Harga reseller tidak boleh lebih mahal dari harga jual ke pelanggan');
    return b;
  };

  const saveMeta = (routerId: number, b: z.infer<typeof profileSchema>) => {
    const lockMac = b.lock_mac === undefined ? null : b.lock_mac ? 1 : 0;
    ctx.db.run(
      `INSERT INTO profile_meta (router_id, profile, price, reseller_price, validity, time_limit, data_limit, color, lock_mac) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0))
       ON CONFLICT(router_id, profile) DO UPDATE SET price = excluded.price, reseller_price = excluded.reseller_price, validity = excluded.validity,
       time_limit = excluded.time_limit, data_limit = excluded.data_limit, color = excluded.color, lock_mac = COALESCE(?, lock_mac)`,
      [routerId, b.name, b.price, b.reseller_price, b.validity, b.time_limit, parseBytes(b.data_limit), b.color, lockMac, lockMac],
    );
  };

  const rosParams = (b: z.infer<typeof profileSchema>, isNew: boolean) => {
    const p: Record<string, string | undefined> = {
      name: b.name,
      'rate-limit': b.rate_limit,
      'shared-users': String(b.shared_users),
      'session-timeout': b.session_timeout || (isNew ? undefined : '0s'),
      'idle-timeout': b.idle_timeout || (isNew ? undefined : 'none'),
      'keepalive-timeout': b.keepalive_timeout || undefined,
      'address-pool': b.address_pool || (isNew ? undefined : 'none'),
      'parent-queue': b.parent_queue || (isNew ? undefined : 'none'),
      'mac-cookie-timeout': b.mac_cookie_timeout || undefined,
    };
    if (isNew && !b.rate_limit) delete p['rate-limit'];
    return p;
  };

  app.post('/api/routers/:id/hotspot/profiles', { preHandler: auth('hotspot.write') }, async (req) => {
    const id = rid((req.params as any).id);
    const b = checkPrices(profileSchema.parse(req.body));
    await ctx.routers.exec(id, '/ip/hotspot/user/profile/add', rosParams(b, true));
    saveMeta(id, b);
    auditFrom(ctx, req, 'hotspot.profile.create', b.name, { routerId: id, price: b.price, validity: b.validity });
    ctx.portal.schedulePriceRefresh(id, req.user.username);
    return { ok: true };
  });

  app.put('/api/routers/:id/hotspot/profiles/:name', { preHandler: auth('hotspot.write') }, async (req) => {
    const id = rid((req.params as any).id);
    const oldName = String((req.params as any).name);
    const b = checkPrices(profileSchema.parse(req.body));
    const [found] = await ctx.routers.exec(id, '/ip/hotspot/user/profile/print', {}, [`?name=${oldName}`]);
    if (!found) throw new HttpError(404, 'Profil tidak ditemukan di router');
    await ctx.routers.exec(id, '/ip/hotspot/user/profile/set', { '.id': found['.id'], ...rosParams(b, false) });
    if (oldName !== b.name) {
      ctx.db.run('UPDATE profile_meta SET profile = ? WHERE router_id = ? AND profile = ?', [b.name, id, oldName]);
      ctx.db.run('UPDATE vouchers SET profile = ? WHERE router_id = ? AND profile = ?', [b.name, id, oldName]);
    }
    saveMeta(id, b);
    auditFrom(ctx, req, 'hotspot.profile.update', b.name, { routerId: id });
    ctx.portal.schedulePriceRefresh(id, req.user.username);
    return { ok: true };
  });

  app.delete('/api/routers/:id/hotspot/profiles/:name', { preHandler: auth('hotspot.write') }, async (req) => {
    const id = rid((req.params as any).id);
    const name = String((req.params as any).name);
    if (name === 'default') throw new HttpError(400, 'Profil default tidak bisa dihapus');
    const [found] = await ctx.routers.exec(id, '/ip/hotspot/user/profile/print', {}, [`?name=${name}`]);
    if (found) await ctx.routers.exec(id, '/ip/hotspot/user/profile/remove', { '.id': found['.id'] });
    ctx.db.run('DELETE FROM profile_meta WHERE router_id = ? AND profile = ?', [id, name]);
    auditFrom(ctx, req, 'hotspot.profile.delete', name, { routerId: id });
    ctx.portal.schedulePriceRefresh(id, req.user.username);
    return { ok: true };
  });

  // Sesi aktif + info voucher
  app.get('/api/routers/:id/hotspot/active', { preHandler: auth('hotspot.view') }, async (req) => {
    const id = rid((req.params as any).id);
    const rows = await ctx.routers.exec(id, '/ip/hotspot/active/print');
    const codes = rows.map((r) => r.user).filter(Boolean);
    const vmap = new Map<string, any>();
    if (codes.length) {
      const placeholders = codes.map(() => '?').join(',');
      for (const v of ctx.db.all<any>(`SELECT code, profile, price, expires_at, activated_at, validity FROM vouchers WHERE router_id = ? AND code IN (${placeholders})`, [id, ...codes])) {
        vmap.set(v.code, v);
      }
    }
    return rows.map((r) => ({ ...r, voucher: vmap.get(r.user) ?? null }));
  });

  app.post('/api/routers/:id/hotspot/active/:item/kick', { preHandler: auth('hotspot.write') }, async (req) => {
    const id = rid((req.params as any).id);
    const item = String((req.params as any).item);
    if (!/^\*[0-9A-F]+$/i.test(item)) throw new HttpError(400, 'ID tidak valid');
    await ctx.routers.exec(id, '/ip/hotspot/active/remove', { '.id': item });
    auditFrom(ctx, req, 'hotspot.active.kick', item, { routerId: id });
    return { ok: true };
  });

  // Tambah satu pengguna hotspot (member) secara cepat
  app.post('/api/routers/:id/hotspot/users', { preHandler: auth('hotspot.write') }, async (req) => {
    const id = rid((req.params as any).id);
    const b = z
      .object({
        name: z.string().trim().min(1).max(64),
        password: z.string().max(64).default(''),
        profile: z.string().trim().min(1).default('default'),
        server: z.string().trim().default('all'),
        limit_uptime: durationField,
        limit_bytes_total: z.union([z.string(), z.number()]).default(0),
        mac_address: z.string().trim().max(17).default(''),
        comment: z.string().max(200).default(''),
      })
      .parse(req.body);
    const bytes = parseBytes(b.limit_bytes_total);
    const rows = await ctx.routers.exec(id, '/ip/hotspot/user/add', {
      name: b.name,
      password: b.password,
      profile: b.profile,
      server: b.server !== 'all' ? b.server : undefined,
      'limit-uptime': b.limit_uptime || undefined,
      'limit-bytes-total': bytes > 0 ? bytes : undefined,
      'mac-address': b.mac_address || undefined,
      comment: b.comment || undefined,
    });
    auditFrom(ctx, req, 'hotspot.user.create', b.name, { routerId: id, profile: b.profile });
    return { id: rows[0]?.ret ?? null };
  });

  app.post('/api/routers/:id/hotspot/import', { preHandler: auth('voucher.write') }, async (req) => {
    const id = rid((req.params as any).id);
    const b = z.object({ profile: z.string().optional(), commentContains: z.string().optional(), vouchersOnly: z.boolean().default(false) }).parse(req.body ?? {});
    const offset = ctx.settings.get().brand.timezoneOffset;
    const r = await ctx.vouchers.importFromRouter(id, { ...b, filter: b.vouchersOnly ? (u) => looksLikeVoucher(u, offset) : undefined });
    auditFrom(ctx, req, 'voucher.import', '', { routerId: id, ...r });
    return r;
  });
}
