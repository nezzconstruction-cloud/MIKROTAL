import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFrom, idParam, makeAuth, type AppContext } from '../context.js';
import { MONTH_OPTIONS } from '../cloud/platform.js';
import { VPN_KINDS, type VpnPeerRow } from '../cloud/vpn.js';
import { serverTunnelIp } from '../cloud/net.js';
import { publicRouter } from '../services/routers.js';
import { HttpError } from '../services/vouchers.js';

const publicPeer = (p: VpnPeerRow) => ({
  id: p.id,
  name: p.name,
  kind: p.kind,
  tunnel_ip: p.tunnel_ip,
  ppp_user: p.ppp_user,
  api_user: p.api_user,
  router_id: p.router_id,
  last_seen_at: p.last_seen_at,
  created_at: p.created_at,
});

/** API langganan & VPN untuk aplikasi pelanggan MIKROTAL Cloud. */
export async function cloudRoutes(app: FastifyInstance, ctx: AppContext) {
  const cloud = ctx.cloud!;
  const { platform, vpn } = cloud;
  const auth = makeAuth(ctx);
  const realRouters = () => ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM routers WHERE simulate = 0')!.n;

  app.get('/api/cloud/subscription', { preHandler: auth() }, async () => {
    const t = cloud.tenant();
    const s = platform.settings.get();
    return {
      tenant: { slug: t.slug, business_name: t.business_name, owner_name: t.owner_name, email: t.email, phone: t.phone, created_at: t.created_at },
      status: cloud.status(),
      usage: { routers: realRouters() },
      plans: platform.plans().map((p) => ({ code: p.code, name: p.name, price_monthly: p.price_monthly, max_routers: p.max_routers, description: p.description })),
      months: MONTH_OPTIONS,
      bankAccounts: s.bankAccounts,
      paymentNote: s.paymentNote,
      support: { whatsapp: s.supportWhatsapp, email: s.supportEmail },
      brandName: s.brandName,
      publicUrl: cloud.publicUrl,
    };
  });

  // ---- tagihan (transfer manual) ----
  app.get('/api/cloud/invoices', { preHandler: auth('settings.manage') }, async () => {
    return platform.invoices({ tenantId: cloud.tenant().id }).map(({ slug, business_name, ...inv }) => ({ ...inv, has_proof: !!inv.proof_file }));
  });

  app.post('/api/cloud/invoices', { preHandler: auth('settings.manage') }, async (req) => {
    const b = z.object({ planCode: z.string().min(1), months: z.coerce.number().int() }).parse(req.body);
    const inv = platform.createInvoice(cloud.tenant().id, b.planCode, b.months);
    auditFrom(ctx, req, 'cloud.invoice.create', inv.number, { amount: inv.amount });
    return inv;
  });

  app.post(
    '/api/cloud/invoices/:id/proof',
    { preHandler: auth('settings.manage'), bodyLimit: 4 * 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req) => {
      const b = z
        .object({
          fileName: z.string().min(1).max(200),
          dataBase64: z.string().min(1),
          payerName: z.string().trim().min(1, 'Nama pengirim wajib diisi').max(100),
          note: z.string().trim().max(500).default(''),
        })
        .parse(req.body);
      const inv = platform.submitProof(cloud.tenant().id, idParam((req.params as any).id), {
        fileName: b.fileName,
        data: Buffer.from(b.dataBase64.replace(/^data:[^,]*,/, ''), 'base64'),
        payerName: b.payerName,
        note: b.note,
      });
      auditFrom(ctx, req, 'cloud.invoice.proof', inv.number);
      return inv;
    },
  );

  app.post('/api/cloud/invoices/:id/cancel', { preHandler: auth('settings.manage') }, async (req) => {
    platform.cancelInvoice(cloud.tenant().id, idParam((req.params as any).id));
    return { ok: true };
  });

  // ---- VPN: menghubungkan router ke MIKROTAL Cloud ----
  app.get('/api/cloud/vpn', { preHandler: auth('router.manage') }, async () => {
    const t = cloud.tenant();
    const peers = vpn.peers(t.id);
    const status = await vpn.status(t.id).catch(() => new Map());
    const c = platform.settings.get().chr;
    return {
      readiness: vpn.readiness(),
      endpoint: c.endpoint,
      serverIp: serverTunnelIp(c.tunnelNetwork),
      maxRouters: cloud.status().maxRouters,
      usage: realRouters(),
      peers: peers.map((p) => {
        const r = p.router_id ? ctx.routers.get(p.router_id) : undefined;
        return {
          ...publicPeer(p),
          vpn: status.get(p.id) ?? { online: false, lastSeen: p.last_seen_at, detail: '' },
          router: r ? { id: r.id, name: r.name, status: r.status, status_message: r.status_message } : null,
        };
      }),
    };
  });

  app.post('/api/cloud/vpn', { preHandler: auth('router.manage'), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(1, 'Nama router wajib diisi').max(64),
        kind: z.enum(VPN_KINDS as [string, ...string[]]),
        location: z.string().trim().max(128).default(''),
      })
      .parse(req.body);
    const st = cloud.status();
    const t = cloud.tenant();
    if (realRouters() >= st.maxRouters || vpn.peers(t.id).length >= st.maxRouters)
      throw new HttpError(
        402,
        `Paket ${st.planName} maksimal ${st.maxRouters} router. Hapus koneksi VPN/router yang tidak dipakai, atau upgrade paket untuk menambah router.`,
      );
    const peer = await vpn.create(t, { name: b.name, kind: b.kind as any });
    // Router langsung terdaftar di MIKROTAL dengan IP tunnel dan akun API yang dibuat skrip
    const cred = vpn.apiCredentials(peer);
    const { lastId } = ctx.db.run(
      `INSERT INTO routers (name, host, port, username, password_enc, use_tls, simulate, location, notes, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 1, ?)`,
      [b.name, cred.host, cred.port, cred.username, ctx.box.encrypt(cred.password), b.location, `Terhubung lewat VPN ${peer.kind} (${peer.tunnel_ip}).`, new Date().toISOString()],
    );
    vpn.setRouterId(peer.id, lastId);
    auditFrom(ctx, req, 'cloud.vpn.create', b.name, { kind: peer.kind, tunnelIp: peer.tunnel_ip });
    void ctx.monitor.pollRouter(ctx.routers.require(lastId)).catch(() => undefined);
    return { peer: publicPeer({ ...peer, router_id: lastId }), router: publicRouter(ctx.routers.require(lastId)), script: vpn.script(peer) };
  });

  app.get('/api/cloud/vpn/:id/script', { preHandler: auth('router.manage') }, async (req) => {
    const peer = vpn.peer(cloud.tenant().id, idParam((req.params as any).id));
    return { script: vpn.script(peer) };
  });

  app.delete('/api/cloud/vpn/:id', { preHandler: auth('router.manage') }, async (req) => {
    const deleteRouter = String((req.query as any)?.deleteRouter ?? '') === 'true';
    const peer = await vpn.remove(cloud.tenant(), idParam((req.params as any).id));
    if (deleteRouter && peer.router_id && ctx.routers.get(peer.router_id)) {
      ctx.routers.disconnect(peer.router_id);
      ctx.monitor.forget(peer.router_id);
      ctx.db.run('DELETE FROM routers WHERE id = ?', [peer.router_id]);
    }
    auditFrom(ctx, req, 'cloud.vpn.remove', peer.name, { tunnelIp: peer.tunnel_ip, deleteRouter });
    return { ok: true };
  });
}
