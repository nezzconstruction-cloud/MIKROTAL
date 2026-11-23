import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, Download, Package, RefreshCw, RefreshCcwDot, RotateCcw, Users, Wifi } from 'lucide-react';
import clsx from 'clsx';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { durationLabel, formatDate, formatMoney } from '../lib/format';
import { RequireRouter } from '../components/RequireRouter';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Toggle, useAction, useFeedback } from '../components/ui';

interface SyncData {
  ppp: {
    profiles: { name: string; rateLimit: string; localAddress: string; remoteAddress: string; bridge: string; onlyOne: string; isDefault: boolean; secrets: number; packages: { id: number; name: string; price: number; validity: string }[] }[];
    secretsTotal: number;
    notImported: { name: string; profile: string; comment: string; disabled: boolean }[];
    missingOnRouter: { id: number; name: string; username: string }[];
    customers: number;
  };
  hotspot: { profiles: { name: string; rateLimit: string; priced: boolean; users: number }[]; usersTotal: number; notTracked: number; members: number } | null;
  live: { key: string; label: string; to: string; count: number | null }[];
  scannedAt: string;
}

interface MikhmonInfo {
  detected: boolean;
  profiles: { name: string; expMode: string; price: number; validity: string; scriptActive: boolean }[];
  schedulers: { name: string; interval: string; disabled: boolean }[];
  users: { total: number; untracked: number; vouchers: number; vouchersUntracked: number; datedFuture: number; datedPast: number; badComment: number };
  takenOver: boolean;
  backups: { kind: string; name: string; at: string }[];
}

function MikhmonCard({ routerId, onChanged }: { routerId: number; onChanged: () => void }) {
  const { can } = useAuth();
  const { confirm, toast } = useFeedback();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [disableScripts, setDisableScripts] = useState(true);
  const [result, setResult] = useState<string[] | null>(null);
  const { data, refetch } = useQuery({ queryKey: ['mikhmon', routerId], queryFn: () => get<MikhmonInfo>(`/api/routers/${routerId}/mikhmon`) });
  if (!data || (!data.detected && !data.takenOver)) return null;
  const write = can('config.write');
  const activeScripts = data.profiles.filter((p) => p.scriptActive).length + data.schedulers.filter((s) => !s.disabled).length;

  const takeover = async () => {
    const r = await run(() => post<{ steps: string[] }>(`/api/routers/${routerId}/mikhmon/takeover`, { disableScripts }));
    if (!r) return;
    setResult(r.steps);
    setOpen(false);
    toast('success', 'MIKROTAL mengambil alih voucher Mikhmon');
    void refetch();
    onChanged();
  };
  const restore = async () => {
    if (!(await confirm({ title: 'Kembalikan script Mikhmon?', message: 'Script on-login dan scheduler Mikhmon diaktifkan lagi seperti semula. Di RouterOS 7.10 ke atas script itu bisa kembali menghapus voucher sebelum waktunya.', confirmText: 'Kembalikan', danger: true }))) return;
    const r = await run(() => post<{ restored: number; missing: string[] }>(`/api/routers/${routerId}/mikhmon/restore`));
    if (!r) return;
    toast('success', `${r.restored} script Mikhmon dikembalikan`, r.missing.length ? `Tidak ditemukan lagi di router: ${r.missing.join(', ')}` : undefined);
    void refetch();
    onChanged();
  };

  return (
    <Card className={clsx('overflow-hidden', activeScripts > 0 && 'border-amber-500/50')}>
      <CardHeader
        title="Voucher Mikhmon"
        subtitle={data.takenOver ? 'Sudah diambil alih MIKROTAL. Script Mikhmon dinonaktifkan dan dicadangkan.' : `${data.profiles.length} profil dan ${data.schedulers.length} scheduler Mikhmon ditemukan di router`}
        icon={<AlertTriangle className="size-4" />}
        actions={
          write && (
            <div className="flex flex-wrap gap-2">
              {data.takenOver && (
                <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} loading={busy} onClick={restore}>
                  Kembalikan script Mikhmon
                </Button>
              )}
              {(activeScripts > 0 || data.users.vouchersUntracked > 0) && (
                <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => setOpen(true)}>
                  Ambil alih dari Mikhmon
                </Button>
              )}
            </div>
          )
        }
      />
      <div className="space-y-3 p-5 text-sm">
        {activeScripts > 0 && (
          <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            Script Mikhmon membaca tanggal format lama. Sejak RouterOS 7.10 format tanggal berubah (mis. <span className="font-mono">nov/23/2026</span> → <span className="font-mono">2026-11-23</span>), sehingga voucher bisa langsung habis, tidak bisa login, hilang dari daftar, atau malah tidak pernah habis. Setelah diambil alih, masa aktif diatur MIKROTAL memakai jam komputer MIKROTAL, bukan script di router.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Voucher Mikhmon', data.users.vouchers],
            ['Belum dipantau', data.users.vouchersUntracked],
            ['Ada tanggal habis', data.users.datedFuture + data.users.datedPast],
            ['Tanggal rusak', data.users.badComment],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-xl bg-surface-2 p-3">
              <p className="text-[11px] text-muted">{l}</p>
              <p className="mt-1 text-xl font-bold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        {data.profiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.profiles.map((p) => (
              <Badge key={p.name} tone={p.scriptActive ? 'yellow' : 'gray'} dot>
                {p.name} • {formatMoney(p.price)} / {p.validity ? durationLabel(p.validity) : '—'} • script {p.scriptActive ? 'aktif' : 'nonaktif'}
              </Badge>
            ))}
            {data.schedulers.map((s) => (
              <Badge key={s.name} tone={s.disabled ? 'gray' : 'yellow'} dot>
                scheduler {s.name} • {s.disabled ? 'nonaktif' : 'aktif'}
              </Badge>
            ))}
          </div>
        )}
        {result && (
          <ul className="list-disc space-y-0.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 pl-7 text-xs text-muted">
            {result.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ambil alih voucher dari Mikhmon"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button loading={busy} onClick={takeover}>
              Ambil alih
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <ol className="list-decimal space-y-1.5 pl-5 text-muted">
            <li>
              <b className="text-fg">{data.users.vouchersUntracked}</b> voucher Mikhmon (komentar <span className="font-mono">vc-</span>/<span className="font-mono">up-</span> atau tanggal habis) diimpor. Akun member biasa tidak disentuh.
            </li>
            <li>Voucher yang sudah berjalan memakai tanggal habis dari komentarnya, jadi tidak mendapat masa aktif baru. Bila tanggalnya rusak, masa aktif dihitung mulai sekarang.</li>
            <li>Harga dan masa aktif profil diambil dari data Mikhmon bila belum diisi di MIKROTAL.</li>
          </ol>
          <Toggle checked={disableScripts} onChange={setDisableScripts} label="Nonaktifkan script on-login dan scheduler Mikhmon (disarankan)" />
          <p className="text-[11px] text-subtle">
            Script asli disimpan dan bisa dikembalikan. Bila dibiarkan aktif, script Mikhmon dan MIKROTAL sama-sama mengatur voucher dan script lama tetap bisa menghapus voucher sebelum waktunya.
          </p>
        </div>
      </Modal>
    </Card>
  );
}

function PackagesModal({ routerId, profiles, onClose, onDone }: { routerId: number; profiles: string[]; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const { toast } = useFeedback();
  const [validity, setValidity] = useState('30d');
  const [price, setPrice] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Jadikan ${profiles.length} PPP Profile sebagai paket`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              const r = await run(() => post<{ created: string[]; skipped: { profile: string; reason: string }[] }>(`/api/routers/${routerId}/sync/packages`, { profiles, validity, price: Number(price || 0) }));
              if (!r) return;
              toast(r.skipped.length ? 'warning' : 'success', `${r.created.length} paket dibuat`, r.skipped.length ? r.skipped.map((s) => `${s.profile}: ${s.reason}`).join('; ') : 'Atur harga tiap paket di Paket & Harga.');
              onDone();
            }}
          >
            Buat paket
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">Nama paket sama dengan nama profil dan kecepatannya mengikuti profil di router. Harga dan masa aktif bisa diubah satu per satu nanti di Paket &amp; Harga.</p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {profiles.map((p) => (
          <Badge key={p} tone="violet">
            {p}
          </Badge>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Masa aktif per voucher" hint="Contoh: 30d, 7d">
          <Input value={validity} onChange={(e) => setValidity(e.target.value)} />
        </Field>
        <Field label="Harga awal" hint="Kosong = 0, isi nanti">
          <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
        </Field>
      </div>
    </Modal>
  );
}

function Inner({ routerId, routerName }: { routerId: number; routerName: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { confirm, toast } = useFeedback();
  const { run, busy } = useAction();
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ['sync', routerId], queryFn: () => get<SyncData>(`/api/routers/${routerId}/sync`) });
  const refresh = () => {
    for (const k of ['sync', 'ppp-packages', 'customers', 'pppoe-summary', 'vouchers', 'topology', 'mikhmon', 'hs-profiles']) void qc.invalidateQueries({ queryKey: [k] });
  };
  if (isLoading) return <Loading text="Membaca data router..." />;
  if (error || !data) return <ErrorBox error={error} onRetry={() => refetch()} />;

  const noPkg = data.ppp.profiles.filter((p) => !p.packages.length);
  const allPicked = noPkg.length > 0 && noPkg.every((p) => pick.has(p.name));
  const writeCust = can('customer.write');
  const hs = data.hotspot;

  const importSecrets = async () => {
    if (!(await confirm({ title: `Impor ${data.ppp.notImported.length} akun PPPoE?`, message: 'Akun dijadikan pelanggan tanpa batas masa aktif, dengan paket yang profilnya sama. Atur masa aktif dan ODP tiap pelanggan setelah impor.', confirmText: 'Impor' }))) return;
    const r = await run(() => post<{ imported: number }>('/api/customers/import', { routerId }));
    if (r) {
      toast('success', `${r.imported} pelanggan diimpor`);
      refresh();
    }
  };
  const importHotspot = async () => {
    const r = await run(() => post<{ imported: number }>(`/api/routers/${routerId}/hotspot/import`, { vouchersOnly: true }));
    if (r) {
      toast('success', `${r.imported} user hotspot dipantau sebagai voucher`);
      refresh();
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sinkronisasi Router"
        subtitle={`Bandingkan isi ${routerName} dengan data MIKROTAL, lalu impor yang belum ada`}
        icon={<RefreshCcwDot className="size-5" />}
        actions={
          <Button variant="secondary" icon={<RefreshCw className={clsx('size-4', isFetching && 'animate-spin')} />} onClick={() => refetch()}>
            Pindai ulang
          </Button>
        }
      />
      <Card className="p-4 text-sm text-muted">
        Setelan router (interface, IP, firewall, queue, profil, dan lainnya) <b className="text-fg">tidak disalin</b> ke MIKROTAL: setiap menu membacanya langsung dari router, jadi selalu sama dengan Winbox. Yang perlu diimpor hanya data usaha: paket, pelanggan, dan voucher. Dipindai {formatDate(data.scannedAt)}.
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="PPP Profile"
          subtitle={`${data.ppp.profiles.length} profil di router • ${noPkg.length} belum jadi paket MIKROTAL`}
          icon={<Package className="size-4" />}
          actions={
            <div className="flex flex-wrap gap-2">
              <Link to="/res/ppp-profiles">
                <Button size="sm" variant="secondary">
                  Kelola profil
                </Button>
              </Link>
              {writeCust && (
                <Button size="sm" disabled={!pick.size} icon={<Package className="size-3.5" />} onClick={() => setModal(true)}>
                  Jadikan paket ({pick.size})
                </Button>
              )}
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-8">{writeCust && noPkg.length > 0 && <input type="checkbox" checked={allPicked} onChange={() => setPick(allPicked ? new Set() : new Set(noPkg.map((p) => p.name)))} />}</th>
                <th>Profil</th>
                <th>Rate limit (rx/tx)</th>
                <th>Local</th>
                <th>Remote / pool</th>
                <th>Only one</th>
                <th>Secret</th>
                <th>Paket MIKROTAL</th>
              </tr>
            </thead>
            <tbody>
              {data.ppp.profiles.map((p) => (
                <tr key={p.name}>
                  <td>
                    {writeCust && !p.packages.length && (
                      <input
                        type="checkbox"
                        checked={pick.has(p.name)}
                        onChange={() =>
                          setPick((s) => {
                            const n = new Set(s);
                            if (n.has(p.name)) n.delete(p.name);
                            else n.add(p.name);
                            return n;
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="font-mono text-xs font-semibold">
                    {p.name}
                    {p.isDefault && <Badge className="ml-1.5">bawaan</Badge>}
                  </td>
                  <td className="max-w-[220px] truncate font-mono text-xs" title={p.rateLimit}>
                    {p.rateLimit || '—'}
                  </td>
                  <td className="font-mono text-xs">{p.localAddress || '—'}</td>
                  <td className="text-xs">{p.remoteAddress || '—'}</td>
                  <td className="text-xs">{p.onlyOne || '—'}</td>
                  <td className="tabular-nums">{p.secrets}</td>
                  <td>
                    {p.packages.length ? (
                      p.packages.map((k) => (
                        <Badge key={k.id} tone="green" dot>
                          {k.name} • {k.price ? formatMoney(k.price) : 'harga belum diisi'} / {durationLabel(k.validity)}
                        </Badge>
                      ))
                    ) : (
                      <Badge tone="yellow">belum jadi paket</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="PPP Secret → Pelanggan" subtitle={`${data.ppp.secretsTotal} akun PPPoE di router • ${data.ppp.customers} pelanggan di MIKROTAL`} icon={<Users className="size-4" />} />
          <div className="space-y-4 p-5">
            {data.ppp.notImported.length ? (
              <>
                <p className="text-sm">
                  <b>{data.ppp.notImported.length}</b> akun PPPoE belum terdaftar sebagai pelanggan:
                </p>
                <div className="flex max-h-48 flex-wrap gap-1.5 overflow-auto">
                  {data.ppp.notImported.slice(0, 200).map((s) => (
                    <Badge key={s.name} tone={s.disabled ? 'gray' : 'cyan'}>
                      <span className="font-mono">{s.name}</span>
                      {s.profile ? ` • ${s.profile}` : ''}
                    </Badge>
                  ))}
                </div>
                {writeCust && (
                  <Button icon={<Download className="size-4" />} loading={busy} onClick={importSecrets}>
                    Impor {data.ppp.notImported.length} akun
                  </Button>
                )}
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-4" /> Semua akun PPPoE sudah terdaftar sebagai pelanggan.
              </p>
            )}
            {data.ppp.missingOnRouter.length > 0 && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
                <p className="font-medium text-rose-600 dark:text-rose-400">{data.ppp.missingOnRouter.length} pelanggan MIKROTAL tidak punya akun di router</p>
                <p className="mt-0.5 text-xs text-muted">Mungkin dihapus lewat Winbox. Buka pelanggannya untuk menghapus atau membuat ulang.</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.ppp.missingOnRouter.slice(0, 50).map((c) => (
                    <Link key={c.id} to={`/customers?id=${c.id}`}>
                      <Badge tone="red">{c.name}</Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Hotspot" subtitle={hs ? `${hs.profiles.length} profil user • ${hs.usersTotal} user` : 'Hotspot tidak aktif di router ini'} icon={<Wifi className="size-4" />} />
          {hs ? (
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-1.5">
                {hs.profiles.map((p) => (
                  <Badge key={p.name} tone={p.priced ? 'green' : 'yellow'} dot>
                    {p.name} • {p.priced ? 'ada harga' : 'belum ada harga'}
                  </Badge>
                ))}
              </div>
              {hs.profiles.some((p) => !p.priced) && (
                <Link to="/hotspot/profiles" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                  Isi harga di Profil &amp; Harga <ArrowRight className="size-3" />
                </Link>
              )}
              {hs.notTracked > 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm">
                    <b>{hs.notTracked}</b> voucher hotspot belum dipantau.
                  </p>
                  {can('voucher.write') && (
                    <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />} loading={busy} onClick={importHotspot}>
                      Impor semua
                    </Button>
                  )}
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" /> Semua voucher hotspot sudah dipantau.
                </p>
              )}
              {hs.members > 0 && <p className="text-xs text-muted">{hs.members} akun member (password berbeda dari username) dibiarkan sebagai akun tetap, tidak diimpor sebagai voucher.</p>}
            </div>
          ) : (
            <EmptyState title="Tidak ada hotspot" />
          )}
        </Card>
      </div>

      <MikhmonCard routerId={routerId} onChanged={refresh} />

      <Card>
        <CardHeader title="Setelan router lainnya" subtitle="Dibaca langsung dari router setiap kali dibuka. Klik untuk mengatur." />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
          {data.live.map((l) => (
            <Link key={l.key} to={l.to} className="rounded-xl bg-surface-2 p-3 transition hover:ring-1 hover:ring-brand/40">
              <p className="truncate text-[11px] text-muted">{l.label}</p>
              <p className="mt-1 text-xl font-bold tabular-nums">{l.count ?? '—'}</p>
            </Link>
          ))}
          <Link to="/router-menu" className="flex flex-col justify-center rounded-xl border border-dashed border-line p-3 text-xs font-medium text-brand hover:bg-surface-2">
            Semua menu router <ArrowRight className="mt-1 size-3.5" />
          </Link>
        </div>
      </Card>
      {modal && <PackagesModal routerId={routerId} profiles={[...pick]} onClose={() => setModal(false)} onDone={() => (setModal(false), setPick(new Set()), refresh())} />}
    </div>
  );
}

export default function RouterSync() {
  return <RequireRouter>{(routerId, router) => <Inner key={routerId} routerId={routerId} routerName={router.name} />}</RequireRouter>;
}
