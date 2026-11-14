import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Layers, Plus, Printer, Ticket, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { del, download, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRouters } from '../lib/router-context';
import { durationLabel, formatDate, formatMoney } from '../lib/format';
import { groupCode, type PppPackage } from '../lib/pppoe';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, SearchInput, Select, Tabs, useAction, useFeedback } from '../components/ui';

interface VoucherRow {
  id: number;
  code: string;
  package_name: string;
  price: number;
  validity: string;
  status: 'unused' | 'used';
  batch_id: number | null;
  batch_code: string | null;
  reseller_name: string | null;
  customer_name: string;
  used_at: string | null;
  created_at: string;
}

interface BatchRow {
  id: number;
  code: string;
  package_name: string;
  qty: number;
  price: number;
  validity: string;
  cost: number;
  reseller_id: number | null;
  reseller_name: string | null;
  note: string;
  created_by: string;
  created_at: string;
  unused: number;
  used: number;
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['ppp-vouchers', 'ppp-batches', 'pppoe-summary', 'resellers', 'dashboard']) void qc.invalidateQueries({ queryKey: [key] });
  };
}

function GenerateModal({ routerId, onClose }: { routerId: number | undefined; onClose: () => void }) {
  const { user } = useAuth();
  const { run, busy } = useAction();
  const invalidate = useInvalidate();
  const isReseller = user?.role === 'reseller';
  const { data: packages = [] } = useQuery({ queryKey: ['ppp-packages', isReseller ? 'all' : routerId], queryFn: () => get<PppPackage[]>('/api/pppoe/packages', { routerId: isReseller ? undefined : routerId }) });
  const { data: resellers = [] } = useQuery({ queryKey: ['resellers'], queryFn: () => get<any[]>('/api/resellers') });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => get<any>('/api/settings') });
  const [packageId, setPackageId] = useState('');
  const [qty, setQty] = useState('10');
  const [resellerId, setResellerId] = useState('');
  const [note, setNote] = useState('');
  const active = packages.filter((p) => p.active);
  const pkg = active.find((p) => p.id === Number(packageId));
  const reseller = isReseller ? resellers[0] : resellers.find((r) => r.id === Number(resellerId));
  const unit = pkg && reseller ? (pkg.reseller_price > 0 ? pkg.reseller_price : pkg.price * (1 - (reseller.discount || 0) / 100)) : 0;
  const total = unit * Number(qty || 0);

  const submit = async (print: boolean) => {
    const r = await run(
      () => post<{ batch: { id: number }; created: number }>('/api/pppoe/vouchers/generate', { packageId: Number(packageId), qty: Number(qty), resellerId: resellerId ? Number(resellerId) : null, note }),
      'Voucher dibuat',
    );
    if (!r) return;
    invalidate();
    if (print) window.open(`/print-pppoe?batchId=${r.batch.id}`, '_blank');
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Buat voucher isi ulang PPPoE"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button variant="secondary" loading={busy} disabled={!pkg} onClick={() => submit(false)}>
            Buat
          </Button>
          <Button loading={busy} disabled={!pkg} icon={<Printer className="size-4" />} onClick={() => submit(true)}>
            Buat & cetak
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Voucher adalah kode isi ulang untuk memperpanjang masa aktif akun PPPoE pelanggan. Pelanggan tidak perlu mengubah setelan router di rumahnya.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paket" required className="sm:col-span-2" hint={active.length ? undefined : 'Belum ada paket yang dijual. Buat di menu Paket PPPoE.'}>
          <Select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">— pilih paket —</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} • {formatMoney(p.price)} / {durationLabel(p.validity)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Jumlah voucher" required>
          <Input type="number" min={1} max={1000} value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        {!isReseller && (
          <Field label="Untuk reseller" hint="Saldo reseller dipotong">
            <Select value={resellerId} onChange={(e) => setResellerId(e.target.value)}>
              <option value="">— dijual langsung —</option>
              {resellers
                .filter((r) => r.active)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} (saldo {formatMoney(r.balance)})
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label="Catatan" className="sm:col-span-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {pkg && (
        <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
          <p>
            {qty || 0} voucher <b>{pkg.name}</b>, masing-masing menambah <b>{durationLabel(pkg.validity)}</b>. Kode {settings?.pppoe?.voucherLength ?? 10} karakter.
          </p>
          {reseller && (
            <p className={clsx('mt-1', total > reseller.balance ? 'text-rose-500' : 'text-muted')}>
              Potong saldo {reseller.name}: {formatMoney(total)} ({formatMoney(unit)} / voucher). Saldo saat ini {formatMoney(reseller.balance)}.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function PppVouchers() {
  const { can, user } = useAuth();
  const { routerId } = useRouters();
  const [params, setParams] = useSearchParams();
  const invalidate = useInvalidate();
  const { confirm } = useFeedback();
  const { run } = useAction();
  const [view, setView] = useState<'vouchers' | 'batches'>(params.get('batchId') ? 'vouchers' : 'batches');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [generating, setGenerating] = useState(false);
  const isReseller = user?.role === 'reseller';
  const rid = isReseller ? undefined : routerId;
  const batchId = params.get('batchId') ?? '';
  const limit = 50;
  const write = can('voucher.write');

  const vouchers = useQuery({
    queryKey: ['ppp-vouchers', rid, status, q, page, batchId],
    queryFn: () => get<{ rows: VoucherRow[]; total: number; counts: Record<string, number> }>('/api/pppoe/vouchers', { routerId: rid, status, q, page, limit, batchId }),
    enabled: view === 'vouchers',
    refetchInterval: 30000,
  });
  const batches = useQuery({ queryKey: ['ppp-batches', rid], queryFn: () => get<BatchRow[]>('/api/pppoe/vouchers/batches', { routerId: rid }), enabled: view === 'batches' });
  const counts = vouchers.data?.counts ?? {};
  const pages = Math.max(1, Math.ceil((vouchers.data?.total ?? 0) / limit));

  const removeVoucher = async (v: VoucherRow) => {
    if (!(await confirm({ title: `Hapus voucher ${groupCode(v.code)}?`, message: 'Kode ini tidak akan bisa dipakai lagi.', danger: true, confirmText: 'Hapus' }))) return;
    await run(() => del(`/api/pppoe/vouchers/${v.id}`), 'Voucher dihapus');
    invalidate();
  };
  const removeBatch = async (b: BatchRow) => {
    const refund = !!b.reseller_id && b.unused > 0;
    if (
      !(await confirm({
        title: `Hapus batch ${b.code}?`,
        message: `${b.unused} voucher yang belum dipakai akan dihapus.${b.used ? ` ${b.used} voucher yang sudah dipakai tetap tercatat di riwayat pelanggan.` : ''}${refund ? ` Saldo ${b.reseller_name} dikembalikan untuk voucher yang belum dipakai.` : ''}`,
        danger: true,
        confirmText: 'Hapus batch',
      }))
    )
      return;
    await run(() => del(`/api/pppoe/vouchers/batches/${b.id}`, { refund: refund ? 1 : undefined }), 'Batch dihapus');
    invalidate();
  };

  return (
    <div>
      <PageHeader
        title="Voucher PPPoE"
        subtitle="Kode isi ulang masa aktif untuk akun PPPoE pelanggan"
        icon={<Ticket className="size-5" />}
        actions={
          <>
            <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => run(() => download('/api/pppoe/vouchers.csv', { routerId: rid, status, batchId }, 'voucher-pppoe.csv').then(() => true))}>
              Ekspor CSV
            </Button>
            {write && (
              <Button icon={<Plus className="size-4" />} onClick={() => setGenerating(true)}>
                Buat voucher
              </Button>
            )}
          </>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={view}
              onChange={setView}
              items={[
                { value: 'batches', label: 'Batch & cetak' },
                { value: 'vouchers', label: 'Semua voucher' },
              ]}
            />
            {view === 'vouchers' && (
              <Tabs
                value={status}
                onChange={(v) => (setStatus(v), setPage(1))}
                items={[
                  { value: '', label: 'Semua', count: (counts.unused ?? 0) + (counts.used ?? 0) },
                  { value: 'unused', label: 'Belum dipakai', count: counts.unused ?? 0 },
                  { value: 'used', label: 'Terpakai', count: counts.used ?? 0 },
                ]}
              />
            )}
            {view === 'vouchers' && batchId && (
              <Badge tone="blue">
                Batch #{batchId}
                <button
                  onClick={() => {
                    params.delete('batchId');
                    setParams(params);
                  }}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            )}
          </div>
          {view === 'vouchers' && <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Cari kode / pelanggan..." />}
        </div>

        {view === 'batches' ? (
          batches.isLoading ? (
            <Loading />
          ) : batches.error ? (
            <ErrorBox error={batches.error} onRetry={() => batches.refetch()} />
          ) : !batches.data?.length ? (
            <EmptyState icon={<Layers className="size-6" />} title="Belum ada voucher PPPoE" description="Buat voucher isi ulang, cetak, lalu jual ke pelanggan atau reseller." action={write && <Button onClick={() => setGenerating(true)}>Buat voucher</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Paket</th>
                    <th>Jumlah</th>
                    <th>Terpakai</th>
                    <th>Nilai</th>
                    <th>Reseller</th>
                    <th>Dibuat</th>
                    <th className="text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.data.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <button
                          className="font-mono text-sm font-bold hover:underline"
                          onClick={() => {
                            setParams({ batchId: String(b.id) });
                            setView('vouchers');
                          }}
                        >
                          {b.code}
                        </button>
                        {b.note && <p className="text-[11px] text-subtle">{b.note}</p>}
                      </td>
                      <td>
                        <Badge tone="violet">{b.package_name}</Badge>
                        <p className="mt-0.5 text-[11px] text-subtle">{durationLabel(b.validity)}</p>
                      </td>
                      <td className="tabular-nums">{b.qty}</td>
                      <td className="tabular-nums">
                        {b.used} <span className="text-subtle">/ sisa {b.unused}</span>
                      </td>
                      <td className="tabular-nums">{formatMoney(b.price * b.qty)}</td>
                      <td className="text-xs">
                        {b.reseller_name ? (
                          <>
                            <p>{b.reseller_name}</p>
                            <p className="text-subtle">bayar {formatMoney(b.cost)}</p>
                          </>
                        ) : (
                          <span className="text-subtle">langsung</span>
                        )}
                      </td>
                      <td className="text-xs">
                        <p>{formatDate(b.created_at)}</p>
                        <p className="text-subtle">{b.created_by}</p>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <IconButton title="Cetak yang belum dipakai" onClick={() => window.open(`/print-pppoe?batchId=${b.id}&onlyUnused=1`, '_blank')}>
                          <Printer className="size-4" />
                        </IconButton>
                        {write && !isReseller && (
                          <IconButton title="Hapus batch" tone="danger" onClick={() => removeBatch(b)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : vouchers.isLoading ? (
          <Loading />
        ) : vouchers.error ? (
          <ErrorBox error={vouchers.error} onRetry={() => vouchers.refetch()} />
        ) : !vouchers.data?.rows.length ? (
          <EmptyState icon={<Ticket className="size-6" />} title="Tidak ada voucher" description="Voucher isi ulang yang dibuat akan tampil di sini." />
        ) : (
          <div className={clsx('overflow-x-auto', vouchers.isFetching && 'opacity-80')}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Paket</th>
                  <th>Harga</th>
                  <th>Status</th>
                  <th>Dipakai oleh</th>
                  <th>Info</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.data.rows.map((v) => (
                  <tr key={v.id}>
                    <td className="font-mono text-sm font-bold tracking-wide">{groupCode(v.code)}</td>
                    <td>
                      <Badge tone="violet">{v.package_name}</Badge>
                      <p className="mt-0.5 text-[11px] text-subtle">{durationLabel(v.validity)}</p>
                    </td>
                    <td className="tabular-nums">{formatMoney(v.price)}</td>
                    <td>
                      <Badge tone={v.status === 'unused' ? 'cyan' : 'violet'} dot>
                        {v.status === 'unused' ? 'Belum dipakai' : 'Terpakai'}
                      </Badge>
                    </td>
                    <td className="text-xs">
                      {v.status === 'used' ? (
                        <>
                          <p>{v.customer_name || '—'}</p>
                          <p className="text-subtle">{formatDate(v.used_at)}</p>
                        </>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="text-[11px] text-muted">
                      {v.reseller_name && <p>Reseller: {v.reseller_name}</p>}
                      {v.batch_code && <p className="font-mono text-subtle">{v.batch_code}</p>}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {v.status === 'unused' && (
                        <IconButton title="Cetak" onClick={() => window.open(`/print-pppoe?ids=${v.id}`, '_blank')}>
                          <Printer className="size-4" />
                        </IconButton>
                      )}
                      {write && !isReseller && v.status === 'unused' && (
                        <IconButton title="Hapus" tone="danger" onClick={() => removeVoucher(v)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view === 'vouchers' && pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
            <span>
              Halaman {page} dari {pages} • {vouchers.data?.total} voucher
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
      {generating && <GenerateModal routerId={routerId} onClose={() => setGenerating(false)} />}
    </div>
  );
}
