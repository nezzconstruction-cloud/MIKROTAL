import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFrom, idParam, makeAuth, type AppContext } from '../context.js';
import { portalConfigSchema } from '../lib/portal/config.js';
import { PORTAL_PAGES, previewVars, renderPage, renderPortalFiles } from '../lib/portal/render.js';
import { renderTemplate } from '../lib/portal/template.js';
import { zip } from '../lib/zip.js';
import { HttpError } from '../services/vouchers.js';

const INSTRUCTIONS = `PORTAL LOGIN HOTSPOT - MIKROTAL
================================

Cara termudah: pakai tombol "Pasang ke router" di MIKROTAL.

Pemasangan manual lewat Winbox:
1. Buka Files, buat folder baru di samping folder hotspot lama
   (mis. flash/mikrotal-portal), lalu seret semua berkas dari ZIP ini ke folder itu.
2. Buka IP > Hotspot > Server Profiles, pilih profil yang dipakai,
   isi HTML Directory dengan folder baru tersebut, lalu OK.
3. Folder hotspot lama tidak diubah. Untuk kembali, isi HTML Directory
   dengan folder lama.

Catatan: login CHAP sudah ditangani di login.html (tidak butuh md5.js).
`;

export async function portalRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = makeAuth(ctx);
  const rid = (v: unknown) => {
    const id = idParam(v);
    ctx.routers.require(id);
    return id;
  };
  const listenPort = () => {
    const a = app.server.address();
    return a && typeof a === 'object' ? a.port : ctx.config.port;
  };
  const parseConfig = (raw: unknown) => {
    const r = portalConfigSchema.safeParse(raw ?? {});
    if (!r.success) {
      const i = r.error.issues[0];
      throw new HttpError(400, `${i.path.join('.') || 'config'}: ${i.message}`);
    }
    return r.data;
  };

  app.get('/api/routers/:id/portal', { preHandler: auth('hotspot.view') }, async (req) => {
    const id = rid((req.params as any).id);
    const [hotspot, baseUrl] = await Promise.all([
      ctx.portal.hotspotInfo(id).catch((err: Error) => ({ error: err.message })),
      ctx.portal.suggestBaseUrl(id, listenPort()),
    ]);
    return { config: ctx.portal.config(id), install: ctx.portal.installState(id), hotspot, baseUrl, prices: await ctx.portal.prices(id) };
  });

  app.put('/api/routers/:id/portal', { preHandler: auth('hotspot.write') }, async (req) => {
    const id = rid((req.params as any).id);
    const config = ctx.portal.save(id, parseConfig((req.body as any)?.config));
    auditFrom(ctx, req, 'portal.save', String(id));
    return { config };
  });

  app.post('/api/routers/:id/portal/preview', { preHandler: auth('hotspot.view') }, async (req) => {
    const id = rid((req.params as any).id);
    const b = z
      .object({ config: z.unknown(), page: z.enum(PORTAL_PAGES).default('login.html'), state: z.enum(['normal', 'error', 'trial']).default('normal'), baseUrl: z.string().max(200).default('') })
      .parse(req.body ?? {});
    const config = parseConfig(b.config);
    const html = renderPage(b.page, await ctx.portal.context(id, config, b.baseUrl || 'http://mikrotal.lan', true));
    const out = renderTemplate(html, previewVars(b.page, b.state)).replace('<head>', '<head><script>window.MIKROTAL_PREVIEW=1</script>');
    return { html: out, size: Buffer.byteLength(html) };
  });

  app.post('/api/routers/:id/portal/install', { preHandler: auth('hotspot.write') }, async (req, reply) => {
    const id = rid((req.params as any).id);
    const b = z
      .object({ config: z.unknown().optional(), profile: z.string().trim().min(1, 'Pilih profil hotspot'), baseUrl: z.string().trim().min(1, 'Isi alamat server MIKROTAL'), allowWhatsapp: z.boolean().default(false), method: z.enum(['auto', 'fetch', 'ftp']).default('auto') })
      .parse(req.body ?? {});
    if (b.config !== undefined) ctx.portal.save(id, parseConfig(b.config));
    try {
      const r = await ctx.portal.install(id, { profile: b.profile, baseUrl: b.baseUrl, allowWhatsapp: b.allowWhatsapp, method: b.method }, req.user.username);
      auditFrom(ctx, req, 'portal.install', String(id), { profile: b.profile, dir: r.dir, method: b.method });
      return r;
    } catch (err) {
      if (err instanceof HttpError && (err as any).steps) return reply.status(err.statusCode).send({ error: err.message, steps: (err as any).steps });
      throw err;
    }
  });

  app.post('/api/routers/:id/portal/rollback', { preHandler: auth('hotspot.write') }, async (req) => {
    const id = rid((req.params as any).id);
    const r = await ctx.portal.rollback(id);
    auditFrom(ctx, req, 'portal.rollback', String(id), r);
    return r;
  });

  app.get('/api/routers/:id/portal/download', { preHandler: auth('hotspot.view') }, async (req, reply) => {
    const id = rid((req.params as any).id);
    const q = req.query as Record<string, string>;
    const baseUrl = q.baseUrl || (await ctx.portal.suggestBaseUrl(id, listenPort()));
    const files = renderPortalFiles(await ctx.portal.context(id, ctx.portal.config(id), baseUrl));
    const data = zip([...files, { name: 'PETUNJUK.txt', data: Buffer.from(INSTRUCTIONS, 'utf8') }]);
    reply.header('content-type', 'application/zip').header('content-disposition', 'attachment; filename="mikrotal-portal.zip"');
    return reply.send(data);
  });

  /** Diunduh router dengan /tool/fetch saat pemasangan. Token acak, berlaku 10 menit. */
  app.get('/api/portal-files/:token/:file', async (req, reply) => {
    const { token, file } = req.params as { token: string; file: string };
    const f = /^[0-9a-f]{32}$/.test(token) ? ctx.portal.takeFile(token, file) : undefined;
    if (!f) return reply.status(404).send({ error: 'Berkas tidak ditemukan atau sudah kedaluwarsa' });
    reply.header('content-type', f.type).header('cache-control', 'no-store');
    return reply.send(f.data);
  });
}
