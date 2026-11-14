import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileDown, Plus, Printer, RefreshCw, Ticket, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { del, download, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRouters } from '../lib/router-context';
import { durationLabel, formatBytes, formatDate, formatMoney, humanDuration, timeLeft } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, SearchInput, Select, Tabs, useAction, useFeedback } from '../components/ui';

export const STATUS_META: Record<string, { label: string; tone: 'cyan' | 'green' | 'violet' | 'gray' | 'red' | 'yellow' }> = {
  unused: { label: 'Belum dipakai', tone: 'cyan' },
  active: { label: 'Online', tone: 'green' },
  used: { label: 'Terpakai', tone: 'violet' },
  expired: { label: 'Kedaluwarsa', tone: 'gray' },
  removed: { label: 'Dihapus di router', tone: 'red' },
  disabled: { label: 'Nonaktif', tone: 'yellow' },
};

interface VoucherRow {
  id: number;
  code: string;
  password: string;
  profile: string;
  price: number;
  status: string;
  validity: string;
  time_limit: string;
  data_limit: number;
  mac: string;
  ip: string;
  uptime_seconds: number;
  bytes_in: number;
  bytes_out: number;
  activated_at: string | null;
  expires_at: string | null;
  created_at: string;
  batch_code: string | null;
  batch_id: number | null;
  router_name: string;
  reseller_name: string | null;
}

function ImportModal({ routerId, onClose }: { routerId: number; onClose: () => void }) {
  const { run, busy } = useAction();
  const qc = useQueryClient();
  const [profile, setProfile] = useState('');
  const [comment, setComment] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Impor pengguna hotspot dari router"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              const r = await run(() => post<{ imported: number }>(`/api/routers/${routerId}/hotspot/import`, { profile: profile || undefined, commentContains: comment || undefined }));
              if (r) {
                void qc.invalidateQueries({ queryKey: ['vouchers'] });
                onClose();
              }
            }}
          >
            Impor
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">Cocok untuk memindahkan voucher lama (mis. dari Mikhmon) agar statusnya ikut dipantau MIKROTAL. Pengguna yang sudah tercatat dilewati.</p>
      <div className="space-y-4">
        <Field label="Hanya profil" hint="Kosongkan untuk semua profil">
          <Input value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="1HARI" />
        </Field>
        <Field label="Komentar mengandung" hint="mis. vc- atau up- (format Mikhmon)">
          <Input value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export default function Vouchers() {
  const { can, user } = useAuth();
  const { routerId, routers } = useRouters();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run, busy } = useAction();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [allRouters, setAllRouters] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const batchId = params.get('batchId') ?? '';
  const limit = 50;
  const isReseller = user?.role === 'reseller';
  const rid = allRouters || isReseller ? undefined : routerId;

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['vouchers', rid, status, q, page, batchId],
    queryFn: () => get<{ rows: VoucherRow[]; total: number; counts: Record<string, number> }>('/api/vouchers', { routerId: rid, status, q, page, limit, batchId }),
    refetchInterval: 30000,
  });
  const counts = data?.counts ?? {};
  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / limit));

  const remove = async (v: VoucherRow) => {
    if (!(await confirm({ title: `Hapus voucher ${v.code}?`, message: 'Voucher akan dihapus dari router dan database. Sesi aktif akan diputus.', danger: true, confirmText: 'Hapus' }))) return;
    await run(() => del(`/api/vouchers/${v.id}`), 'Voucher dihapus');
    void qc.invalidateQueries({ queryKey: ['vouchers'] });
  };

  const rows = data?.rows ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div>
      <PageHeader
        title="Daftar Voucher"
        subtitle="Status voucher disinkronkan otomatis dengan router (aktivasi, pemakaian, kedaluwarsa)"
        icon={<Ticket className="size-5" />}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw className={clsx('size-4', busy && 'animate-spin')} />}
              onClick={() =>
                run(async () => {
                  await post('/api/vouchers/sync', rid ? { routerId: rid } : {});
                  await qc.invalidateQueries({ queryKey: ['vouchers'] });
                  return true;
                }, 'Sinkronisasi selesai')
              }
            >
              Sinkronkan
            </Button>
            <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => run(() => download('/api/reports/vouchers.csv', { routerId: rid, status, batchId }, 'voucher.csv').then(() => true))}>
              Ekspor CSV
            </Button>
            {can('voucher.write') && !isReseller && routerId && (
              <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => setImporting(true)}>
                Impor
              </Button>
            )}
            {can('voucher.write') && (
              <Link to="/vouchers/generate">
                <Button icon={<Plus className="size-4" />}>Buat voucher</Button>
              </Link>
            )}
          </>
        }
      />
      <Card className="overflow-hidden">
        <div className="space-y-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              items={[{ value: '', label: 'Semua', count: totalAll }, ...Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: m.label, count: counts[k] ?? 0 }))].filter((t) => t.value === '' || t.value === status || (t.count ?? 0) > 0)}
            />
            <div className="flex flex-wrap items-center gap-2">
              {!isReseller && routers.length > 1 && (
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={allRouters} onChange={(e) => setAllRouters(e.target.checked)} /> Semua router
                </label>
              )}
              <SearchInput
                value={q}
                onChange={(v) => {
                  setQ(v);
                  setPage(1);
                }}
                placeholder="Cari kode / MAC..."
              />
            </div>
          </div>
          {(batchId || selected.size > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {batchId && (
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
              {selected.size > 0 && (
                <>
                  <span className="text-xs font-medium">{selected.size} dipilih</span>
                  <Button size="sm" variant="secondary" icon={<Printer className="size-3.5" />} onClick={() => window.open(`/print?ids=${[...selected].join(',')}`, '_blank')}>
                    Cetak terpilih
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Batal pilih
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={() => refetch()} />
        ) : !rows.length ? (
          <EmptyState icon={<Ticket className="size-6" />} title="Belum ada voucher" description="Voucher yang dibuat akan tampil di sini beserta status pemakaiannya." action={can('voucher.write') && <Link to="/vouchers/generate"><Button>Buat voucher</Button></Link>} />
        ) : (
          <div className={clsx('overflow-x-auto', isFetching && 'opacity-80')}>
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-8">
                    <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />
                  </th>
                  <th>Kode</th>
                  <th>Profil</th>
                  <th>Harga</th>
                  <th>Status</th>
                  <th>Pemakaian</th>
                  <th>Aktif sejak</th>
                  <th>Kedaluwarsa</th>
                  <th>Info</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const meta = STATUS_META[v.status] ?? { label: v.status, tone: 'gray' as const };
                  return (
                    <tr key={v.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(v.id)}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (n.has(v.id)) n.delete(v.id);
                              else n.add(v.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td>
                        <p className="font-mono text-sm font-bold tracking-wide">{v.code}</p>
                        {v.password !== v.code && <p className="font-mono text-[11px] text-subtle">pass: {v.password}</p>}
                      </td>
                      <td>
                        <Badge tone="violet">{v.profile}</Badge>
                        <p className="mt-0.5 text-[11px] text-subtle">{durationLabel(v.validity)}</p>
                      </td>
                      <td className="tabular-nums">{formatMoney(v.price)}</td>
                      <td>
                        <Badge tone={meta.tone} dot>
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="text-xs">
                        {v.uptime_seconds > 0 || v.bytes_in + v.bytes_out > 0 ? (
                          <>
                            <p>{humanDuration(v.uptime_seconds, 2)}</p>
                            <p className="text-subtle">{formatBytes(v.bytes_in + v.bytes_out)}</p>
                          </>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                      <td className="text-xs">{formatDate(v.activated_at)}</td>
                      <td className="text-xs">
                        {v.expires_at ? (
                          <>
                            <p>{formatDate(v.expires_at)}</p>
                            {v.status !== 'expired' && <p className="text-amber-500">sisa {timeLeft(v.expires_at)}</p>}
                          </>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                      <td className="text-[11px] text-muted">
                        {v.mac && <p className="font-mono">{v.mac}</p>}
                        {v.reseller_name && <p>Reseller: {v.reseller_name}</p>}
                        {allRouters && <p>{v.router_name}</p>}
                        {v.batch_code && <p className="font-mono text-subtle">{v.batch_code}</p>}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <IconButton title="Cetak" onClick={() => window.open(`/print?ids=${v.id}`, '_blank')}>
                          <Printer className="size-4" />
                        </IconButton>
                        {can('voucher.write') && !isReseller && (
                          <IconButton title="Hapus" tone="danger" onClick={() => remove(v)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
            <span>
              Halaman {page} dari {pages} • {data?.total} voucher
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Sebelumnya
              </Button>
              <Select className="h-8 w-20 py-0 text-xs" value={page} onChange={(e) => setPage(Number(e.target.value))}>
                {Array.from({ length: pages }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Berikutnya
              </Button>
            </div>
          </div>
        )}
      </Card>
      {importing && routerId && <ImportModal routerId={routerId} onClose={() => setImporting(false)} />}
    </div>
  );
}
