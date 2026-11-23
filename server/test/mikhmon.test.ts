import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { resetSimStores, SimulatedRouter } from '../src/lib/routeros/simulator.js';
import { isExpiryScheduler, isMikhmonVoucher, parseMikhmonMeta, parseRouterDate } from '../src/lib/mikhmon.js';

const ON_LOGIN = ':put (",rem,5000,1d,4000,,Disable,"); {:local date [ /system clock get date ];:local year [ :pick $date 7 11 ];:local month [ :pick $date 0 3 ];}';

test('Mikhmon: metadata profil dan tanggal format lama & RouterOS 7.10+', () => {
  assert.deepEqual(parseMikhmonMeta(ON_LOGIN), { expMode: 'rem', price: 5000, validity: '1d', resellerPrice: 4000, lockUser: 'Disable' });
  assert.equal(parseMikhmonMeta(':log info "halo"'), null);
  assert.equal(parseRouterDate('nov/30/2026 10:00:00', 420)!.toISOString(), '2026-11-30T03:00:00.000Z');
  assert.equal(parseRouterDate('2026-11-30 10:00:00', 420)!.toISOString(), '2026-11-30T03:00:00.000Z');
  assert.equal(parseRouterDate('dec/01/2026', 420)!.toISOString(), '2026-11-30T17:00:00.000Z');
  for (const bad of ['vc-123-11.23.26-', 'jan/01/1970 00:00:00', 'feb/31/2026 01:00:00', 'xyz/10/2026', '', '0000-00-00 00:00:00']) assert.equal(parseRouterDate(bad, 420), null, bad);
  assert.ok(isExpiryScheduler({ name: 'cek', 'on-event': ':foreach i in=[/ip hotspot user find where comment~"/"] do={ /ip hotspot user remove $i }' }, new Set()));
  assert.ok(!isExpiryScheduler({ name: 'backup', 'on-event': '/system backup save' }, new Set()));
  assert.ok(isMikhmonVoucher('vc-123-11.23.26-', 420) && isMikhmonVoucher('up-9-11.23.26-', 420) && isMikhmonVoucher('2026-11-30 10:00:00', 420) && isMikhmonVoucher('jan/01/1970 00:00:00', 420));
  assert.ok(!isMikhmonVoucher('member', 420) && !isMikhmonVoucher('', 420) && !isMikhmonVoucher('Pak Budi 0812', 420));
});

let app: FastifyInstance;
let ctx: AppContext;
let token = '';
const routerId = 1;
async function api(method: string, url: string, body?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: { authorization: `Bearer ${token}` } });
  return { status: res.statusCode, body: res.json() as any };
}
const ex = (cmd: string, p: Record<string, string> = {}) => ctx.routers.exec(routerId, cmd, p);
/** Tanggal dalam jam lokal router (WIB) dengan format lama Mikhmon. */
function oldFmt(ms: number) {
  const d = new Date(ms + 420 * 60_000);
  const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][d.getUTCMonth()];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${mon}/${p(d.getUTCDate())}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
function isoFmt(ms: number) {
  return new Date(ms + 420 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

before(async () => {
  resetSimStores();
  SimulatedRouter.autoActivity = false;
  ({ app, ctx } = await buildApp({ logger: false, config: { dbFile: ':memory:', seedDemo: true, adminUsername: 'admin', adminPassword: 'admin123', appSecret: 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxx' } }));
  token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin123' } })).json().token;
});
after(async () => {
  await app.close();
});

test('Mikhmon: deteksi, ambil alih dengan tanggal habis asli, lalu kembalikan script', async () => {
  const now = Date.now();
  const onLoginLock = ON_LOGIN.replace(',Disable,', ',Enable,');
  await ex('/ip/hotspot/user/profile/add', { name: 'MK1HARI', 'rate-limit': '2M/2M', 'on-login': onLoginLock });
  await ex('/system/scheduler/add', { name: 'MK1HARI', interval: '2m', 'on-event': ':foreach i in=[/ip hotspot user find where profile="MK1HARI"] do={:local c [/ip hotspot user get $i comment]; /ip hotspot user remove $i}' });
  const users: [string, string, string][] = [
    ['mk-baru', 'vc-001-11.23.26-', '0s'],
    ['mk-jalan', oldFmt(now + 10 * 3600_000), '30m'],
    ['mk-habis', isoFmt(now - 3600_000), '2h'],
    ['mk-rusak', 'jan/01/1970 00:00:00', '10m'],
  ];
  for (const [name, comment, uptime] of users) {
    await ex('/ip/hotspot/user/add', { name, password: name, profile: 'MK1HARI', comment });
    const u = (await ex('/ip/hotspot/user/print')).find((x) => x.name === name)!;
    await ex('/ip/hotspot/user/set', { '.id': u['.id'], uptime, 'bytes-out': uptime === '0s' ? '0' : '1000' });
  }

  const d = await api('GET', `/api/routers/${routerId}/mikhmon`);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.detected, true);
  assert.deepEqual(d.body.profiles.map((p: any) => [p.name, p.price, p.validity]), [['MK1HARI', 5000, '1d']]);
  assert.deepEqual(d.body.schedulers.map((s: any) => s.name), ['MK1HARI']);
  assert.equal(d.body.users.datedFuture, 1);
  assert.equal(d.body.users.datedPast, 1);
  assert.equal(d.body.users.badComment, 1);
  assert.equal(d.body.users.vouchers, 4);
  assert.equal(d.body.users.vouchersUntracked, 4);

  const t = await api('POST', `/api/routers/${routerId}/mikhmon/takeover`, { disableScripts: true });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(t.body.imported.imported, 4, 'hanya voucher Mikhmon, akun member tidak ikut');
  assert.equal(ctx.db.get('SELECT id FROM vouchers WHERE code = ?', ['budi']), undefined);
  assert.equal(t.body.imported.withExpiry, 2);
  assert.equal(t.body.imported.restarted, 1);
  assert.equal(t.body.imported.metaFilled >= 1, true);
  assert.equal(t.body.imported.expiredDisabled, 1);

  const row = (c: string) => ctx.db.get<any>('SELECT * FROM vouchers WHERE code = ?', [c]);
  assert.equal(row('mk-baru').status, 'unused');
  assert.equal(row('mk-baru').price, 5000, 'harga dari metadata Mikhmon');
  assert.equal(row('mk-jalan').status, 'used');
  assert.equal(Math.abs(Date.parse(row('mk-jalan').expires_at) - (now + 10 * 3600_000)) < 2000, true, 'tanggal habis asli dipertahankan');
  assert.equal(row('mk-habis').status, 'expired');
  const habis = () => ex('/ip/hotspot/user/print').then((l) => l.find((u) => u.name === 'mk-habis'));
  assert.equal((await habis())?.disabled, 'true', 'yang sudah lewat tanggal hanya dinonaktifkan, tidak dihapus');
  await ctx.vouchers.sync(routerId);
  assert.ok(await habis(), 'sinkronisasi berikutnya juga tidak menghapusnya');
  assert.equal(row('mk-rusak').status, 'used');
  assert.ok(Date.parse(row('mk-rusak').expires_at) > now + 23 * 3600_000, 'komentar rusak: masa aktif dihitung dari sekarang');

  const prof = (await ex('/ip/hotspot/user/profile/print')).find((p) => p.name === 'MK1HARI')!;
  assert.equal(prof['on-login'] ?? '', '', 'script on-login Mikhmon dikosongkan');

  // Lock User Mikhmon diambil alih MIKROTAL: voucher dikunci ke MAC perangkat pertama yang login
  assert.equal(ctx.db.get<any>('SELECT lock_mac FROM profile_meta WHERE router_id = ? AND profile = ?', [routerId, 'MK1HARI']).lock_mac, 1);
  await ex('/ip/hotspot/active/add', { user: 'mk-baru', address: '10.5.50.77', 'mac-address': 'AA:BB:CC:00:11:22', uptime: '1m' });
  await ctx.vouchers.sync(routerId);
  assert.equal((await ex('/ip/hotspot/user/print')).find((u) => u.name === 'mk-baru')!['mac-address'], 'AA:BB:CC:00:11:22');
  assert.equal(row('mk-baru').status, 'active');
  // menyimpan profil dari form lama (tanpa lock_mac) tidak mematikan kunci; dari form baru bisa diubah
  assert.equal((await api('PUT', `/api/routers/${routerId}/hotspot/profiles/MK1HARI`, { name: 'MK1HARI', rate_limit: '2M/2M', price: 5000 })).status, 200);
  const meta = async () => (await api('GET', `/api/routers/${routerId}/hotspot/profiles`)).body.find((p: any) => p.name === 'MK1HARI').meta.lock_mac;
  assert.equal(await meta(), true);
  await api('PUT', `/api/routers/${routerId}/hotspot/profiles/MK1HARI`, { name: 'MK1HARI', rate_limit: '2M/2M', price: 5000, lock_mac: false });
  assert.equal(await meta(), false);
  await api('PUT', `/api/routers/${routerId}/hotspot/profiles/MK1HARI`, { name: 'MK1HARI', rate_limit: '2M/2M', price: 5000, lock_mac: true });
  assert.equal((await ex('/system/scheduler/print')).find((s) => s.name === 'MK1HARI')!.disabled, 'true');
  const d2 = await api('GET', `/api/routers/${routerId}/mikhmon`);
  assert.equal(d2.body.takenOver, true);

  const r = await api('POST', `/api/routers/${routerId}/mikhmon/restore`);
  assert.equal(r.status, 200);
  assert.equal(r.body.restored, 2);
  assert.equal((await ex('/ip/hotspot/user/profile/print')).find((p) => p.name === 'MK1HARI')!['on-login'], onLoginLock);
  assert.equal((await ex('/system/scheduler/print')).find((s) => s.name === 'MK1HARI')!.disabled, 'false');
  assert.equal((await api('POST', `/api/routers/${routerId}/mikhmon/restore`)).status, 400);
});
