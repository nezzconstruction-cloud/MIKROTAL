import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { resetSimStores, SimulatedRouter } from '../src/lib/routeros/simulator.js';

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const routerId = 1;

async function api(method: string, url: string, body?: unknown, who = 'admin') {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: { authorization: `Bearer ${tokens[who]}` } });
  return { status: res.statusCode, body: res.json() as any };
}

before(async () => {
  resetSimStores();
  SimulatedRouter.autoActivity = false;
  ({ app } = await buildApp({ logger: false, config: { dbFile: ':memory:', seedDemo: true, adminUsername: 'admin', adminPassword: 'admin123', appSecret: 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxx' } }));
  const login = async (u: string, p: string) => (tokens[u] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: p } })).json().token);
  await login('admin', 'admin123');
  for (const [u, role] of [['adm', 'admin'], ['opr', 'operator']] as const) {
    await api('POST', '/api/users', { username: u, name: u, role, password: 'rahasia123' });
    await login(u, 'rahasia123');
  }
});

after(async () => {
  await app.close();
});

test('semua menu: baca daftar & singleton, tambah, ubah properti apa saja, nonaktif, hapus', async () => {
  const tree = await api('GET', `/api/routers/${routerId}/ros?path=/queue/tree`);
  assert.equal(tree.status, 200, JSON.stringify(tree.body));
  assert.equal(tree.body.singleton, false);
  assert.equal(tree.body.rows[0].name, 'total-download');

  const dns = await api('GET', `/api/routers/${routerId}/ros?path=/ip/dns`);
  assert.equal(dns.body.singleton, true);
  const setDns = await api('POST', `/api/routers/${routerId}/ros/set`, { path: '/ip/dns', params: { servers: '1.1.1.1,8.8.8.8', 'allow-remote-requests': true } });
  assert.equal(setDns.status, 200, JSON.stringify(setDns.body));
  const dns2 = await api('GET', `/api/routers/${routerId}/ros?path=/ip/dns`);
  assert.equal(dns2.body.rows[0].servers, '1.1.1.1,8.8.8.8');
  assert.equal(dns2.body.rows[0]['allow-remote-requests'], 'true');

  const add = await api('POST', `/api/routers/${routerId}/ros/add`, { path: '/queue/tree', params: { name: 'total-upload', parent: 'global', 'max-limit': '50M', 'packet-mark': 'up' } });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const qid = add.body.id;
  const set = await api('POST', `/api/routers/${routerId}/ros/set`, { path: '/queue/tree', id: qid, params: { 'max-limit': '80M', 'burst-limit': '100M' } });
  assert.equal(set.status, 200);
  const dis = await api('POST', `/api/routers/${routerId}/ros/action`, { path: '/queue/tree', ids: [qid], action: 'disable' });
  assert.equal(dis.status, 200);
  let rows = (await api('GET', `/api/routers/${routerId}/ros?path=/queue/tree`)).body.rows;
  const q = rows.find((r: any) => r['.id'] === qid);
  assert.equal(q['max-limit'], '80M');
  assert.equal(q['burst-limit'], '100M');
  assert.equal(q.disabled, 'true');
  await api('POST', `/api/routers/${routerId}/ros/action`, { path: '/queue/tree', ids: [qid], action: 'remove' });
  rows = (await api('GET', `/api/routers/${routerId}/ros?path=/queue/tree`)).body.rows;
  assert.equal(rows.length, 1);

  // properti lengkap PPP profile (bridge, burst, only-one) bisa diubah
  const prof = (await api('GET', `/api/routers/${routerId}/ros?path=/ppp/profile`)).body.rows.find((r: any) => r.name === 'UP TO 50 MB');
  const setProf = await api('POST', `/api/routers/${routerId}/ros/set`, { path: '/ppp/profile', id: prof['.id'], params: { bridge: 'bridge-hotspot', 'only-one': 'yes', 'on-up': ':log info up' } });
  assert.equal(setProf.status, 200);
  const prof2 = (await api('GET', `/api/routers/${routerId}/ros?path=/ppp/profile`)).body.rows.find((r: any) => r.name === 'UP TO 50 MB');
  assert.equal(prof2.bridge, 'bridge-hotspot');
  assert.equal(prof2['on-up'], ':log info up');
});

test('semua menu: validasi path, menu tidak ada, hak akses', async () => {
  assert.equal((await api('GET', `/api/routers/${routerId}/ros?path=ip/address;reboot`)).status, 400);
  assert.equal((await api('GET', `/api/routers/${routerId}/ros?path=/system/reboot`)).status, 400);
  const missing = await api('GET', `/api/routers/${routerId}/ros?path=/routing/ospf/instance`);
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /tidak ada di RouterOS/);
  assert.equal((await api('POST', `/api/routers/${routerId}/ros/set`, { path: '/ip/dns', id: 'bukan-id', params: { servers: 'x' } })).status, 400);

  // operator hanya membaca
  assert.equal((await api('GET', `/api/routers/${routerId}/ros?path=/queue/tree`, undefined, 'opr')).status, 200);
  assert.equal((await api('POST', `/api/routers/${routerId}/ros/add`, { path: '/queue/tree', params: { name: 'x' } }, 'opr')).status, 403);
  // admin boleh mengubah menu biasa, tetapi user router & IP service hanya Super Admin
  assert.equal((await api('POST', `/api/routers/${routerId}/ros/set`, { path: '/ip/dns', params: { 'cache-size': '4096KiB' } }, 'adm')).status, 200);
  const svc = await api('POST', `/api/routers/${routerId}/ros/set`, { path: '/ip/service', id: '*1', params: { disabled: 'yes' } }, 'adm');
  assert.equal(svc.status, 403);
  assert.equal((await api('POST', `/api/routers/${routerId}/ros/add`, { path: '/user', params: { name: 'x', group: 'full' } }, 'adm')).status, 403);
  const audit = await api('GET', '/api/audit');
  assert.ok(audit.body.some((a: any) => a.action === 'router.ros.set' && a.target === '/ip/dns'));
});

test('sinkronisasi: pindai router, jadikan PPP Profile paket, impor PPP secret', async () => {
  const s = await api('GET', `/api/routers/${routerId}/sync`);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const names = s.body.ppp.profiles.map((p: any) => p.name);
  assert.ok(names.includes('UP TO 50 MB'));
  assert.ok(!names.includes('ISOLIR'));
  const up50 = s.body.ppp.profiles.find((p: any) => p.name === 'UP TO 50 MB');
  assert.equal(up50.packages.length, 0);
  assert.equal(up50.rateLimit, '50M/50M 0/0 0/0 8/8 8 30M/30M');
  const p10 = s.body.ppp.profiles.find((p: any) => p.name === 'PPPoE-10M');
  assert.equal(p10.packages[0].name, 'Rumahan 10 Mbps', 'paket contoh terdeteksi');
  assert.equal(s.body.ppp.notImported.length, 0, 'pelanggan contoh sudah terdaftar');
  assert.ok(s.body.hotspot.profiles.some((p: any) => p.name === '1HARI' && p.priced));
  assert.ok(s.body.live.find((l: any) => l.key === 'tree').count >= 1);
  // akun member (password beda dari username) tidak dihitung sebagai voucher yang perlu diimpor
  assert.equal(s.body.hotspot.members, 5);
  assert.equal(s.body.hotspot.notTracked, 0);
  await api('POST', `/api/routers/${routerId}/ros/add`, { path: '/ip/hotspot/user', params: { name: 'K9Q2', password: 'K9Q2', profile: '1HARI' } });
  const imp = await api('POST', `/api/routers/${routerId}/hotspot/import`, { vouchersOnly: true });
  assert.equal(imp.body.imported, 1, 'hanya voucher yang diimpor, member tidak');

  const mk = await api('POST', `/api/routers/${routerId}/sync/packages`, { profiles: ['UP TO 50 MB', 'PPPoE-10M', 'TIDAK-ADA'], validity: '30d' });
  assert.equal(mk.status, 200, JSON.stringify(mk.body));
  assert.deepEqual(mk.body.created, ['UP TO 50 MB']);
  assert.equal(mk.body.skipped.length, 2);
  const pk = (await api('GET', `/api/pppoe/packages?routerId=${routerId}`)).body.find((p: any) => p.name === 'UP TO 50 MB');
  assert.equal(pk.profile, 'UP TO 50 MB');
  assert.equal(pk.price, 0);

  // akun PPPoE yang dibuat langsung di Winbox muncul sebagai belum diimpor
  await api('POST', `/api/routers/${routerId}/ros/add`, { path: '/ppp/secret', params: { name: 'winbox-user', password: 'x1', profile: 'UP TO 50 MB', service: 'pppoe' } });
  const s2 = await api('GET', `/api/routers/${routerId}/sync`);
  assert.deepEqual(s2.body.ppp.notImported.map((n: any) => n.name), ['winbox-user']);
  await api('POST', '/api/customers/import', { routerId });
  const s3 = await api('GET', `/api/routers/${routerId}/sync`);
  assert.equal(s3.body.ppp.notImported.length, 0);
  const c = (await api('GET', `/api/customers?routerId=${routerId}&q=winbox-user`)).body.rows[0];
  assert.equal(c.package_name, 'UP TO 50 MB', 'pelanggan impor langsung terhubung ke paket dari profilnya');
});
