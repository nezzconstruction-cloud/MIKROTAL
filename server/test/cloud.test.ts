import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { config as baseConfig } from '../src/config.js';
import { CloudHost } from '../src/cloud/host.js';
import { allocateTunnelIp, isPublicAddress, resolveAllowedHost } from '../src/cloud/net.js';
import { addMonths } from '../src/cloud/platform.js';
import { routerScript } from '../src/cloud/vpn.js';
import { resetSimStores, SimulatedRouter } from '../src/lib/routeros/simulator.js';

let host: CloudHost;
let port = 0;
let dataDir = '';
const DOMAIN = 'mikrotal.test';

/** Permintaan HTTP dengan header Host tertentu (subdomain pelanggan). */
function call(method: string, hostname: string, url: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: url,
        headers: {
          host: hostname,
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: any = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            /* bukan JSON */
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const platformHost = DOMAIN;
const tenantHost = (slug: string) => `${slug}.${DOMAIN}`;
let adminToken = '';
const adm = (method: string, url: string, body?: unknown) => call(method, platformHost, `/api/platform/admin${url}`, body, adminToken);

async function signup(slug: string, email: string) {
  const r = await call('POST', platformHost, '/api/platform/signup', {
    businessName: `Usaha ${slug}`,
    slug,
    ownerName: `Pemilik ${slug}`,
    email,
    phone: '081234567890',
    username: 'pemilik',
    password: 'rahasia-123',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const login = await call('POST', tenantHost(slug), '/api/auth/login', { username: 'pemilik', password: 'rahasia-123' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return login.body.token as string;
}

before(async () => {
  resetSimStores();
  SimulatedRouter.autoActivity = false;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikrotal-cloud-'));
  host = new CloudHost({
    base: { ...baseConfig, dataDir, appSecret: 'master-secret-for-tests-0123456789abcdef', dbFile: undefined },
    baseDomain: DOMAIN,
    publicScheme: 'https',
    platformAdminUsername: 'root',
    platformAdminPassword: 'root-password-1',
    disableJobs: true,
    logger: false,
    inMemory: true,
  });
  await host.init();
  await host.listen(0, '127.0.0.1');
  port = (host.server.address() as AddressInfo).port;
  const login = await call('POST', platformHost, '/api/platform/admin/login', { username: 'root', password: 'root-password-1' });
  assert.equal(login.status, 200);
  adminToken = login.body.token;
});

after(async () => {
  await host.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('aturan jaringan: alokasi IP tunnel dan alamat yang boleh dihubungi', async () => {
  assert.equal(allocateTunnelIp('10.200.0.0/16', []), '10.200.1.1');
  assert.equal(allocateTunnelIp('10.200.0.0/16', ['10.200.1.1', '10.200.1.2']), '10.200.1.3');
  const fullBlock = Array.from({ length: 254 }, (_, i) => `10.200.1.${i + 1}`);
  assert.equal(allocateTunnelIp('10.200.0.0/16', fullBlock), '10.200.2.1', 'melewati .0 dan .255');
  for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '10.0.0.5', '192.168.88.1', '172.17.0.2', '169.254.169.254', '100.64.1.1', '::1', 'fd00::1']) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['8.8.8.8', '103.10.20.30', '2001:4860:4860::8888']) assert.equal(isPublicAddress(ip), true, ip);
  assert.equal(await resolveAllowedHost('10.200.1.5', () => ['10.200.1.5']), '10.200.1.5', 'IP tunnel milik sendiri');
  await assert.rejects(resolveAllowedHost('10.200.1.6', () => ['10.200.1.5']), /tidak bisa dijangkau/, 'IP tunnel pelanggan lain');
  await assert.rejects(resolveAllowedHost('localhost', () => []), /tidak valid/);
  await assert.rejects(resolveAllowedHost('localhost.localdomain', () => []), /tidak (bisa dijangkau|ditemukan)/);
  assert.equal(addMonths('2026-01-31T10:00:00.000Z', 1), '2026-02-28T10:00:00.000Z');
});

test('skrip router: v7 WireGuard dan v6 L2TP hanya menyebut menu versinya, aman dijalankan ulang', () => {
  const common = { routerName: 'Kantor "Pusat"', tunnelIp: '10.200.1.7', serverIp: '10.200.0.1', endpoint: 'vpn.mikrotal.test', apiUser: 'mtcloud-abcde', apiPassword: 'Pw123' };
  const wg = routerScript({ ...common, kind: 'wireguard', wg: { privateKey: 'PRIV=', listenPort: 34567, serverPublicKey: 'SRVPUB=', serverPort: 13231 } });
  assert.match(wg, /\/interface wireguard add name=mikrotal-cloud private-key="PRIV=" listen-port=34567/);
  assert.match(wg, /endpoint-address=vpn\.mikrotal\.test endpoint-port=13231 allowed-address=10\.200\.0\.1\/32/);
  assert.match(wg, /\/ip address add address=10\.200\.1\.7 network=10\.200\.0\.1/);
  assert.match(wg, /\/user add name=mtcloud-abcde group=full password="Pw123" address=10\.200\.0\.1\/32/);
  assert.match(wg, /\/interface wireguard remove \[find comment="MIKROTAL Cloud"\]/, 'konfigurasi lama dibersihkan dulu');
  assert.ok(!wg.includes('Kantor "Pusat"'), 'tanda kutip di nama router dibuang');
  const l2tp = routerScript({ ...common, kind: 'l2tp', ppp: { user: 'usaha-1', secret: 'Sec', ipsecSecret: 'Psk' } });
  assert.ok(!/wireguard/i.test(l2tp), 'skrip v6 tidak boleh menyebut WireGuard (v6 menolak seluruh blok)');
  assert.match(l2tp, /\/interface l2tp-client add name=mikrotal-cloud connect-to=vpn\.mikrotal\.test user="usaha-1" password="Sec" use-ipsec=yes ipsec-secret="Psk"/);
  assert.ok(l2tp.trimEnd().endsWith('}') && l2tp.includes('\n{\n'), 'satu blok');
});

test('pendaftaran: subdomain sendiri, data dan login terpisah antar pelanggan', async () => {
  const info = await call('GET', platformHost, '/api/platform/info');
  assert.equal(info.status, 200);
  assert.equal(info.body.plans.length, 3);
  assert.equal((await call('GET', platformHost, '/api/platform/slug?slug=admin')).body.available, false, 'alamat sistem');
  const tokA = await signup('rtrw-jaya', 'jaya@example.com');
  const tokB = await signup('wifi-maju', 'maju@example.com');
  const dup = await call('POST', platformHost, '/api/platform/signup', { businessName: 'X', slug: 'rtrw-jaya', ownerName: 'X Y', email: 'x@example.com', phone: '08123456789', username: 'abc', password: 'rahasia-123' });
  assert.equal(dup.status, 400);

  // token pelanggan A tidak berlaku di pelanggan B
  assert.equal((await call('GET', tenantHost('wifi-maju'), '/api/auth/me', undefined, tokA)).status, 401);
  assert.equal((await call('GET', tenantHost('rtrw-jaya'), '/api/auth/me', undefined, tokA)).status, 200);

  // router simulasi tiap pelanggan terpisah walau id-nya sama
  const routersA = (await call('GET', tenantHost('rtrw-jaya'), '/api/routers', undefined, tokA)).body;
  const routersB = (await call('GET', tenantHost('wifi-maju'), '/api/routers', undefined, tokB)).body;
  assert.equal(routersA[0].id, routersB[0].id);
  const add = await call('POST', tenantHost('rtrw-jaya'), `/api/routers/${routersA[0].id}/res?path=/ip/hotspot/user`, { name: 'hanya-di-a', password: 'x', profile: 'default' }, tokA);
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const usersB = (await call('GET', tenantHost('wifi-maju'), `/api/routers/${routersB[0].id}/res?path=/ip/hotspot/user`, undefined, tokB)).body;
  assert.ok(!usersB.some((u: any) => u.name === 'hanya-di-a'));

  assert.equal((await call('GET', tenantHost('tidak-ada'), '/api/auth/me')).status, 404);
  const sub = await call('GET', tenantHost('rtrw-jaya'), '/api/cloud/subscription', undefined, tokA);
  assert.equal(sub.body.status.phase, 'trial');
  assert.equal(sub.body.status.maxRouters, 1);
  assert.equal(sub.body.publicUrl, 'https://rtrw-jaya.mikrotal.test');
});

test('alamat router di cloud: tolak jaringan internal server, batasi jumlah router', async () => {
  const tok = (await call('POST', tenantHost('rtrw-jaya'), '/api/auth/login', { username: 'pemilik', password: 'rahasia-123' })).body.token;
  for (const h of ['127.0.0.1', '192.168.88.1', '169.254.169.254', 'localhost']) {
    const r = await call('POST', tenantHost('rtrw-jaya'), '/api/routers', { name: 'X', host: h, username: 'admin', password: 'x' }, tok);
    assert.equal(r.status, 400, `${h}: ${JSON.stringify(r.body)}`);
  }
  const sim = await call('POST', tenantHost('rtrw-jaya'), '/api/routers', { name: 'Sim 2', host: 'sim', username: 'admin', simulate: true }, tok);
  assert.equal(sim.status, 400, 'router simulasi maksimal 1');
});

test('VPN lewat CHR: siapkan CHR, hubungkan router v7 & v6, isolasi antar pelanggan', async () => {
  const tokA = (await call('POST', tenantHost('rtrw-jaya'), '/api/auth/login', { username: 'pemilik', password: 'rahasia-123' })).body.token;
  const tokB = (await call('POST', tenantHost('wifi-maju'), '/api/auth/login', { username: 'pemilik', password: 'rahasia-123' })).body.token;
  const before = await call('POST', tenantHost('rtrw-jaya'), '/api/cloud/vpn', { name: 'Kantor', kind: 'wireguard' }, tokA);
  assert.equal(before.status, 503, 'VPN belum diatur admin');

  assert.equal((await adm('PUT', '/settings', { chr: { simulate: true, endpoint: 'vpn.mikrotal.test' } })).status, 200);
  const setup = await adm('POST', '/chr/setup');
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  const failed = setup.body.steps.filter((s: any) => !s.ok).map((s: any) => s.step);
  assert.deepEqual(failed, ['Server SSTP'], 'SSTP butuh sertifikat, sisanya siap');
  assert.deepEqual(setup.body.readiness.available.sort(), ['l2tp', 'sstp', 'wireguard'].sort());

  const wg = await call('POST', tenantHost('rtrw-jaya'), '/api/cloud/vpn', { name: 'Kantor', kind: 'wireguard' }, tokA);
  assert.equal(wg.status, 200, JSON.stringify(wg.body));
  assert.equal(wg.body.peer.tunnel_ip, '10.200.1.1');
  assert.equal(wg.body.router.host, '10.200.1.1', 'router langsung terdaftar dengan IP tunnel');
  assert.match(wg.body.script, /\/interface wireguard add name=mikrotal-cloud/);
  const chrPeers = await host.vpn.exec('/interface/wireguard/peers/print');
  assert.ok(chrPeers.some((p) => p['allowed-address'] === '10.200.1.1/32' && p.comment === `mikrotal:rtrw-jaya:${wg.body.peer.id}`));

  // paket uji coba: 1 router
  const second = await call('POST', tenantHost('rtrw-jaya'), '/api/cloud/vpn', { name: 'Cabang', kind: 'l2tp' }, tokA);
  assert.equal(second.status, 402);

  // pelanggan B tidak boleh memakai IP tunnel milik A
  const steal = await call('POST', tenantHost('wifi-maju'), '/api/routers', { name: 'Curi', host: '10.200.1.1', username: 'admin', password: 'x' }, tokB);
  assert.equal(steal.status, 400);

  const l2tp = await call('POST', tenantHost('wifi-maju'), '/api/cloud/vpn', { name: 'RB v6', kind: 'l2tp' }, tokB);
  assert.equal(l2tp.status, 200, JSON.stringify(l2tp.body));
  assert.equal(l2tp.body.peer.tunnel_ip, '10.200.1.2');
  const secret = (await host.vpn.exec('/ppp/secret/print')).find((s) => s.name === l2tp.body.peer.ppp_user);
  assert.equal(secret?.['remote-address'], '10.200.1.2');
  assert.equal(secret?.service, 'l2tp');
  assert.match(l2tp.body.script, /use-ipsec=yes ipsec-secret="[A-Za-z0-9]+"/);

  const list = await call('GET', tenantHost('wifi-maju'), '/api/cloud/vpn', undefined, tokB);
  assert.equal(list.body.peers.length, 1, 'hanya koneksi milik sendiri');
  assert.equal(list.body.peers[0].vpn.online, false);

  const del = await call('DELETE', tenantHost('wifi-maju'), `/api/cloud/vpn/${l2tp.body.peer.id}?deleteRouter=true`, undefined, tokB);
  assert.equal(del.status, 200);
  assert.ok(!(await host.vpn.exec('/ppp/secret/print')).some((s) => s.name === l2tp.body.peer.ppp_user), 'dihapus dari CHR');
  assert.ok(!(await call('GET', tenantHost('wifi-maju'), '/api/routers', undefined, tokB)).body.some((r: any) => r.host === '10.200.1.2'));
  // B tidak bisa menghapus koneksi milik A
  assert.equal((await call('DELETE', tenantHost('wifi-maju'), `/api/cloud/vpn/${wg.body.peer.id}`, undefined, tokB)).status, 404);
});

test('transfer manual: tagihan dengan kode unik, unggah bukti, admin konfirmasi, masa aktif diperpanjang', async () => {
  const tok = (await call('POST', tenantHost('rtrw-jaya'), '/api/auth/login', { username: 'pemilik', password: 'rahasia-123' })).body.token;
  const noBank = await call('POST', tenantHost('rtrw-jaya'), '/api/cloud/invoices', { planCode: 'bisnis', months: 3 }, tok);
  assert.equal(noBank.status, 503, 'rekening belum diatur');
  await adm('PUT', '/settings', { bankAccounts: [{ bank: 'BCA', number: '1234567890', holder: 'PT Contoh' }] });

  const inv = await call('POST', tenantHost('rtrw-jaya'), '/api/cloud/invoices', { planCode: 'bisnis', months: 3 }, tok);
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  assert.equal(inv.body.base_amount, 300000);
  assert.ok(inv.body.unique_code >= 1 && inv.body.unique_code <= 999);
  assert.equal(inv.body.amount, 300000 + inv.body.unique_code);
  assert.match(inv.body.number, /^INV-\d{8}-\d{5}$/);

  const fake = await call('POST', tenantHost('rtrw-jaya'), `/api/cloud/invoices/${inv.body.id}/proof`, { fileName: 'bukti.png', dataBase64: Buffer.from('bukan gambar').toString('base64'), payerName: 'Budi' }, tok);
  assert.equal(fake.status, 400, 'isi berkas diperiksa');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const proof = await call('POST', tenantHost('rtrw-jaya'), `/api/cloud/invoices/${inv.body.id}/proof`, { fileName: 'bukti.png', dataBase64: png.toString('base64'), payerName: 'Budi' }, tok);
  assert.equal(proof.status, 200, JSON.stringify(proof.body));
  assert.equal(proof.body.status, 'review');

  // operator biasa tidak boleh mengurus tagihan
  const ov = await adm('GET', '/overview');
  assert.equal(ov.body.invoicesToReview, 1);
  const review = await adm('GET', '/invoices?status=review');
  assert.equal(review.body[0].slug, 'rtrw-jaya');

  const ok = await adm('POST', `/invoices/${inv.body.id}/confirm`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.tenant.trial, 0);
  const days = (Date.parse(ok.body.tenant.period_end) - Date.now()) / 86400_000;
  assert.ok(days > 88 && days < 93, `3 bulan dari sekarang, dapat ${days}`);

  const sub = await call('GET', tenantHost('rtrw-jaya'), '/api/cloud/subscription', undefined, tok);
  assert.equal(sub.body.status.phase, 'active');
  assert.equal(sub.body.status.planCode, 'bisnis');
  assert.equal(sub.body.status.maxRouters, 3);
  const alerts = await call('GET', tenantHost('rtrw-jaya'), '/api/alerts', undefined, tok);
  assert.ok(alerts.body.rows.some((a: any) => a.title === 'Pembayaran diterima'));
  // setelah upgrade, router kedua bisa ditambahkan
  const second = await call('POST', tenantHost('rtrw-jaya'), '/api/cloud/vpn', { name: 'Cabang', kind: 'l2tp' }, tok);
  assert.equal(second.status, 200, JSON.stringify(second.body));
});

test('langganan habis: masa tenggang, lalu hanya login & halaman Langganan', async () => {
  const tok = (await call('POST', tenantHost('wifi-maju'), '/api/auth/login', { username: 'pemilik', password: 'rahasia-123' })).body.token;
  const t = host.platform.tenantBySlug('wifi-maju')!;
  host.platform.updateTenant(t.id, { period_end: new Date(Date.now() - 86400_000).toISOString() });
  assert.equal((await call('GET', tenantHost('wifi-maju'), '/api/cloud/subscription', undefined, tok)).body.status.phase, 'grace');
  assert.equal((await call('GET', tenantHost('wifi-maju'), '/api/routers', undefined, tok)).status, 200, 'masa tenggang masih jalan');

  host.platform.updateTenant(t.id, { period_end: new Date(Date.now() - 10 * 86400_000).toISOString() });
  const blocked = await call('GET', tenantHost('wifi-maju'), '/api/routers', undefined, tok);
  assert.equal(blocked.status, 402);
  assert.equal(blocked.body.code, 'SUBSCRIPTION_INACTIVE');
  assert.equal((await call('GET', tenantHost('wifi-maju'), '/api/cloud/subscription', undefined, tok)).status, 200);
  assert.equal((await call('POST', tenantHost('wifi-maju'), '/api/auth/login', { username: 'pemilik', password: 'rahasia-123' })).status, 200);

  await host.tick();
  const alerts = host.loaded('wifi-maju')!.ctx.db.all<any>("SELECT title FROM alerts WHERE type = 'cloud.subscription'");
  assert.ok(alerts.some((a) => a.title === 'Langganan berhenti'));
  await host.tick();
  assert.equal(host.loaded('wifi-maju')!.ctx.db.all<any>("SELECT id FROM alerts WHERE title = 'Langganan berhenti'").length, 1, 'pengingat tidak berulang');

  // admin menghentikan akun lain
  const a = host.platform.tenantBySlug('rtrw-jaya')!;
  const sus = await adm('PATCH', `/tenants/${a.id}`, { status: 'suspended', suspended_reason: 'Pelanggaran' });
  assert.equal(sus.body.state.phase, 'suspended');
  const tokA = (await call('POST', tenantHost('rtrw-jaya'), '/api/auth/login', { username: 'pemilik', password: 'rahasia-123' })).body.token;
  assert.equal((await call('GET', tenantHost('rtrw-jaya'), '/api/routers', undefined, tokA)).status, 402);
  await adm('PATCH', `/tenants/${a.id}`, { status: 'active' });
  assert.equal((await call('GET', tenantHost('rtrw-jaya'), '/api/routers', undefined, tokA)).status, 200);
});

test('admin platform: butuh login, reset password pemilik', async () => {
  assert.equal((await call('GET', platformHost, '/api/platform/admin/tenants')).status, 401);
  // token pelanggan tidak berlaku di panel admin
  const tok = (await call('POST', tenantHost('rtrw-jaya'), '/api/auth/login', { username: 'pemilik', password: 'rahasia-123' })).body.token;
  assert.equal((await call('GET', platformHost, '/api/platform/admin/tenants', undefined, tok)).status, 401);
  const list = await adm('GET', '/tenants');
  assert.equal(list.body.length, 2);
  const a = list.body.find((t: any) => t.slug === 'rtrw-jaya');
  const r = await adm('POST', `/tenants/${a.id}/reset-password`, { password: 'password-baru-1' });
  assert.equal(r.body.username, 'pemilik');
  assert.equal((await call('POST', tenantHost('rtrw-jaya'), '/api/auth/login', { username: 'pemilik', password: 'password-baru-1' })).status, 200);
});
