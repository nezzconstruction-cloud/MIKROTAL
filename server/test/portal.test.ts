import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { resetSimStores, SimulatedRouter } from '../src/lib/routeros/simulator.js';
import { defaultPortalConfig, portalConfigSchema } from '../src/lib/portal/config.js';
import { PORTAL_PAGES, previewVars, renderPage, renderPortalFiles, speedText, type RenderContext } from '../src/lib/portal/render.js';
import { checkTemplate, renderTemplate } from '../src/lib/portal/template.js';
import { portalDirFor } from '../src/services/portal.js';

const KNOWN_VARS = new Set([
  'identity', 'link-login-only', 'link-login', 'link-logout', 'link-status', 'link-orig', 'link-orig-esc', 'link-redirect', 'mac-esc', 'mac', 'ip',
  'username', 'error', 'chap-id', 'chap-challenge', 'trial', 'login-by', 'uptime', 'uptime-secs', 'session-time-left', 'session-time-left-secs',
  'bytes-in-nice', 'bytes-out-nice', 'remain-bytes-total', 'remain-bytes-total-nice', 'refresh-timeout', 'refresh-timeout-secs', 'else', 'endif',
]);

const ctxFor = (over: Partial<ReturnType<typeof defaultPortalConfig>> = {}): RenderContext => ({
  config: portalConfigSchema.parse({ ...defaultPortalConfig(), ...over }),
  brandName: 'NEZZ NET',
  brandPhone: '081234567890',
  currency: 'IDR',
  baseUrl: 'http://192.168.88.10:8080',
  prices: [{ profile: '1HARI', price: 5000, validity: '1d', timeLimit: '', dataLimit: 0, speed: '5 Mbps', color: '#22c55e' }],
});

test('template RouterOS: variabel, if/elif/else bersarang', () => {
  const t = "a$(x)b$(if y)Y$(if z == 'q')Q$(else)N$(endif)$(elif w)W$(else)E$(endif)c";
  assert.equal(renderTemplate(t, { x: '1', y: 'ya', z: 'q' }), 'a1bYQc');
  assert.equal(renderTemplate(t, { x: '1', y: 'ya', z: 'r' }), 'a1bYNc');
  assert.equal(renderTemplate(t, { w: '1' }), 'abWc');
  assert.equal(renderTemplate(t, {}), 'abEc');
  assert.deepEqual(checkTemplate(t), []);
  assert.equal(checkTemplate('$(if a)x').length, 1);
  assert.equal(speedText('2M/10M'), '10 Mbps');
  assert.equal(speedText('512k/1M 2M/4M'), '1 Mbps');
  assert.equal(portalDirFor('flash/hotspot'), 'flash/mikrotal-portal');
  assert.equal(portalDirFor('hotspot'), 'mikrotal-portal');
  assert.equal(portalDirFor('flash/mikrotal-portal'), 'flash/mikrotal-portal');
});

test('halaman portal: template valid, hanya variabel RouterOS yang dikenal, teks pengguna aman', () => {
  const evil = '$(chap-id)<script>alert(1)</script>"';
  for (const preset of ['aurora', 'glass', 'minimal', 'neon', 'sunset'] as const) {
    for (const loginMode of ['voucher', 'member', 'both'] as const) {
      const ctx = ctxFor({
        preset,
        loginMode,
        trial: true,
        name: evil,
        tagline: evil,
        footer: evil,
        announcement: { enabled: true, text: evil, style: 'marquee' },
        promos: [{ badge: '$(x)', title: evil, text: evil }],
        faq: [{ q: evil, a: evil }],
        rules: evil,
        waMessage: 'Beli {paket} $(ip)',
        instagram: '@nezz',
      });
      for (const page of PORTAL_PAGES) {
        const html = renderPage(page, ctx);
        assert.deepEqual(checkTemplate(html), [], `${preset}/${loginMode}/${page}`);
        for (const m of html.matchAll(/\$\((?:if |elif )?([a-z0-9-]+)/g)) assert.ok(KNOWN_VARS.has(m[1]), `variabel tidak dikenal $(${m[1]}) di ${page}`);
        assert.ok(!html.includes('<script>alert'), 'HTML pengguna di-escape');
        assert.ok(!/\$\(x\)/.test(html));
        const out = renderTemplate(html, previewVars(page, 'error'));
        assert.ok(!out.includes('$('), `sisa template di ${page}`);
      }
    }
  }
  const login = renderPage('login.html', ctxFor({ trial: true }));
  assert.match(login, /\$\(if chap-id\)<script>CHAP_ID='\$\(chap-id\)';CHAP_CH='\$\(chap-challenge\)';<\/script>\$\(endif\)/);
  assert.match(login, /\$\(if trial == 'yes'\)/);
  assert.match(login, /action="\$\(link-login-only\)"/);
  assert.match(login, /https:\/\/wa\.me\/6281234567890\?text=Halo%2C%20saya%20mau%20beli%20voucher%201HARI/);
  assert.match(login, /http:\/\/192\.168\.88\.10:8080\/cek/);
  assert.ok(!renderPage('login.html', ctxFor({ cekVoucher: false })).includes('/cek'));
  assert.ok(!renderPage('login.html', ctxFor({ showPrices: false })).includes('id="harga"'));
});

test('gambar latar dipasang sebagai berkas terpisah, logo disisipkan', () => {
  const png = 'data:image/png;base64,' + Buffer.from('fake-image').toString('base64');
  const ctx = ctxFor({ background: png, logo: png });
  const files = renderPortalFiles(ctx);
  assert.deepEqual(files.map((f) => f.name), [...PORTAL_PAGES, 'mt-bg.jpg']);
  assert.equal(files.at(-1)!.data.toString(), 'fake-image');
  const login = files[0].data.toString();
  assert.match(login, /url\("mt-bg\.jpg"\)/);
  assert.ok(login.includes(png), 'logo inline');
  assert.match(renderPage('login.html', { ...ctx, inlineAssets: true }), /url\("data:image\/png/);
  assert.equal(portalConfigSchema.safeParse({ logo: 'data:text/html;base64,AAAA' }).success, false);
  assert.equal(portalConfigSchema.safeParse({ redirectUrl: 'javascript:alert(1)' }).success, false);
});

// ------------------------------------------------------------- pemasangan

let app: FastifyInstance;
let ctx: AppContext;
let token = '';
let base = '';
const routerId = 1;

async function api(method: string, url: string, body?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: { authorization: `Bearer ${token}` } });
  const ct = res.headers['content-type']?.toString() ?? '';
  return { status: res.statusCode, body: (ct.includes('json') ? res.json() : res.rawPayload) as any, headers: res.headers };
}

before(async () => {
  resetSimStores();
  SimulatedRouter.autoActivity = false;
  ({ app, ctx } = await buildApp({ logger: false, config: { dbFile: ':memory:', seedDemo: true, adminUsername: 'admin', adminPassword: 'admin123', appSecret: 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxx' } }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin123' } })).json().token;
});

after(async () => {
  await app.close();
});

test('portal: ambil, simpan, pratinjau', async () => {
  const r = await api('GET', `/api/routers/${routerId}/portal`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.install, null);
  assert.equal(r.body.config.preset, 'aurora');
  assert.equal(r.body.baseUrl, `http://127.0.0.1:${(app.server.address() as any).port}`);
  assert.deepEqual(r.body.hotspot.profiles.map((p: any) => p.name), ['default', 'hsprof1']);
  assert.equal(r.body.hotspot.servers[0].profile, 'hsprof1');
  assert.ok(r.body.prices.some((p: any) => p.profile === '1HARI' && p.speed === '5 Mbps'));

  const bad = await api('PUT', `/api/routers/${routerId}/portal`, { config: { color1: 'merah' } });
  assert.equal(bad.status, 400);
  const save = await api('PUT', `/api/routers/${routerId}/portal`, { config: { ...r.body.config, name: 'NEZZ Hotspot', preset: 'neon', whatsapp: '0812 3456 7890' } });
  assert.equal(save.status, 200);
  assert.equal((await api('GET', `/api/routers/${routerId}/portal`)).body.config.preset, 'neon');

  const prev = await api('POST', `/api/routers/${routerId}/portal/preview`, { config: save.body.config, page: 'login.html', state: 'error' });
  assert.equal(prev.status, 200);
  assert.ok(!prev.body.html.includes('$('));
  assert.match(prev.body.html, /MIKROTAL_PREVIEW/);
  assert.match(prev.body.html, /invalid username or password/);
  assert.match(prev.body.html, /NEZZ Hotspot/);
  const st = await api('POST', `/api/routers/${routerId}/portal/preview`, { config: save.body.config, page: 'status.html' });
  assert.match(st.body.html, /22h47m20s/);
});

test('portal: pasang ke router, pasang ulang, gagal aman, kembalikan', async () => {
  const conn = (await ctx.routers.connection(routerId)) as SimulatedRouter;
  const profile = async () => (await api('GET', `/api/routers/${routerId}/res?path=/ip/hotspot/profile`)).body.find((p: any) => p.name === 'hsprof1');
  assert.equal((await profile())['html-directory'], 'flash/hotspot');

  // router tidak bisa menjangkau alamat → dibatalkan, folder lama dipakai lagi
  const fail = await api('POST', `/api/routers/${routerId}/portal/install`, { profile: 'hsprof1', baseUrl: 'http://127.0.0.1:1', method: 'fetch' });
  assert.equal(fail.status, 502, JSON.stringify(fail.body));
  assert.match(fail.body.error, /gagal mengunduh login\.html/);
  assert.ok(fail.body.steps.some((s: string) => /dikembalikan ke flash\/hotspot/.test(s)));
  assert.equal((await profile())['html-directory'], 'flash/hotspot');

  // komputer MIKROTAL di belakang NAT: fetch gagal, diagnosis dijalankan, FTP masih mati → batal dengan petunjuk
  const nat = await api('POST', `/api/routers/${routerId}/portal/install`, { profile: 'hsprof1', baseUrl: 'http://192.0.2.20:8080' });
  assert.equal(nat.status, 502, JSON.stringify(nat.body));
  assert.match(nat.body.error, /layanan FTP .* nonaktif/);
  assert.ok(nat.body.steps.some((s: string) => /Host is unreachable/.test(s)));
  assert.ok(nat.body.steps.some((s: string) => /tidak bisa ping 192\.0\.2\.20/.test(s)));
  assert.ok(nat.body.steps.some((s: string) => /Alamat IP di router: .*ether/.test(s)));
  assert.ok(nat.body.steps.some((s: string) => /tersambung ke router dari IP 127\.0\.0\.1/.test(s)));
  assert.equal((await profile())['html-directory'], 'flash/hotspot');

  // setelah FTP diaktifkan, cara otomatis beralih ke unggah FTP
  const ftp = (await api('GET', `/api/routers/${routerId}/res?path=/ip/service`)).body.find((r: any) => r.name === 'ftp');
  await api('POST', `/api/routers/${routerId}/ros/action`, { path: '/ip/service', ids: [ftp['.id']], action: 'enable' });
  const viaFtp = await api('POST', `/api/routers/${routerId}/portal/install`, { profile: 'hsprof1', baseUrl: 'http://192.0.2.20:8080' });
  assert.equal(viaFtp.status, 200, JSON.stringify(viaFtp.body));
  assert.ok(viaFtp.body.steps.some((s: string) => /lewat FTP \(port 21\)/.test(s)));
  assert.match(conn.readFile('flash/mikrotal-portal/login.html')!, /<!DOCTYPE html>/);
  assert.equal((await profile())['html-directory'], 'flash/mikrotal-portal');
  await api('POST', `/api/routers/${routerId}/portal/rollback`);
  await api('POST', `/api/routers/${routerId}/ros/action`, { path: '/ip/service', ids: [ftp['.id']], action: 'disable' });

  const ok = await api('POST', `/api/routers/${routerId}/portal/install`, { profile: 'hsprof1', baseUrl: base, allowWhatsapp: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.dir, 'flash/mikrotal-portal');
  assert.equal(ok.body.previousDir, 'flash/hotspot');
  assert.equal((await profile())['html-directory'], 'flash/mikrotal-portal');
  const expected = renderPortalFiles(await ctx.portal.context(routerId, ctx.portal.config(routerId), base));
  for (const f of expected) assert.equal(conn.readFile(`flash/mikrotal-portal/${f.name}`), f.data.toString(), f.name);
  assert.match(conn.readFile('flash/mikrotal-portal/redirect.html')!, /default/, 'halaman bawaan lain tetap ada');
  assert.match(conn.readFile('flash/hotspot/login.html') ?? '<lama>', /lama|<!DOCTYPE/i, 'folder lama tidak disentuh');

  const wgIp = (await api('GET', `/api/routers/${routerId}/res?path=/ip/hotspot/walled-garden/ip`)).body;
  assert.ok(wgIp.some((r: any) => r['dst-address'] === '127.0.0.1' && r.comment === 'MIKROTAL-PORTAL'));
  const wg = (await api('GET', `/api/routers/${routerId}/res?path=/ip/hotspot/walled-garden`)).body;
  assert.ok(wg.some((r: any) => r['dst-host'] === '*.whatsapp.net'));

  // token sekali pakai: setelah selesai tidak bisa diunduh lagi
  const leaked = await app.inject({ method: 'GET', url: `/api/portal-files/${'0'.repeat(32)}/login.html` });
  assert.equal(leaked.statusCode, 404);

  // pasang ulang dengan desain baru: folder asal tetap tercatat, aturan tidak digandakan
  await api('PUT', `/api/routers/${routerId}/portal`, { config: { ...ctx.portal.config(routerId), tagline: 'Desain kedua' } });
  const again = await api('POST', `/api/routers/${routerId}/portal/install`, { profile: 'hsprof1', baseUrl: base, allowWhatsapp: true });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.previousDir, 'flash/hotspot');
  assert.match(conn.readFile('flash/mikrotal-portal/login.html')!, /Desain kedua/);
  assert.equal((await api('GET', `/api/routers/${routerId}/res?path=/ip/hotspot/walled-garden/ip`)).body.filter((r: any) => r.comment === 'MIKROTAL-PORTAL' && r['dst-address'] === '127.0.0.1').length, 1);

  const state = (await api('GET', `/api/routers/${routerId}/portal`)).body.install;
  assert.equal(state.dir, 'flash/mikrotal-portal');
  assert.equal(state.by, 'admin');
  assert.equal(state.pricesStale, false);

  // harga diubah: pratinjau langsung memakai harga baru, portal di router ditandai lama lalu diperbarui
  const hs = (await api('GET', `/api/routers/${routerId}/hotspot/profiles`)).body.find((p: any) => p.name === '1HARI');
  const edit = await api('PUT', `/api/routers/${routerId}/hotspot/profiles/1HARI`, { name: '1HARI', rate_limit: hs['rate-limit'] ?? '', price: 6500, validity: hs.meta.validity });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const fresh = await api('GET', `/api/routers/${routerId}/portal`);
  assert.equal(fresh.body.prices.find((p: any) => p.profile === '1HARI').price, 6500);
  assert.equal(fresh.body.install.pricesStale, true);
  assert.doesNotMatch(conn.readFile('flash/mikrotal-portal/login.html')!, /Rp\s6\.500/);
  assert.equal(await ctx.portal.refreshPrices(routerId, 'admin'), true);
  assert.match(conn.readFile('flash/mikrotal-portal/login.html')!, /Rp\s6\.500/);
  assert.equal((await api('GET', `/api/routers/${routerId}/portal`)).body.install.pricesStale, false);
  assert.equal(await ctx.portal.refreshPrices(routerId, 'admin'), null, 'tidak dipasang ulang bila harga tidak berubah');

  const back = await api('POST', `/api/routers/${routerId}/portal/rollback`);
  assert.equal(back.status, 200);
  assert.equal((await profile())['html-directory'], 'flash/hotspot');
  assert.equal((await api('GET', `/api/routers/${routerId}/portal`)).body.install, null);
  assert.equal((await api('POST', `/api/routers/${routerId}/portal/rollback`)).status, 400);
});

test('portal: unduh ZIP untuk pemasangan manual', async () => {
  const r = await api('GET', `/api/routers/${routerId}/portal/download?baseUrl=${encodeURIComponent(base)}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/zip');
  const buf: Buffer = r.body;
  const names: string[] = [];
  let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const csize = buf.readUInt32LE(off + 18);
    const nlen = buf.readUInt16LE(off + 26);
    const name = buf.subarray(off + 30, off + 30 + nlen).toString();
    const data = zlib.inflateRawSync(buf.subarray(off + 30 + nlen, off + 30 + nlen + csize));
    assert.equal(zlib.crc32(data) >>> 0, buf.readUInt32LE(off + 14) >>> 0, name);
    names.push(name);
    off += 30 + nlen + csize;
  }
  assert.deepEqual(names, [...PORTAL_PAGES, 'PETUNJUK.txt']);
});

test('portal: hak akses', async () => {
  await api('POST', '/api/users', { username: 'opr2', name: 'Operator', role: 'operator', password: 'opr12345' });
  const ot = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'opr2', password: 'opr12345' } })).json().token;
  const view = await app.inject({ method: 'GET', url: `/api/routers/${routerId}/portal`, headers: { authorization: `Bearer ${ot}` } });
  assert.equal(view.statusCode, 200);
  const anon = await app.inject({ method: 'GET', url: `/api/routers/${routerId}/portal` });
  assert.equal(anon.statusCode, 401);
});
