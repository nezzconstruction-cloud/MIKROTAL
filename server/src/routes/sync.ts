import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFrom, idParam, makeAuth, type AppContext } from '../context.js';
import { isValidDuration } from '../lib/duration.js';
import type { RosRow } from '../lib/routeros/types.js';

/** Hitungan setelan router lain yang dikelola langsung (dibaca langsung dari router, tidak disalin). */
const LIVE_MENUS: { key: string; path: string; label: string; to: string }[] = [
  { key: 'interfaces', path: '/interface', label: 'Interface', to: '/res/interfaces' },
  { key: 'addresses', path: '/ip/address', label: 'IP Address', to: '/res/ip-address' },
  { key: 'pools', path: '/ip/pool', label: 'IP Pool', to: '/res/pools' },
  { key: 'pppoe', path: '/interface/pppoe-server/server', label: 'PPPoE Server', to: '/res/pppoe-servers' },
  { key: 'filter', path: '/ip/firewall/filter', label: 'Firewall Filter', to: '/res/firewall-filter' },
  { key: 'nat', path: '/ip/firewall/nat', label: 'NAT', to: '/res/firewall-nat' },
  { key: 'mangle', path: '/ip/firewall/mangle', label: 'Mangle', to: '/res/firewall-mangle' },
  { key: 'queue', path: '/queue/simple', label: 'Simple Queue', to: '/res/queue-simple' },
  { key: 'tree', path: '/queue/tree', label: 'Queue Tree', to: '/router-menu?path=/queue/tree' },
  { key: 'dhcp', path: '/ip/dhcp-server/lease', label: 'DHCP Lease', to: '/res/dhcp-leases' },
  { key: 'routes', path: '/ip/route', label: 'Routing', to: '/res/routes' },
  { key: 'scheduler', path: '/system/scheduler', label: 'Scheduler', to: '/res/scheduler' },
];

export async function syncRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = makeAuth(ctx);

  /** Bandingkan data di router dengan data bisnis di MIKROTAL (paket, pelanggan, voucher). */
  app.get('/api/routers/:id/sync', { preHandler: auth('config.view') }, async (req) => {
    const id = idParam((req.params as any).id);
    ctx.routers.require(id);
    const ex = (cmd: string, params: Record<string, string> = {}) => ctx.routers.exec(id, cmd, params).catch(() => null as RosRow[] | null);
    const [pppProfiles, secrets, hsProfiles, hsUsers, ...counts] = await Promise.all([
      ctx.routers.exec(id, '/ppp/profile/print'),
      ctx.routers.exec(id, '/ppp/secret/print', { '.proplist': 'name,profile,service,comment,disabled' }),
      ex('/ip/hotspot/user/profile/print', { '.proplist': 'name,rate-limit,shared-users' }),
      ex('/ip/hotspot/user/print', { '.proplist': 'name,profile' }),
      ...LIVE_MENUS.map((m) => ex(`${m.path}/print`, { '.proplist': '.id' })),
    ]);
    const isolir = ctx.settings.get().pppoe.isolirProfile;
    const packages = ctx.db.all<any>('SELECT id, name, profile, price, validity FROM ppp_packages WHERE router_id = ?', [id]);
    const customers = ctx.db.all<any>('SELECT id, name, username, on_router FROM customers WHERE router_id = ?', [id]);
    const known = new Set(customers.map((c) => c.username));
    const secretNames = new Set(secrets.map((s) => s.name));
    const pppSecrets = secrets.filter((s) => !s.service || ['pppoe', 'any'].includes(s.service));
    const bySecretProfile = new Map<string, number>();
    for (const s of pppSecrets) bySecretProfile.set(s.profile ?? 'default', (bySecretProfile.get(s.profile ?? 'default') ?? 0) + 1);

    const profiles = pppProfiles
      .filter((p) => p.name && p.name !== isolir && p.name !== 'default-encryption')
      .map((p) => ({
        name: p.name,
        rateLimit: p['rate-limit'] ?? '',
        localAddress: p['local-address'] ?? '',
        remoteAddress: p['remote-address'] ?? '',
        bridge: p.bridge ?? '',
        onlyOne: p['only-one'] ?? '',
        isDefault: p.default === 'true' || p.name === 'default',
        secrets: bySecretProfile.get(p.name) ?? 0,
        packages: packages.filter((k) => k.profile === p.name).map((k) => ({ id: k.id, name: k.name, price: k.price, validity: k.validity })),
      }));

    const metas = new Set(ctx.db.all<{ profile: string }>('SELECT profile FROM profile_meta WHERE router_id = ? AND price > 0', [id]).map((m) => m.profile));
    const vouchers = new Set(ctx.db.all<{ code: string }>('SELECT code FROM vouchers WHERE router_id = ?', [id]).map((v) => v.code));
    return {
      ppp: {
        profiles,
        secretsTotal: pppSecrets.length,
        notImported: pppSecrets.filter((s) => !known.has(s.name)).map((s) => ({ name: s.name, profile: s.profile ?? '', comment: s.comment ?? '', disabled: s.disabled === 'true' })),
        missingOnRouter: customers.filter((c) => !secretNames.has(c.username)).map((c) => ({ id: c.id, name: c.name, username: c.username })),
        customers: customers.length,
      },
      hotspot: hsProfiles
        ? {
            profiles: hsProfiles.filter((p) => p.name !== 'default').map((p) => ({ name: p.name, rateLimit: p['rate-limit'] ?? '', priced: metas.has(p.name), users: (hsUsers ?? []).filter((u) => u.profile === p.name).length })),
            usersTotal: (hsUsers ?? []).filter((u) => u.name !== 'default-trial').length,
            notTracked: (hsUsers ?? []).filter((u) => u.name !== 'default-trial' && !vouchers.has(u.name)).length,
          }
        : null,
      live: LIVE_MENUS.map((m, i) => ({ key: m.key, label: m.label, to: m.to, count: counts[i] ? counts[i]!.length : null })),
      scannedAt: new Date().toISOString(),
    };
  });

  /** Jadikan PPP Profile yang ada di router sebagai paket MIKROTAL (harga diisi kemudian). */
  app.post('/api/routers/:id/sync/packages', { preHandler: auth('customer.write') }, async (req) => {
    const id = idParam((req.params as any).id);
    const b = z
      .object({
        profiles: z.array(z.string().min(1).max(64)).min(1).max(100),
        validity: z.string().trim().refine(isValidDuration, 'Format masa aktif tidak valid (contoh 30d)').default('30d'),
        price: z.coerce.number().min(0).default(0),
      })
      .parse(req.body);
    const created: string[] = [];
    const skipped: { profile: string; reason: string }[] = [];
    for (const profile of b.profiles) {
      const exists = ctx.db.get('SELECT id FROM ppp_packages WHERE router_id = ? AND (name = ? OR profile = ?)', [id, profile, profile]);
      if (exists) {
        skipped.push({ profile, reason: 'sudah ada paket' });
        continue;
      }
      try {
        await ctx.pppoe.savePackage({ routerId: id, name: profile, profile, price: b.price, resellerPrice: 0, validity: b.validity, active: true });
        created.push(profile);
      } catch (err) {
        skipped.push({ profile, reason: (err as Error).message });
      }
    }
    auditFrom(ctx, req, 'sync.packages', String(id), { created, skipped: skipped.length });
    return { created, skipped };
  });
}
