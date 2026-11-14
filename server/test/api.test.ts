import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { resetSimStores, SimulatedRouter } from '../src/lib/routeros/simulator.js';
import { generateCodes } from '../src/services/vouchers.js';

let app: FastifyInstance;
let ctx: AppContext;
let token = '';
const routerId = 1;

async function api(method: string, url: string, body?: unknown, t = token) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: t ? { authorization: `Bearer ${t}` } : {} });
  const json = res.headers['content-type']?.toString().includes('json') ? res.json() : res.body;
  return { status: res.statusCode, body: json as any };
}

before(async () => {
  resetSimStores();
  SimulatedRouter.autoActivity = false;
  ({ app, ctx } = await buildApp({
    logger: false,
    config: { dbFile: ':memory:', seedDemo: true, adminUsername: 'admin', adminPassword: 'admin123', appSecret: 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxx' },
  }));
  await app.ready();
});

after(async () => {
  await app.close();
});

test('kode voucher unik & sesuai charset', () => {
  const taken = new Set(['AAAAAA']);
  const codes = generateCodes({ qty: 500, length: 6, charset: 'alnum-upper', prefix: 'HS', taken });
  assert.equal(new Set(codes).size, 500);
  for (const c of codes) assert.match(c, /^HS[A-HJ-NP-Z2-9]{6}$/);
  assert.throws(() => generateCodes({ qty: 100, length: 1, charset: 'numeric' }));
});

test('login gagal & berhasil', async () => {
  const bad = await api('POST', '/api/auth/login', { username: 'admin', password: 'salah' }, '');
  assert.equal(bad.status, 401);
  const unauth = await api('GET', '/api/routers', undefined, '');
  assert.equal(unauth.status, 401);
  const ok = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' }, '');
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal(ok.body.user.role, 'superadmin');
  token = ok.body.token;
});

test('router demo terhubung & monitoring', async () => {
  const list = await api('GET', '/api/routers');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].has_password, true);
  assert.equal(list.body[0].password_enc, undefined);

  const snap = await ctx.monitor.pollRouter(ctx.routers.require(routerId));
  assert.equal(snap?.online, true);
  assert.ok((snap?.cpu ?? -1) >= 0);
  assert.equal(snap?.wan, 'ether1-WAN');

  const ov = await api('GET', `/api/routers/${routerId}/overview`);
  assert.equal(ov.status, 200);
  assert.ok(ov.body.interfaces.length >= 5);
  assert.equal(ov.body.resource['board-name'], 'RB4011iGS+');

  const tr = await api('GET', `/api/routers/${routerId}/traffic?interfaces=ether1-WAN,wlan1`);
  assert.equal(tr.status, 200);
  assert.equal(tr.body.length, 2);

  const test = await api('POST', '/api/routers/test', { name: 'X', host: 'sim2', username: 'admin', password: 'x', simulate: true });
  assert.equal(test.status, 200);
  assert.ok(test.body.interfaces.length > 0);
});

test('proxy menu RouterOS: tambah, ubah, nonaktifkan, hapus', async () => {
  const add = await api('POST', `/api/routers/${routerId}/res?path=/ip/address`, { address: '172.16.1.1/24', interface: 'ether3', comment: 'test' });
  assert.equal(add.status, 200);
  const id = add.body.id;
  assert.match(id, /^\*/);
  const set = await api('PATCH', `/api/routers/${routerId}/res/${encodeURIComponent(id)}?path=/ip/address`, { comment: 'diubah' });
  assert.equal(set.status, 200);
  const dis = await api('POST', `/api/routers/${routerId}/res/${encodeURIComponent(id)}/disable?path=/ip/address`);
  assert.equal(dis.status, 200);
  const list = await api('GET', `/api/routers/${routerId}/res?path=/ip/address`);
  const item = list.body.find((r: any) => r['.id'] === id);
  assert.equal(item.comment, 'diubah');
  assert.equal(item.disabled, 'true');
  const del = await api('DELETE', `/api/routers/${routerId}/res/${encodeURIComponent(id)}?path=/ip/address`);
  assert.equal(del.status, 200);
  const notAllowed = await api('GET', `/api/routers/${routerId}/res?path=/system/reset-configuration`);
  assert.equal(notAllowed.status, 400);
  const single = await api('PATCH', `/api/routers/${routerId}/single?path=/system/identity`, { name: 'Router-Baru' });
  assert.equal(single.status, 200);
  const id2 = await api('GET', `/api/routers/${routerId}/single?path=/system/identity`);
  assert.equal(id2.body.name, 'Router-Baru');
});

let firstCode = '';

test('profil hotspot dengan harga & generate voucher', async () => {
  const profiles = await api('GET', `/api/routers/${routerId}/hotspot/profiles`);
  assert.equal(profiles.status, 200);
  const p = profiles.body.find((x: any) => x.name === '1JAM');
  assert.equal(p.meta.price, 3000);

  const create = await api('POST', `/api/routers/${routerId}/hotspot/profiles`, { name: '3JAM', rate_limit: '3M/3M', shared_users: 1, price: 6000, validity: '1d', time_limit: '3h' });
  assert.equal(create.status, 200, JSON.stringify(create.body));
  const badDur = await api('POST', `/api/routers/${routerId}/hotspot/profiles`, { name: 'X', validity: 'sehari' });
  assert.equal(badDur.status, 400);

  const gen = await api('POST', '/api/vouchers/generate', { routerId, profile: '1JAM', qty: 10, length: 5, charset: 'numeric', prefix: 'V' });
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  assert.equal(gen.body.created, 10);
  assert.equal(gen.body.failed, 0);

  const list = await api('GET', `/api/vouchers?routerId=${routerId}`);
  assert.equal(list.body.total, 10);
  assert.equal(list.body.counts.unused, 10);
  firstCode = list.body.rows[0].code;
  assert.match(firstCode, /^V\d{5}$/);
  assert.equal(list.body.rows[0].time_limit, '1h');

  const users = await api('GET', `/api/routers/${routerId}/res?path=/ip/hotspot/user`);
  const u = users.body.find((x: any) => x.name === firstCode);
  assert.ok(u, 'voucher ada di router');
  assert.equal(u.profile, '1JAM');
  assert.equal(u['limit-uptime'], '1h');
  assert.match(u.comment, /^MIKROTAL\|B/);
});

test('sinkronisasi: aktivasi & kedaluwarsa voucher', async () => {
  const conn = (await ctx.routers.connection(routerId)) as SimulatedRouter;
  conn.simulateLogin(firstCode);
  const stats = await ctx.vouchers.sync(routerId);
  assert.ok((stats as any).activated >= 1);
  const v = ctx.db.get<any>('SELECT * FROM vouchers WHERE code = ?', [firstCode]);
  assert.equal(v.status, 'active');
  assert.ok(v.activated_at);
  assert.ok(Date.parse(v.expires_at) > Date.now() + 23 * 3600_000);

  const pub = await api('GET', `/api/public/voucher/${firstCode}`, undefined, '');
  assert.equal(pub.status, 200);
  assert.equal(pub.body.status, 'active');
  assert.equal(pub.body.password, undefined);

  ctx.db.run('UPDATE vouchers SET expires_at = ? WHERE code = ?', [new Date(Date.now() - 1000).toISOString(), firstCode]);
  await ctx.vouchers.sync(routerId);
  const v2 = ctx.db.get<any>('SELECT * FROM vouchers WHERE code = ?', [firstCode]);
  assert.equal(v2.status, 'expired');
  const users = await api('GET', `/api/routers/${routerId}/res?path=/ip/hotspot/user`);
  assert.equal(users.body.find((x: any) => x.name === firstCode), undefined, 'voucher kedaluwarsa dihapus dari router');
});

test('reseller: saldo terpotong, akun reseller hanya melihat miliknya, refund', async () => {
  const resellers = await api('GET', '/api/resellers');
  const r = resellers.body[0];
  assert.equal(r.balance, 250000);

  const topup = await api('POST', `/api/resellers/${r.id}/balance`, { type: 'topup', amount: 50000, note: 'transfer' });
  assert.equal(topup.body.balance, 300000);

  const user = await api('POST', '/api/users', { username: 'konter', name: 'Konter', role: 'reseller', reseller_id: r.id, password: 'konter123' });
  assert.equal(user.status, 200, JSON.stringify(user.body));
  const login = await api('POST', '/api/auth/login', { username: 'konter', password: 'konter123' }, '');
  const rt = login.body.token;

  const gen = await api('POST', '/api/vouchers/generate', { routerId, profile: '1JAM', qty: 4, length: 6, charset: 'alnum-upper', price: 1 }, rt);
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  assert.equal(gen.body.batch.cost, 4 * 2500, 'harga reseller dari profil');
  assert.equal(gen.body.batch.price, 3000, 'reseller tidak bisa mengubah harga');

  const after = await api('GET', '/api/resellers', undefined, rt);
  assert.equal(after.body.length, 1);
  assert.equal(after.body[0].balance, 300000 - 10000);

  const mine = await api('GET', '/api/vouchers', undefined, rt);
  assert.equal(mine.body.total, 4);
  const forbidden = await api('GET', `/api/routers/${routerId}/res?path=/ip/firewall/filter`, undefined, rt);
  assert.equal(forbidden.status, 403);

  const tooMuch = await api('POST', '/api/vouchers/generate', { routerId, profile: '1BULAN', qty: 1000, length: 8, charset: 'alnum-upper' }, rt);
  assert.equal(tooMuch.status, 400);
  assert.match(tooMuch.body.error, /Saldo/);

  const del = await api('DELETE', `/api/vouchers/batches/${gen.body.batch.id}?refund=1`);
  assert.equal(del.status, 200);
  const refunded = await api('GET', '/api/resellers');
  assert.equal(refunded.body[0].balance, 300000);
});

test('hak akses operator', async () => {
  await api('POST', '/api/users', { username: 'opr', name: 'Operator', role: 'operator', password: 'opr12345' });
  const login = await api('POST', '/api/auth/login', { username: 'opr', password: 'opr12345' }, '');
  const ot = login.body.token;
  const add = await api('POST', `/api/routers/${routerId}/res?path=/ip/firewall/filter`, { chain: 'input', action: 'drop' }, ot);
  assert.equal(add.status, 403);
  const hs = await api('POST', `/api/routers/${routerId}/res?path=/ip/hotspot/ip-binding`, { 'mac-address': '00:11:22:33:44:55', type: 'bypassed' }, ot);
  assert.equal(hs.status, 200);
  const reboot = await api('POST', `/api/routers/${routerId}/reboot`, undefined, ot);
  assert.equal(reboot.status, 403);
  const users = await api('GET', '/api/users', undefined, ot);
  assert.equal(users.status, 403);
});

test('laporan, dashboard, terminal, audit', async () => {
  const rep = await api('GET', '/api/reports/sales');
  assert.equal(rep.status, 200);
  assert.equal(rep.body.totals.direct, 3000);
  assert.equal(rep.body.daily.length, 30);

  const csv = await app.inject({ method: 'GET', url: '/api/reports/sales.csv', headers: { authorization: `Bearer ${token}` } });
  assert.equal(csv.statusCode, 200);
  assert.match(csv.body, /Tanggal/);

  const dash = await api('GET', '/api/dashboard');
  assert.equal(dash.status, 200);
  assert.equal(dash.body.totals.routers, 1);
  assert.equal(dash.body.revenue.daily.length, 7);

  const term = await api('POST', `/api/routers/${routerId}/terminal`, { command: '/ip/address/print', args: ['?interface=bridge-hotspot'] });
  assert.equal(term.status, 200);
  assert.equal(term.body.rows.length, 1);

  const audit = await api('GET', '/api/audit');
  assert.ok(audit.body.some((a: any) => a.action === 'voucher.generate'));

  const settings = await api('PUT', '/api/settings', { alerts: { cpu: 70, telegram: { botToken: '123456:ABCDEFGHIJKLMNOP' } } });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.alerts.cpu, 70);
  assert.match(settings.body.alerts.telegram.botToken, /••••/);
  // token tersamar tidak menimpa token asli
  await api('PUT', '/api/settings', { alerts: { telegram: { botToken: settings.body.alerts.telegram.botToken } } });
  assert.equal(ctx.settings.get().alerts.telegram.botToken, '123456:ABCDEFGHIJKLMNOP');
});

// ------------------------------------------------------------------ PPPoE

let pkgId = 0;
let custId = 0;
let odpId = 0;

test('PPPoE: paket, ODC/ODP, dan pelanggan baru membuat secret di router', async () => {
  const demo = await api('GET', `/api/customers?routerId=${routerId}`);
  assert.equal(demo.status, 200);
  assert.equal(demo.body.total, 3, 'pelanggan contoh');

  const badProfile = await api('POST', '/api/pppoe/packages', { routerId, name: 'X', profile: 'TIDAK-ADA', price: 1, validity: '30d' });
  assert.equal(badProfile.status, 400);
  const pkg = await api('POST', '/api/pppoe/packages', { routerId, name: 'Hemat 10M', profile: 'PPPoE-10M', price: 100000, resellerPrice: 90000, validity: '30d' });
  assert.equal(pkg.status, 200, JSON.stringify(pkg.body));
  pkgId = pkg.body.id;

  const odc = await api('POST', '/api/odcs', { routerId, name: 'ODC-T', ports: 4 });
  assert.equal(odc.status, 200, JSON.stringify(odc.body));
  const odp = await api('POST', '/api/odps', { routerId, name: 'ODP-T1', odcId: odc.body.id, odcPort: 1, ports: 2 });
  assert.equal(odp.status, 200, JSON.stringify(odp.body));
  odpId = odp.body.id;
  const dupPort = await api('POST', '/api/odps', { routerId, name: 'ODP-T2', odcId: odc.body.id, odcPort: 1, ports: 8 });
  assert.equal(dupPort.status, 400);
  assert.match(dupPort.body.error, /sudah dipakai/);
  const overPort = await api('POST', '/api/odps', { routerId, name: 'ODP-T2', odcId: odc.body.id, odcPort: 9, ports: 8 });
  assert.equal(overPort.status, 400);

  const c = await api('POST', '/api/customers', { routerId, name: 'Pak Budi', username: 'budi', password: 'budi123', packageId: pkgId, odpId, odpPort: 1, initialValidity: '30d' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  custId = c.body.id;
  assert.equal(c.body.status, 'active');
  assert.ok(Date.parse(c.body.expires_at) > Date.now() + 29 * 86400_000);

  const samePort = await api('POST', '/api/customers', { routerId, name: 'Lain', username: 'lain', password: 'lain123', packageId: pkgId, odpId, odpPort: 1, initialValidity: '30d' });
  assert.equal(samePort.status, 400);
  const badPort = await api('POST', '/api/customers', { routerId, name: 'Lain', username: 'lain', password: 'lain123', packageId: pkgId, odpId, odpPort: 3, initialValidity: '30d' });
  assert.equal(badPort.status, 400);
  const dupUser = await api('POST', '/api/customers', { routerId, name: 'Budi 2', username: 'budi', password: 'budi123' });
  assert.equal(dupUser.status, 400);

  const secrets = await api('GET', `/api/routers/${routerId}/res?path=/ppp/secret`);
  const s = secrets.body.find((x: any) => x.name === 'budi');
  assert.ok(s, 'secret dibuat di router');
  assert.equal(s.profile, 'PPPoE-10M');
  assert.equal(s.service, 'pppoe');
  assert.match(s.comment, /^MIKROTAL\|Pak Budi/);

  const topo = await api('GET', `/api/topology?routerId=${routerId}`);
  const t = topo.body.odcs.find((d: any) => d.name === 'ODC-T');
  assert.equal(t.odps[0].customers[0].username, 'budi');
  assert.equal(t.odps[0].used, 1);
});

test('PPPoE: masa aktif habis → diisolir, voucher → aktif kembali dan masa aktif bertambah', async () => {
  const conn = (await ctx.routers.connection(routerId)) as SimulatedRouter;
  conn.pppConnect('budi');
  let stats: any = await ctx.pppoe.sync(routerId);
  assert.equal(ctx.pppoe.requireCustomer(custId).online, 1);
  assert.equal(stats.isolated, 0);

  ctx.db.run('UPDATE customers SET expires_at = ? WHERE id = ?', [new Date(Date.now() - 60_000).toISOString(), custId]);
  stats = await ctx.pppoe.sync(routerId);
  assert.equal(stats.isolated, 1);
  let c = ctx.pppoe.requireCustomer(custId);
  assert.equal(c.status, 'isolated');
  assert.equal(c.online, 0, 'sesi diputus agar menyambung ulang dengan profil isolir');

  const profiles = await api('GET', `/api/routers/${routerId}/res?path=/ppp/profile`);
  const iso = profiles.body.find((p: any) => p.name === 'ISOLIR');
  assert.ok(iso, 'profil isolir dibuat otomatis');
  assert.equal(iso['address-list'], 'isolir');
  let secrets = await api('GET', `/api/routers/${routerId}/res?path=/ppp/secret`);
  assert.equal(secrets.body.find((x: any) => x.name === 'budi').profile, 'ISOLIR');
  assert.equal(secrets.body.find((x: any) => x.name === 'budi').disabled, 'false', 'diisolir, bukan dinonaktifkan');

  const reopen = await api('POST', `/api/customers/${custId}/status`, { status: 'active' });
  assert.equal(reopen.status, 400, 'tidak bisa dibuka tanpa perpanjangan');

  const gen = await api('POST', '/api/pppoe/vouchers/generate', { packageId: pkgId, qty: 5 });
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  assert.equal(gen.body.created, 5);
  const list = await api('GET', `/api/pppoe/vouchers?batchId=${gen.body.batch.id}`);
  assert.equal(list.body.counts.unused, 5);
  const [v1, v2] = list.body.rows.map((r: any) => r.code);
  assert.match(v1, /^\d{10}$/);

  // pelanggan mengisi sendiri dari halaman isolir (tanpa login)
  const pubBad = await api('POST', '/api/public/pppoe/redeem', { username: 'budi', code: '0000000000' }, '');
  assert.equal(pubBad.status, 404);
  const pubNoUser = await api('POST', '/api/public/pppoe/redeem', { username: 'tidakada', code: v1 }, '');
  assert.equal(pubNoUser.status, 404);
  const before = Date.now();
  const pub = await api('POST', '/api/public/pppoe/redeem', { username: 'budi', code: `${v1.slice(0, 5)} ${v1.slice(5)}` }, '');
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.customer.status, 'active');
  assert.notEqual(pub.body.customer.name, 'Pak Budi', 'nama disamarkan');
  assert.equal(pub.body.customer.password, undefined);
  c = ctx.pppoe.requireCustomer(custId);
  assert.equal(c.status, 'active');
  const exp1 = Date.parse(c.expires_at!);
  assert.ok(exp1 >= before + 30 * 86400_000 && exp1 < before + 30 * 86400_000 + 60_000, 'dihitung dari sekarang karena sudah habis');
  secrets = await api('GET', `/api/routers/${routerId}/res?path=/ppp/secret`);
  assert.equal(secrets.body.find((x: any) => x.name === 'budi').profile, 'PPPoE-10M');

  const twice = await api('POST', '/api/public/pppoe/redeem', { username: 'budi', code: v1 }, '');
  assert.equal(twice.status, 400);
  assert.match(twice.body.error, /sudah pernah dipakai/);

  // voucher kedua oleh operator: sisa masa aktif tidak hangus
  const r2 = await api('POST', `/api/customers/${custId}/redeem`, { code: v2 });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(Date.parse(r2.body.expires_at), exp1 + 30 * 86400_000);

  const status = await api('GET', '/api/public/pppoe/budi', undefined, '');
  assert.equal(status.status, 200);
  assert.equal(status.body.package, 'Hemat 10M');

  const detail = await api('GET', `/api/customers/${custId}`);
  const types = detail.body.history.map((h: any) => h.type);
  assert.deepEqual(types, ['voucher', 'voucher', 'isolate', 'manual']);

  const rep = await api('GET', '/api/reports/sales');
  assert.equal(rep.body.totals.pppoe, 200000);
  assert.equal(rep.body.totals.direct, 3000, 'penjualan hotspot tidak berubah');
});

test('PPPoE: perpanjang manual, isolir manual, nonaktif, ubah & hapus', async () => {
  const ext = await api('POST', `/api/customers/${custId}/extend`, { validity: '7d', amount: 40000, note: 'tunai' });
  assert.equal(ext.status, 200, JSON.stringify(ext.body));

  const iso = await api('POST', `/api/customers/${custId}/status`, { status: 'isolated' });
  assert.equal(iso.body.customer.status, 'isolated');
  let secrets = await api('GET', `/api/routers/${routerId}/res?path=/ppp/secret`);
  assert.equal(secrets.body.find((x: any) => x.name === 'budi').profile, 'ISOLIR');
  const open = await api('POST', `/api/customers/${custId}/status`, { status: 'active' });
  assert.equal(open.status, 200, JSON.stringify(open.body));

  const off = await api('POST', `/api/customers/${custId}/status`, { status: 'disabled' });
  assert.equal(off.status, 200);
  secrets = await api('GET', `/api/routers/${routerId}/res?path=/ppp/secret`);
  assert.equal(secrets.body.find((x: any) => x.name === 'budi').disabled, 'true');
  await api('POST', `/api/customers/${custId}/status`, { status: 'active' });

  const upd = await api('PATCH', `/api/customers/${custId}`, { name: 'Pak Budi Santoso', password: 'baru12345', odpPort: 2 });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  assert.equal(upd.body.customer.odp_port, 2);
  secrets = await api('GET', `/api/routers/${routerId}/res?path=/ppp/secret`);
  const s = secrets.body.find((x: any) => x.name === 'budi');
  assert.equal(s.password, 'baru12345');
  assert.equal(s.disabled, 'false');

  // admin mengubah profil langsung di Winbox → sinkronisasi mengembalikannya
  await api('PATCH', `/api/routers/${routerId}/res/${encodeURIComponent(s['.id'])}?path=/ppp/secret`, { profile: 'PPPoE-20M' });
  const stats: any = await ctx.pppoe.sync(routerId);
  assert.equal(stats.fixed, 1);

  const setup = await api('POST', '/api/pppoe/isolir/setup', { routerId });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  assert.ok(setup.body.done.some((d: string) => /blokir internet/.test(d)));
  const again = await api('POST', '/api/pppoe/isolir/setup', { routerId });
  assert.equal(again.body.done.length, 0, 'tidak menggandakan aturan');

  const sum = await api('GET', `/api/pppoe/summary?routerId=${routerId}`);
  assert.equal(sum.body.customers.total, 4);
  assert.equal(sum.body.vouchers.unused, 3);

  const imp = await api('POST', '/api/customers/import', { routerId });
  assert.equal(imp.body.imported, 0, 'semua akun sudah terdaftar');

  const del = await api('DELETE', `/api/customers/${custId}`);
  assert.equal(del.status, 200);
  secrets = await api('GET', `/api/routers/${routerId}/res?path=/ppp/secret`);
  assert.equal(secrets.body.find((x: any) => x.name === 'budi'), undefined);
});

test('PPPoE: reseller membeli voucher dengan harga reseller, operator tidak bisa pasang firewall isolir', async () => {
  const login = await api('POST', '/api/auth/login', { username: 'konter', password: 'konter123' }, '');
  const rt = login.body.token;
  const before = (await api('GET', '/api/resellers', undefined, rt)).body[0].balance;
  const gen = await api('POST', '/api/pppoe/vouchers/generate', { packageId: pkgId, qty: 2 }, rt);
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  assert.equal(gen.body.batch.cost, 180000);
  assert.equal((await api('GET', '/api/resellers', undefined, rt)).body[0].balance, before - 180000);
  const mine = await api('GET', '/api/pppoe/vouchers', undefined, rt);
  assert.equal(mine.body.total, 2);
  const cust = await api('GET', '/api/customers', undefined, rt);
  assert.equal(cust.status, 403);

  const del = await api('DELETE', `/api/pppoe/vouchers/batches/${gen.body.batch.id}?refund=1`);
  assert.equal(del.body.removed, 2);
  assert.equal((await api('GET', '/api/resellers', undefined, rt)).body[0].balance, before);

  const ot = (await api('POST', '/api/auth/login', { username: 'opr', password: 'opr12345' }, '')).body.token;
  const setup = await api('POST', '/api/pppoe/isolir/setup', { routerId }, ot);
  assert.equal(setup.status, 403);
  const list = await api('GET', '/api/customers', undefined, ot);
  assert.equal(list.status, 200);
});

test('pelanggan terisolir dialihkan ke halaman isi voucher', async () => {
  ctx.settings.update({ pppoe: { portalAddress: '192.168.88.10', portalPort: 8080 } });
  const hit = (url: string, remoteAddress: string, host = 'example.com') => app.inject({ method: 'GET', url, remoteAddress, headers: { host } });
  const r = await hit('/berita/hari-ini', '10.99.0.25');
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, 'http://192.168.88.10:8080/isolir');
  assert.equal((await hit('/', '10.99.0.25', '192.168.88.10:8080')).statusCode, 302, 'halaman admin tidak ditampilkan ke pelanggan terisolir');
  assert.notEqual((await hit('/api/public/brand', '10.99.0.25', '192.168.88.10:8080')).statusCode, 302, 'API halaman isolir tetap bisa diakses');
  assert.notEqual((await hit('/isolir', '10.99.0.25', '192.168.88.10:8080')).statusCode, 302);
  assert.notEqual((await hit('/api/health', '192.168.88.50')).statusCode, 302, 'pengguna biasa tidak dialihkan');
  assert.notEqual((await hit('/api/health', '10.99.4.1')).statusCode, 302, 'di luar rentang pool isolir');
});
