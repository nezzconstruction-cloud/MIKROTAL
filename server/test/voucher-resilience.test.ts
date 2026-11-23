import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { resetSimStores, SimulatedRouter } from '../src/lib/routeros/simulator.js';

let app: FastifyInstance;
let ctx: AppContext;
let token = '';
const routerId = 1;

async function api(method: string, url: string, body?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: { authorization: `Bearer ${token}` } });
  return { status: res.statusCode, body: res.json() as any };
}
const user = async (code: string) => (await ctx.routers.exec(routerId, '/ip/hotspot/user/print')).find((u) => u.name === code);
const row = (code: string) => ctx.db.get<any>('SELECT * FROM vouchers WHERE code = ?', [code]);
/** Simulator mengizinkan menulis counter langsung, untuk meniru pemakaian. */
const setUsage = async (code: string, uptime: string, bytesIn = '0', bytesOut = '0') =>
  ctx.routers.exec(routerId, '/ip/hotspot/user/set', { '.id': (await user(code))!['.id'], uptime, 'bytes-in': bytesIn, 'bytes-out': bytesOut });

before(async () => {
  resetSimStores();
  SimulatedRouter.autoActivity = false;
  ({ app, ctx } = await buildApp({ logger: false, config: { dbFile: ':memory:', seedDemo: true, adminUsername: 'admin', adminPassword: 'admin123', appSecret: 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxx' } }));
  token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin123' } })).json().token;
});

after(async () => {
  await app.close();
});

test('counter tereset (reboot/update/reset-counters): voucher tetap terpakai, sisa waktu tidak bertambah', async () => {
  const gen = await api('POST', '/api/vouchers/generate', { routerId, profile: '1JAM', qty: 2, length: 6, charset: 'numeric', prefix: 'R' });
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  const [a, b] = (await api('GET', `/api/vouchers?batchId=${gen.body.batch.id}`)).body.rows.map((r: any) => r.code);

  await setUsage(a, '40m', '1000', '9000');
  await ctx.vouchers.sync(routerId);
  assert.equal(row(a).status, 'used');
  assert.equal(row(a).uptime_seconds, 2400);

  // router reboot: counter kembali ke nol
  await ctx.routers.exec(routerId, '/ip/hotspot/user/reset-counters', { '.id': (await user(a))!['.id'] });
  const s1: any = await ctx.vouchers.sync(routerId);
  assert.equal(s1.resets, 1);
  let r = row(a);
  assert.equal(r.status, 'used', 'tidak kembali menjadi "belum dipakai"');
  assert.equal(r.uptime_seconds, 2400, 'pemakaian sebelum reset tetap terhitung');
  assert.equal(r.bytes_in + r.bytes_out, 10000);
  assert.equal(r.counter_resets, 1);
  assert.equal((await user(a))!['limit-uptime'], '20m', 'batas di router disesuaikan ke sisa 20 menit');

  // pemakaian berlanjut 25 menit setelah reset → total 65 menit > 1 jam → kedaluwarsa
  await setUsage(a, '25m');
  await ctx.vouchers.sync(routerId);
  r = row(a);
  assert.equal(r.uptime_seconds, 65 * 60);
  assert.equal(r.status, 'expired');
  assert.equal(await user(a), undefined, 'voucher habis dihapus dari router');

  // stok & refund reseller tidak menghitung voucher yang sudah terpakai
  const list = await api('GET', `/api/vouchers?batchId=${gen.body.batch.id}`);
  assert.equal(list.body.counts.unused, 1);
  assert.equal(row(b).status, 'unused');
});

test('daftar user di router mendadak kosong: voucher tidak ditandai dihapus, peringatan dikirim, pulih sendiri', async () => {
  const gen = await api('POST', '/api/vouchers/generate', { routerId, profile: '1HARI', qty: 6, length: 6, charset: 'numeric', prefix: 'M' });
  const codes: string[] = (await api('GET', `/api/vouchers?batchId=${gen.body.batch.id}`)).body.rows.map((r: any) => r.code);
  await setUsage(codes[0], '5m', '10', '20');
  await ctx.vouchers.sync(routerId);

  // simpan lalu hapus semua user (meniru router baru selesai update dan belum memuat user)
  const saved = (await ctx.routers.exec(routerId, '/ip/hotspot/user/print')).filter((u) => codes.includes(u.name));
  await ctx.routers.exec(routerId, '/ip/hotspot/user/remove', { '.id': saved.map((u) => u['.id']).join(',') });
  const s: any = await ctx.vouchers.sync(routerId);
  assert.equal(s.deferred, true);
  assert.equal(s.missing, 0);
  for (const c of codes) assert.notEqual(row(c).status, 'removed', c);
  const alerts = await api('GET', '/api/alerts');
  assert.ok(alerts.body.rows.some((x: any) => x.type === 'voucher.sync.deferred'));

  // user kembali muncul → sinkron normal lagi
  for (const u of saved) await ctx.routers.exec(routerId, '/ip/hotspot/user/add', { name: u.name, password: u.password, profile: u.profile, comment: u.comment });
  await ctx.vouchers.sync(routerId);
  assert.equal(row(codes[0]).status, 'used', 'riwayat pemakaian tidak hilang');
  assert.equal(row(codes[1]).status, 'unused');

  // satu voucher dihapus lewat Winbox tetap terdeteksi seperti biasa, dan bisa pulih bila dibuat lagi
  const one = (await user(codes[5]))!;
  await ctx.routers.exec(routerId, '/ip/hotspot/user/remove', { '.id': one['.id'] });
  const s2: any = await ctx.vouchers.sync(routerId);
  assert.equal(s2.missing, 1);
  assert.equal(row(codes[5]).status, 'removed');
  await ctx.routers.exec(routerId, '/ip/hotspot/user/add', { name: codes[5], password: codes[5], profile: '1HARI' });
  const s3: any = await ctx.vouchers.sync(routerId);
  assert.equal(s3.restored, 1);
  assert.equal(row(codes[5]).status, 'unused');
});

test('voucher dihapus massal lewat Winbox: penundaan dibatasi waktu, lalu ditandai dihapus', async () => {
  const gen = await api('POST', '/api/vouchers/generate', { routerId, profile: '1HARI', qty: 6, length: 6, charset: 'numeric', prefix: 'W' });
  const codes: string[] = (await api('GET', `/api/vouchers?batchId=${gen.body.batch.id}`)).body.rows.map((r: any) => r.code);
  await ctx.vouchers.sync(routerId);
  // hapus semua voucher yang dipantau di router, bukan hanya batch ini, agar melewati ambang 50%
  const tracked = new Set(ctx.db.all<{ code: string }>(`SELECT code FROM vouchers WHERE router_id = ? AND status NOT IN ('removed','expired')`, [routerId]).map((r) => r.code));
  const gone = (await ctx.routers.exec(routerId, '/ip/hotspot/user/print')).filter((u) => tracked.has(u.name));
  await ctx.routers.exec(routerId, '/ip/hotspot/user/remove', { '.id': gone.map((u) => u['.id']).join(',') });

  const s1: any = await ctx.vouchers.sync(routerId);
  assert.equal(s1.deferred, true, 'sinkron pertama ditunda');
  assert.equal(row(codes[0]).status, 'unused');
  const s2: any = await ctx.vouchers.sync(routerId);
  assert.equal(s2.deferred, true, 'masih dalam masa tunggu');

  ctx.vouchers.massMissingGraceMs = 0; // masa tunggu habis
  try {
    const s3: any = await ctx.vouchers.sync(routerId);
    assert.equal(s3.deferred, false);
    assert.equal(s3.missing, gone.length);
    for (const c of codes) assert.equal(row(c).status, 'removed', c);
    const alerts = await api('GET', '/api/alerts');
    assert.ok(alerts.body.rows.some((x: any) => x.type === 'voucher.sync.removed'));
    const s4: any = await ctx.vouchers.sync(routerId);
    assert.equal(s4.deferred, false, 'tidak ada peringatan berulang');
  } finally {
    ctx.vouchers.massMissingGraceMs = 15 * 60_000;
  }
});
