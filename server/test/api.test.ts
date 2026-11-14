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
