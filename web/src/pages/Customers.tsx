import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarPlus, Download, Eye, FileDown, Pencil, Plus, Power, RefreshCw, ShieldAlert, ShieldCheck, Ticket, Trash2, Unplug, UserRound, Users } from 'lucide-react';
import clsx from 'clsx';
import { del, download, get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { durationLabel, formatDate, formatMoney, humanDuration, timeAgo } from '../lib/format';
import { CUSTOMER_STATUS, daysLeft, type Customer, type PppPackage, type Topology } from '../lib/pppoe';
import { RequireRouter } from '../components/RequireRouter';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, IconButton, Input, KeyValue, Loading, Modal, PageHeader, SearchInput, Select, StatusDot, Tabs, Textarea, Toggle, useAction, useFeedback } from '../components/ui';

function usePackages(routerId: number) {
  return useQuery({ queryKey: ['ppp-packages', routerId], queryFn: () => get<PppPackage[]>('/api/pppoe/packages', { routerId }) }).data ?? [];
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['customers', 'customer', 'topology', 'pppoe-summary', 'ppp-vouchers', 'ppp-batches', 'dashboard']) void qc.invalidateQueries({ queryKey: [key] });
  };
}

export function ExpiryCell({ c }: { c: Pick<Customer, 'expires_at' | 'status'> }) {
  const d = daysLeft(c.expires_at);
  if (d === null) return <span className="text-subtle">Tanpa batas</span>;
  return (
    <>
      <p>{formatDate(c.expires_at, false)}</p>
      <p className={clsx('text-[11px]', d <= 0 ? 'text-rose-500' : d <= 3 ? 'text-amber-500' : 'text-subtle')}>{d <= 0 ? 'habis' : `sisa ${d} hari`}</p>
    </>
  );
}

/** Pilihan ODP dan port kosong. */
function OdpFields({ routerId, odpId, odpPort, customerId, onChange }: { routerId: number; odpId: number | null; odpPort: number | null; customerId?: number; onChange: (odpId: number | null, port: number | null) => void }) {
  const { data } = useQuery({ queryKey: ['topology', routerId], queryFn: () => get<Topology>('/api/topology', { routerId }) });
  const odps = useMemo(() => [...(data?.odcs.flatMap((d) => d.odps.map((o) => ({ ...o, label: `${d.name} › ${o.name}` }))) ?? []), ...(data?.looseOdps.map((o) => ({ ...o, label: o.name })) ?? [])], [data]);
  const odp = odps.find((o) => o.id === odpId);
  const taken = new Map(odp?.customers.filter((c) => c.id !== customerId && c.odp_port).map((c) => [c.odp_port!, c.name]));
  return (
    <>
      <Field label="ODP" hint={odps.length ? undefined : 'Belum ada ODP. Tambahkan di menu Topologi ODC/ODP.'}>
        <Select value={odpId ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, null)}>
          <option value="">— belum ditentukan —</option>
          {odps.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} ({o.used}/{o.ports} terpakai)
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Port ODP">
        <Select value={odpPort ?? ''} disabled={!odp} onChange={(e) => onChange(odpId, e.target.value ? Number(e.target.value) : null)}>
          <option value="">—</option>
          {odp &&
            Array.from({ length: odp.ports }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p} disabled={taken.has(p)}>
                Port {p}
                {taken.has(p) ? ` — ${taken.get(p)}` : ''}
              </option>
            ))}
        </Select>
      </Field>
    </>
  );
}

function CustomerModal({ routerId, customer, onClose }: { routerId: number; customer?: Customer; onClose: () => void }) {
  const { run, busy } = useAction();
  const { toast } = useFeedback();
  const refresh = useRefresh();
  const packages = usePackages(routerId);
  const [f, setF] = useState({
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    address: customer?.address ?? '',
    username: customer?.username ?? '',
    password: customer?.password ?? '',
    packageId: customer?.package_id ?? (null as number | null),
    odpId: customer?.odp_id ?? (null as number | null),
    odpPort: customer?.odp_port ?? (null as number | null),
    start: 'package' as 'package' | 'none' | 'unlimited',
    note: customer?.note ?? '',
  });
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));
  const pkg = packages.find((p) => p.id === f.packageId);

  const save = async () => {
    const r = await run(async () => {
      if (customer) {
        return patch<{ routerError?: string }>(`/api/customers/${customer.id}`, { name: f.name, phone: f.phone, address: f.address, password: f.password, packageId: f.packageId, odpId: f.odpId, odpPort: f.odpPort, note: f.note });
      }
      await post('/api/customers', {
        routerId,
        name: f.name,
        phone: f.phone,
        address: f.address,
        username: f.username,
        password: f.password,
        packageId: f.packageId,
        odpId: f.odpId,
        odpPort: f.odpPort,
        initialValidity: f.start === 'package' ? pkg?.validity ?? '' : '',
        unlimited: f.start === 'unlimited',
        note: f.note,
      });
      return {} as { routerError?: string };
    });
    if (!r) return;
    if (r.routerError) toast('warning', 'Tersimpan, router belum diperbarui', `${r.routerError}. Akan diterapkan otomatis saat router terhubung.`);
    else toast('success', customer ? 'Pelanggan diperbarui' : 'Pelanggan ditambahkan', customer ? undefined : 'Akun PPPoE dibuat di router.');
    refresh();
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={customer ? `Ubah ${customer.name}` : 'Pelanggan baru'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={save}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nama pelanggan" required>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="No. HP / WhatsApp">
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="08xxxxxxxxxx" />
        </Field>
        <Field label="Alamat" className="sm:col-span-2">
          <Input value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Username PPPoE" required hint={customer ? 'Username tidak dapat diubah' : 'Diisikan di router rumah pelanggan'}>
          <Input value={f.username} disabled={!!customer} onChange={(e) => set('username', e.target.value.trim())} className="font-mono" />
        </Field>
        <Field label="Password PPPoE" required>
          <div className="flex gap-2">
            <Input value={f.password} onChange={(e) => set('password', e.target.value)} className="font-mono" />
            <Button variant="secondary" type="button" onClick={() => set('password', Math.random().toString(36).slice(2, 10))}>
              Acak
            </Button>
          </div>
        </Field>
        <Field label="Paket" className={customer ? 'sm:col-span-2' : undefined}>
          <Select value={f.packageId ?? ''} onChange={(e) => set('packageId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— tanpa paket —</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} • {formatMoney(p.price)} / {durationLabel(p.validity)}
              </option>
            ))}
          </Select>
        </Field>
        {!customer && (
          <Field label="Masa aktif awal">
            <Select value={f.start} onChange={(e) => set('start', e.target.value)}>
              <option value="package">Langsung aktif {pkg ? durationLabel(pkg.validity) : '(pilih paket)'}</option>
              <option value="none">Belum aktif — terisolir sampai diisi voucher</option>
              <option value="unlimited">Tanpa batas (tidak pernah diisolir)</option>
            </Select>
          </Field>
        )}
        <OdpFields routerId={routerId} odpId={f.odpId} odpPort={f.odpPort} customerId={customer?.id} onChange={(o, p) => setF((x) => ({ ...x, odpId: o, odpPort: p }))} />
        <Field label="Catatan" className="sm:col-span-2">
          <Textarea rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function RedeemModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { run, busy } = useAction();
  const { toast } = useFeedback();
  const refresh = useRefresh();
  const [code, setCode] = useState('');
  const submit = async () => {
    const r = await run(() => post<{ expires_at: string; voucher: { package_name: string; validity: string }; routerError?: string }>(`/api/customers/${customer.id}/redeem`, { code }));
    if (!r) return;
    toast(r.routerError ? 'warning' : 'success', `Voucher ${r.voucher.package_name} terpakai`, `Masa aktif ${customer.name} sampai ${formatDate(r.expires_at)}.${r.routerError ? ` Router belum diperbarui: ${r.routerError}` : ''}`);
    refresh();
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Isi voucher — ${customer.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} disabled={!code.trim()} onClick={submit}>
            Isi voucher
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Kode voucher" hint="Masa aktif ditambahkan ke sisa yang ada. Jika terisolir, internet langsung dibuka.">
          <Input value={code} onChange={(e) => setCode(e.target.value)} className="h-12 text-center font-mono text-lg tracking-widest" placeholder="0000 0000 00" autoFocus />
        </Field>
      </form>
    </Modal>
  );
}

function ExtendModal({ routerId, customer, onClose }: { routerId: number; customer: Customer; onClose: () => void }) {
  const { run, busy } = useAction();
  const refresh = useRefresh();
  const packages = usePackages(routerId);
  const [packageId, setPackageId] = useState<number | null>(customer.package_id);
  const pkg = packages.find((p) => p.id === packageId);
  const [validity, setValidity] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const submit = async () => {
    const r = await run(
      () => post(`/api/customers/${customer.id}/extend`, { packageId, validity: validity || undefined, amount: amount === '' ? undefined : Number(amount), note }),
      'Masa aktif diperpanjang',
    );
    if (r) {
      refresh();
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Perpanjang manual — ${customer.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={submit}>
            Perpanjang
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">Untuk pembayaran tunai atau transfer tanpa voucher. Nominal tercatat di laporan penjualan.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paket" className="sm:col-span-2">
          <Select value={packageId ?? ''} onChange={(e) => setPackageId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— tanpa paket —</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} • {formatMoney(p.price)} / {durationLabel(p.validity)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tambah masa aktif" hint="Contoh: 30d, 7d">
          <Input value={validity} onChange={(e) => setValidity(e.target.value)} placeholder={pkg?.validity ?? '30d'} />
        </Field>
        <Field label="Nominal dibayar">
          <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(pkg?.price ?? 0)} />
        </Field>
        <Field label="Catatan" className="sm:col-span-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. transfer BCA 12 Nov" />
        </Field>
      </div>
    </Modal>
  );
}

const TX_LABEL: Record<string, { label: string; tone: 'green' | 'cyan' | 'yellow' | 'blue' }> = {
  voucher: { label: 'Voucher', tone: 'green' },
  manual: { label: 'Manual', tone: 'cyan' },
  isolate: { label: 'Isolir', tone: 'yellow' },
  restore: { label: 'Dibuka', tone: 'blue' },
};

function DetailModal({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (c: Customer) => void }) {
  const { can } = useAuth();
  const { run, busy } = useAction();
  const { confirm, toast } = useFeedback();
  const refresh = useRefresh();
  const { data, isLoading, error } = useQuery({ queryKey: ['customer', id], queryFn: () => get<{ customer: Customer; history: any[] }>(`/api/customers/${id}`), refetchInterval: 15000 });
  const [expiry, setExpiry] = useState<string | null>(null);
  const c = data?.customer;
  const write = can('customer.write');

  const setStatus = async (status: Customer['status'], success: string) => {
    const r = await run(() => post<{ routerError?: string }>(`/api/customers/${id}/status`, { status }));
    if (!r) return;
    toast(r.routerError ? 'warning' : 'success', success, r.routerError ? `Router belum diperbarui: ${r.routerError}` : undefined);
    refresh();
  };
  const remove = async () => {
    if (!c) return;
    if (!(await confirm({ title: `Hapus ${c.name}?`, message: `Akun PPPoE "${c.username}" ikut dihapus dari router dan sesi aktif diputus. Riwayat pembayaran pelanggan ini juga terhapus.`, danger: true, confirmText: 'Hapus pelanggan' }))) return;
    const r = await run(() => del(`/api/customers/${id}`), 'Pelanggan dihapus');
    if (r) {
      refresh();
      onClose();
    }
  };
  const toLocalInput = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  return (
    <Modal open onClose={onClose} size="xl" title={c ? c.name : 'Pelanggan'}>
      {isLoading ? (
        <Loading />
      ) : error || !c ? (
        <ErrorBox error={error} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={CUSTOMER_STATUS[c.status].tone} dot>
                {CUSTOMER_STATUS[c.status].label}
              </Badge>
              <Badge tone={c.online ? 'green' : 'red'} dot>
                {c.online ? 'Online' : 'Offline'}
              </Badge>
              {!c.on_router && <Badge tone="red">Akun tidak ada di router</Badge>}
            </div>
            <KeyValue
              items={[
                ['Username', <span className="font-mono">{c.username}</span>],
                ['Password', <span className="font-mono">{c.password}</span>],
                ['Paket', c.package_name ?? '—'],
                ['Profil router', c.profile || '—'],
                ['Masa aktif', c.expires_at ? formatDate(c.expires_at) : 'Tanpa batas'],
                ['ODC › ODP', c.odp_name ? `${c.odc_name ? c.odc_name + ' › ' : ''}${c.odp_name}${c.odp_port ? ` port ${c.odp_port}` : ''}` : '—'],
                ['IP', c.ip || '—'],
                ['MAC router klien', c.mac || '—'],
                [c.online ? 'Uptime' : 'Terakhir online', c.online ? humanDuration(c.uptime_seconds, 2) : c.last_seen_at ? timeAgo(c.last_seen_at) : 'belum pernah'],
                ['HP', c.phone || '—'],
                ['Alamat', c.address || '—'],
              ]}
            />
            {c.note && <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">{c.note}</p>}
            {write && (
              <div className="space-y-2 border-t border-line pt-4">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(c)}>
                    Ubah data
                  </Button>
                  <Button size="sm" variant="secondary" icon={<Unplug className="size-3.5" />} disabled={!c.online || busy} onClick={() => run(() => post(`/api/customers/${id}/kick`), 'Sesi diputus, router klien akan menyambung ulang').then(refresh)}>
                    Putuskan sesi
                  </Button>
                  {c.status === 'active' && (
                    <Button size="sm" variant="secondary" icon={<ShieldAlert className="size-3.5" />} disabled={busy} onClick={() => setStatus('isolated', 'Pelanggan diisolir')}>
                      Isolir
                    </Button>
                  )}
                  {c.status === 'isolated' && (
                    <Button size="sm" variant="secondary" icon={<ShieldCheck className="size-3.5" />} disabled={busy} onClick={() => setStatus('active', 'Isolir dibuka')}>
                      Buka isolir
                    </Button>
                  )}
                  {c.status !== 'disabled' ? (
                    <Button size="sm" variant="secondary" icon={<Ban className="size-3.5" />} disabled={busy} onClick={() => setStatus('disabled', 'Akun dinonaktifkan')}>
                      Nonaktifkan
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" icon={<Power className="size-3.5" />} disabled={busy} onClick={() => setStatus(daysLeft(c.expires_at) !== null && daysLeft(c.expires_at)! <= 0 ? 'isolated' : 'active', 'Akun diaktifkan')}>
                      Aktifkan
                    </Button>
                  )}
                  <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} disabled={busy} onClick={remove}>
                    Hapus
                  </Button>
                </div>
                <Field label="Ubah tanggal habis masa aktif" hint="Koreksi manual tanpa mencatat pembayaran">
                  <div className="flex gap-2">
                    <Input type="datetime-local" className="min-w-0 flex-1" value={expiry ?? toLocalInput(c.expires_at)} onChange={(e) => setExpiry(e.target.value)} />
                    <Button
                      variant="secondary"
                      disabled={!expiry || busy}
                      onClick={async () => {
                        const r = await run(() => patch(`/api/customers/${id}`, { expiresAt: new Date(expiry!).toISOString() }), 'Tanggal diperbarui');
                        if (r) {
                          setExpiry(null);
                          refresh();
                        }
                      }}
                    >
                      Simpan
                    </Button>
                  </div>
                </Field>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-sm font-semibold">Riwayat masa aktif & pembayaran</p>
            {!data.history.length ? (
              <p className="rounded-lg bg-surface-2 p-4 text-sm text-muted">Belum ada riwayat.</p>
            ) : (
              <div className="max-h-[60vh] overflow-auto rounded-xl border border-line">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Jenis</th>
                      <th>Keterangan</th>
                      <th>Nominal</th>
                      <th>Aktif sampai</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((h) => (
                      <tr key={h.id}>
                        <td className="whitespace-nowrap text-xs">{formatDate(h.created_at)}</td>
                        <td>
                          <Badge tone={TX_LABEL[h.type]?.tone ?? 'blue'}>{TX_LABEL[h.type]?.label ?? h.type}</Badge>
                        </td>
                        <td className="text-xs">
                          {h.voucher_code && <p className="font-mono">{h.voucher_code}</p>}
                          {h.package_name && (
                            <p>
                              {h.package_name}
                              {h.validity ? ` • ${durationLabel(h.validity)}` : ''}
                            </p>
                          )}
                          {h.note && <p className="text-subtle">{h.note}</p>}
                          <p className="text-subtle">oleh {h.created_by}</p>
                        </td>
                        <td className="tabular-nums">{h.amount > 0 ? formatMoney(h.amount) : '—'}</td>
                        <td className="whitespace-nowrap text-xs">{h.expires_after ? formatDate(h.expires_after) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Inner({ routerId }: { routerId: number }) {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const refresh = useRefresh();
  const { run, busy } = useAction();
  const { confirm, toast } = useFeedback();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [packageId, setPackageId] = useState('');
  const [modal, setModal] = useState<{ type: 'new' } | { type: 'edit' | 'redeem' | 'extend'; customer: Customer } | { type: 'detail'; id: number } | null>(
    params.get('id') ? { type: 'detail', id: Number(params.get('id')) } : null,
  );
  const limit = 50;
  const write = can('customer.write');
  const packages = usePackages(routerId);
  const odpId = params.get('odpId') ?? '';

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['customers', routerId, status, q, page, packageId, odpId],
    queryFn: () => get<{ rows: Customer[]; total: number }>('/api/customers', { routerId, status, q, page, limit, packageId, odpId }),
    refetchInterval: 30000,
  });
  const { data: summary } = useQuery({ queryKey: ['pppoe-summary', routerId], queryFn: () => get<any>('/api/pppoe/summary', { routerId }), refetchInterval: 30000 });
  const s = summary?.customers;
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / limit));

  const importAll = async () => {
    if (!(await confirm({ title: 'Impor akun PPPoE dari router?', message: 'Semua PPP secret yang belum terdaftar akan dijadikan pelanggan tanpa batas masa aktif. Atur paket dan masa aktifnya setelah impor.', confirmText: 'Impor' }))) return;
    const r = await run(() => post<{ imported: number }>('/api/customers/import', { routerId }));
    if (r) {
      toast('success', `${r.imported} akun diimpor`);
      refresh();
    }
  };

  return (
    <div>
      <PageHeader
        title="Pelanggan PPPoE"
        subtitle="Akun PPPoE router rumah pelanggan, masa aktif, dan lokasi port ODP"
        icon={<Users className="size-5" />}
        actions={
          <>
            <Button variant="secondary" icon={<RefreshCw className={clsx('size-4', busy && 'animate-spin')} />} onClick={() => run(() => post('/api/pppoe/sync', { routerId }), 'Sinkronisasi selesai').then(refresh)}>
              Sinkronkan
            </Button>
            <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => run(() => download('/api/customers.csv', { routerId, status, q, packageId }, 'pelanggan.csv').then(() => true))}>
              Ekspor CSV
            </Button>
            {write && (
              <Button variant="secondary" icon={<Download className="size-4" />} onClick={importAll}>
                Impor dari router
              </Button>
            )}
            {write && (
              <Button icon={<Plus className="size-4" />} onClick={() => setModal({ type: 'new' })}>
                Pelanggan baru
              </Button>
            )}
          </>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <Tabs
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            items={[
              { value: '', label: 'Semua', count: s?.total },
              { value: 'online', label: 'Online', count: s?.online },
              { value: 'offline', label: 'Offline', count: s?.offline },
              { value: 'expiring', label: 'Hampir habis', count: s?.expiring },
              { value: 'isolated', label: 'Terisolir', count: s?.isolated },
              { value: 'disabled', label: 'Nonaktif', count: s?.disabled },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            {odpId && <Badge tone="blue">Filter ODP aktif</Badge>}
            <Select className="h-9 w-44 py-0 text-xs" value={packageId} onChange={(e) => (setPackageId(e.target.value), setPage(1))}>
              <option value="">Semua paket</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Cari nama / username / HP..." />
          </div>
        </div>
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={() => refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={<UserRound className="size-6" />}
            title={status || q || packageId ? 'Tidak ada pelanggan yang cocok' : 'Belum ada pelanggan'}
            description="Tambahkan pelanggan baru, atau impor akun PPPoE yang sudah ada di router."
            action={write && !status && !q && <Button onClick={() => setModal({ type: 'new' })}>Pelanggan baru</Button>}
          />
        ) : (
          <div className={clsx('overflow-x-auto', isFetching && 'opacity-80')}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Pelanggan</th>
                  <th>Akun PPPoE</th>
                  <th>Paket</th>
                  <th>Status</th>
                  <th>Masa aktif</th>
                  <th>ODP / Port</th>
                  <th>Koneksi</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <button className="flex items-center gap-2 text-left" onClick={() => setModal({ type: 'detail', id: c.id })}>
                        <StatusDot online={c.status === 'disabled' ? undefined : !!c.online} />
                        <span>
                          <span className="block font-semibold hover:underline">{c.name}</span>
                          <span className="block text-[11px] text-subtle">{c.phone || c.address || '—'}</span>
                        </span>
                      </button>
                    </td>
                    <td className="font-mono text-xs">
                      {c.username}
                      {!c.on_router && <p className="font-sans text-[11px] text-rose-500">tidak ada di router</p>}
                    </td>
                    <td>{c.package_name ? <Badge tone="violet">{c.package_name}</Badge> : <span className="text-xs text-subtle">{c.profile || '—'}</span>}</td>
                    <td>
                      <Badge tone={CUSTOMER_STATUS[c.status].tone} dot>
                        {CUSTOMER_STATUS[c.status].label}
                      </Badge>
                    </td>
                    <td className="text-xs">
                      <ExpiryCell c={c} />
                    </td>
                    <td className="text-xs">
                      {c.odp_name ? (
                        <>
                          <p>
                            {c.odp_name}
                            {c.odp_port ? ` • port ${c.odp_port}` : ''}
                          </p>
                          {c.odc_name && <p className="text-subtle">{c.odc_name}</p>}
                        </>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="text-xs">
                      {c.online ? (
                        <>
                          <p className="font-mono">{c.ip}</p>
                          <p className="text-subtle">{humanDuration(c.uptime_seconds, 2)}</p>
                        </>
                      ) : (
                        <span className="text-subtle">{c.last_seen_at ? `offline ${timeAgo(c.last_seen_at)}` : 'belum pernah online'}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {write && (
                        <>
                          <IconButton title="Isi voucher" tone="success" onClick={() => setModal({ type: 'redeem', customer: c })}>
                            <Ticket className="size-4" />
                          </IconButton>
                          <IconButton title="Perpanjang manual" onClick={() => setModal({ type: 'extend', customer: c })}>
                            <CalendarPlus className="size-4" />
                          </IconButton>
                        </>
                      )}
                      <IconButton title="Detail & riwayat" onClick={() => setModal({ type: 'detail', id: c.id })}>
                        <Eye className="size-4" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
            <span>
              Halaman {page} dari {pages} • {data?.total} pelanggan
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Sebelumnya
              </Button>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Berikutnya
              </Button>
            </div>
          </div>
        )}
      </Card>
      {modal?.type === 'new' && <CustomerModal routerId={routerId} onClose={() => setModal(null)} />}
      {modal?.type === 'edit' && <CustomerModal routerId={routerId} customer={modal.customer} onClose={() => setModal(null)} />}
      {modal?.type === 'redeem' && <RedeemModal customer={modal.customer} onClose={() => setModal(null)} />}
      {modal?.type === 'extend' && <ExtendModal routerId={routerId} customer={modal.customer} onClose={() => setModal(null)} />}
      {modal?.type === 'detail' && <DetailModal id={modal.id} onClose={() => setModal(null)} onEdit={(c) => setModal({ type: 'edit', customer: c })} />}
    </div>
  );
}

export default function Customers() {
  return <RequireRouter>{(routerId) => <Inner key={routerId} routerId={routerId} />}</RequireRouter>;
}
