import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, PlugZap, Plus, RefreshCw, Router as RouterIcon, ShieldCheck, Trash2 } from 'lucide-react';
import { del, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtime } from '../lib/realtime';
import { useRouters, type RouterInfo } from '../lib/router-context';
import { formatBps, humanDuration, pct, timeAgo } from '../lib/format';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, PageHeader, Progress, Select, StatusDot, Textarea, Toggle, useAction, useFeedback } from '../components/ui';

interface TestResult {
  latencyMs: number;
  identity: string;
  version: string;
  board: string;
  uptime: string;
  interfaces: { name: string; type: string; running: boolean }[];
}

const empty = { name: '', host: '', port: 8728, username: 'admin', password: '', use_tls: false, simulate: false, location: '', wan_interface: '', hotspot_dns: '', notes: '', enabled: true };

function RouterForm({ initial, onClose }: { initial: RouterInfo | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => (initial ? { ...empty, ...initial, password: '' } : empty));
  const [test, setTest] = useState<TestResult | null>(null);
  const { run, busy } = useAction();
  const testing = useAction();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const body = () => ({
    name: f.name,
    host: f.host,
    port: Number(f.port),
    username: f.username,
    password: f.password || undefined,
    use_tls: f.use_tls,
    simulate: f.simulate,
    location: f.location,
    wan_interface: f.wan_interface,
    hotspot_dns: f.hotspot_dns,
    notes: f.notes,
    enabled: f.enabled,
  });

  const save = async () => {
    if (initial) await patch(`/api/routers/${initial.id}`, body());
    else await post('/api/routers', body());
    await qc.invalidateQueries({ queryKey: ['routers'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    return true;
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? `Ubah router ${initial.name}` : 'Tambah router MikroTik'}
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            icon={<PlugZap className="size-4" />}
            loading={testing.busy}
            onClick={async () => {
              setTest(null);
              const r = await testing.run(() => post<TestResult>('/api/routers/test', { ...body(), id: initial?.id }), 'Koneksi berhasil');
              if (r) setTest(r);
            }}
          >
            Tes koneksi
          </Button>
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={async () => (await run(save, 'Router disimpan')) && onClose()}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nama router" required>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Router Kantor" />
        </Field>
        <Field label="Lokasi">
          <Input value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Jl. Merdeka 1" />
        </Field>
        <Field label="IP / Host" required hint="IP publik, IP VPN, atau domain (DDNS) router">
          <Input value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="192.168.88.1" disabled={f.simulate} />
        </Field>
        <Field label="Port API" hint="api = 8728, api-ssl = 8729">
          <Input type="number" value={f.port} onChange={(e) => set('port', Number(e.target.value))} />
        </Field>
        <Field label="Username router" required>
          <Input value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Password router" hint={initial?.has_password ? 'Kosongkan jika tidak diganti' : 'Disimpan terenkripsi (AES-256)'}>
          <Input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" placeholder={initial?.has_password ? '••••••••' : ''} />
        </Field>
        <Field label="Interface WAN" hint="Untuk grafik trafik utama & alert link down">
          {test ? (
            <Select value={f.wan_interface} onChange={(e) => set('wan_interface', e.target.value)}>
              <option value="">Deteksi otomatis</option>
              {test.interfaces.map((i) => (
                <option key={i.name} value={i.name}>
                  {i.name} ({i.type}
                  {i.running ? ', up' : ', down'})
                </option>
              ))}
            </Select>
          ) : (
            <Input value={f.wan_interface} onChange={(e) => set('wan_interface', e.target.value)} placeholder="ether1 (kosong = otomatis)" />
          )}
        </Field>
        <Field label="DNS name hotspot" hint="Dipakai di QR & link login voucher">
          <Input value={f.hotspot_dns} onChange={(e) => set('hotspot_dns', e.target.value)} placeholder="hotspot.lan" />
        </Field>
        <Field label="Catatan" className="sm:col-span-2">
          <Textarea rows={2} className="font-sans text-sm" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-6 sm:col-span-2">
          <Toggle
            checked={f.use_tls}
            onChange={(v) => {
              set('use_tls', v);
              if (v && f.port === 8728) set('port', 8729);
              if (!v && f.port === 8729) set('port', 8728);
            }}
            label="Gunakan API-SSL (TLS)"
          />
          <Toggle checked={f.simulate} onChange={(v) => setF((x) => ({ ...x, simulate: v, host: v && !x.host ? 'simulator.local' : x.host }))} label="Mode simulasi (router virtual)" />
          <Toggle checked={f.enabled} onChange={(v) => set('enabled', v)} label="Aktif dipantau" />
        </div>
      </div>
      {test && (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />
          <div>
            <p className="font-semibold text-emerald-600 dark:text-emerald-400">Terhubung ke {test.identity}</p>
            <p className="mt-0.5 text-xs text-muted">
              {test.board} • RouterOS {test.version} • uptime {test.uptime} • latensi {test.latencyMs} ms • {test.interfaces.length} interface
            </p>
          </div>
        </div>
      )}
      <div className="mt-5 rounded-xl border border-line bg-surface-2 p-4 text-xs text-muted">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-fg">
          <ShieldCheck className="size-4 text-brand" /> Persiapan di MikroTik
        </p>
        <ol className="list-decimal space-y-0.5 pl-5">
          <li>
            Aktifkan API: <code className="font-mono">/ip service enable api</code> (atau <code className="font-mono">api-ssl</code>)
          </li>
          <li>
            Buat user khusus: <code className="font-mono">/user add name=mikrotal group=full password=RAHASIA</code>
          </li>
          <li>Batasi akses API hanya dari IP server MIKROTAL (IP › Services › api › Available From).</li>
          <li>Router di balik NAT? Gunakan VPN (WireGuard/L2TP/SSTP) atau port forward ke port API.</li>
        </ol>
      </div>
    </Modal>
  );
}

export default function Routers() {
  const { routers, setRouterId } = useRouters();
  const { snapshots } = useRealtime();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run } = useAction();
  const [editing, setEditing] = useState<RouterInfo | null | undefined>(undefined);
  const manage = can('router.manage');

  const remove = async (r: RouterInfo) => {
    if (!(await confirm({ title: 'Hapus router?', message: <>Router <b>{r.name}</b> beserta data voucher, metrik, dan riwayatnya akan dihapus dari MIKROTAL. Konfigurasi di MikroTik tidak berubah.</>, danger: true, confirmText: 'Hapus router' }))) return;
    await run(() => del(`/api/routers/${r.id}`), 'Router dihapus');
    void qc.invalidateQueries({ queryKey: ['routers'] });
  };

  return (
    <div>
      <PageHeader
        title="Router MikroTik"
        subtitle="Kelola semua router yang dipantau dari satu tempat"
        icon={<RouterIcon className="size-5" />}
        actions={
          manage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
              Tambah router
            </Button>
          )
        }
      />
      {!routers.length ? (
        <Card>
          <EmptyState icon={<RouterIcon className="size-6" />} title="Belum ada router" description="Tambahkan router MikroTik pertama Anda. Bisa juga memakai mode simulasi untuk mencoba." action={manage && <Button onClick={() => setEditing(null)}>Tambah router</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {routers.map((r) => {
            const snap = snapshots[r.id] ?? r.snapshot;
            return (
              <Card key={r.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                      <RouterIcon className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-semibold">
                        <StatusDot online={r.enabled ? snap?.online : undefined} />
                        {r.name}
                      </p>
                      <p className="truncate font-mono text-xs text-muted">{r.simulate ? 'simulasi' : `${r.host}:${r.port}${r.use_tls ? ' (SSL)' : ''}`}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {r.simulate && <Badge tone="violet">simulasi</Badge>}
                    {!r.enabled && <Badge>nonaktif</Badge>}
                  </div>
                </div>
                {snap?.online ? (
                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                    <div>
                      <div className="mb-1 flex justify-between text-muted">
                        <span>CPU</span>
                        <b className="text-fg">{snap.cpu}%</b>
                      </div>
                      <Progress value={snap.cpu ?? 0} />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-muted">
                        <span>Memori</span>
                        <b className="text-fg">{Math.round(pct(snap.memUsed, snap.memTotal))}%</b>
                      </div>
                      <Progress value={pct(snap.memUsed, snap.memTotal)} />
                    </div>
                    <p className="text-muted">
                      Identity: <b className="text-fg">{snap.identity}</b>
                    </p>
                    <p className="text-muted">
                      Uptime: <b className="text-fg">{humanDuration(snap.uptimeSeconds, 2)}</b>
                    </p>
                    <p className="text-muted">
                      Board: <b className="text-fg">{snap.board}</b>
                    </p>
                    <p className="text-muted">
                      ROS: <b className="text-fg">{snap.version}</b>
                    </p>
                    <p className="text-muted">
                      Hotspot: <b className="text-fg">{snap.hotspotActive} online</b>
                    </p>
                    <p className="text-muted">
                      WAN: <b className="text-fg">↓{formatBps(snap.rx)}</b>
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 rounded-lg bg-rose-500/5 p-3 text-xs text-rose-500">{snap?.error ?? (r.enabled ? 'Menunggu koneksi pertama...' : 'Pemantauan dinonaktifkan')}</p>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 text-xs text-subtle" style={{ marginTop: 16 }}>
                  <span>{r.last_seen_at ? `Terakhir terlihat ${timeAgo(r.last_seen_at)}` : 'Belum pernah terhubung'}</span>
                  <div className="flex">
                    <IconButton
                      title="Sambung ulang"
                      onClick={() =>
                        run(async () => {
                          await post(`/api/routers/${r.id}/reconnect`);
                          await qc.invalidateQueries({ queryKey: ['routers'] });
                          return true;
                        }, 'Status diperbarui')
                      }
                    >
                      <RefreshCw className="size-4" />
                    </IconButton>
                    {manage && (
                      <>
                        <IconButton title="Ubah" onClick={() => setEditing(r)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton title="Hapus" tone="danger" onClick={() => remove(r)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      </>
                    )}
                    <Button size="sm" variant="secondary" className="ml-1" onClick={() => setRouterId(r.id)}>
                      Pilih
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing !== undefined && <RouterForm initial={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
