import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, distanceMeters, type DiagCustomer } from '../src/services/diagnosis.js';

const server = { type: 'server' as const, id: 1, name: 'Server', lat: null, lng: null };
const odcs = [{ id: 1, name: 'ODC-1', lat: null, lng: null }];
const odps = [
  { id: 1, odc_id: 1, odc_port: 1, name: 'ODP-1', lat: null, lng: null },
  { id: 2, odc_id: 1, odc_port: 2, name: 'ODP-2', lat: null, lng: null },
];
const T = Date.parse('2026-11-14T10:00:00Z');
const cust = (id: number, odp: number | null, online: boolean, lastSeenMinAgo: number | null = 0, extra: Partial<DiagCustomer> = {}): DiagCustomer => ({
  id,
  name: `C${id}`,
  username: `c${id}`,
  phone: '',
  status: 'active',
  online: online ? 1 : 0,
  on_router: 1,
  odp_id: odp,
  odp_port: id,
  last_seen_at: lastSeenMinAgo === null ? null : new Date(T - lastSeenMinAgo * 60_000).toISOString(),
  lat: null,
  lng: null,
  ...extra,
});

test('jarak antar koordinat', () => {
  assert.equal(distanceMeters({ lat: null, lng: 1 }, { lat: 1, lng: 1 }), null);
  const d = distanceMeters({ lat: -6.2, lng: 106.8 }, { lat: -6.2, lng: 106.81 })!;
  assert.ok(d > 1090 && d < 1120, String(d));
});

test('semua pelanggan mati → sisi server, tidak dipecah per ODC', () => {
  const d = diagnose({ server, odcs, odps, customers: [cust(1, 1, false, 10), cust(2, 1, false, 10), cust(3, 2, false, 10)], now: T });
  assert.equal(d.findings.length, 1);
  assert.equal(d.findings[0].kind, 'server');
  const port = diagnose({ server, odcs, odps, customers: [cust(1, 1, false, 10), cust(2, 2, false, 10)], serverPortRunning: [{ name: 'ether2', running: false }], now: T });
  assert.equal(port.findings[0].confidence, 'tinggi');
  assert.match(port.findings[0].reason, /ether2/);
});

test('pelanggan nonaktif dan yang belum pernah online tidak dianggap gangguan', () => {
  const d = diagnose({
    server,
    odcs,
    odps,
    customers: [cust(1, 1, true), cust(2, 1, false, null), cust(3, 1, false, 30, { status: 'disabled' }), cust(4, 2, false, null), cust(5, 2, false, null)],
    now: T,
  });
  assert.equal(d.findings.length, 0);
  assert.equal(d.neverOnline.length, 3);
  assert.equal(d.totals.offline, 0);
});

test('satu-satunya pelanggan ODP mati → ambigu, keyakinan rendah', () => {
  const d = diagnose({ server, odcs, odps, customers: [cust(1, 1, true), cust(2, 1, true), cust(3, 2, false, 15)], now: T });
  assert.equal(d.findings.length, 1);
  assert.equal(d.findings[0].kind, 'ambiguous');
  assert.equal(d.findings[0].confidence, 'rendah');
});

test('mati tidak bersamaan ditandai, dan offline tanpa ODP dilaporkan terpisah', () => {
  const d = diagnose({ server, odcs, odps, customers: [cust(1, 1, true), cust(2, 2, false, 5), cust(3, 2, false, 600), cust(4, null, false, 20)], now: T });
  const f = d.findings.find((x) => x.kind === 'distribution')!;
  assert.equal(f.simultaneous, false);
  assert.match(f.reason, /Tidak hilang bersamaan/);
  assert.equal(d.unassignedOffline.length, 1);
});
