import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Layers, List, Plus, Printer, Trash2 } from 'lucide-react';
import { del, download, get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRouters } from '../lib/router-context';
import { durationLabel, formatDate, formatMoney } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, IconButton, Loading, Modal, PageHeader, Toggle, useAction } from '../components/ui';

interface Batch {
  id: number;
  code: string;
  router_id: number;
  router_name: string;
  profile: string;
  qty: number;
  price: number;
  validity: string;
  time_limit: string;
  reseller_name: string | null;
  reseller_id: number | null;
  cost: number;
  note: string;
  created_by: string;
  created_at: string;
  unused: number;
  active: number;
  used: number;
}

export default function Batches() {
  const { can, user } = useAuth();
  const { routerId } = useRouters();
  const qc = useQueryClient();
  const { run, busy } = useAction();
  const [all, setAll] = useState(false);
  const [deleting, setDeleting] = useState<Batch | null>(null);
  const [refund, setRefund] = useState(true);
  const isReseller = user?.role === 'reseller';
  const rid = all || isReseller ? undefined : routerId;
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['batches', rid], queryFn: () => get<Batch[]>('/api/vouchers/batches', { routerId: rid }) });

  return (
    <div>
      <PageHeader
        title="Batch & Cetak Voucher"
        subtitle="Setiap kali generate, voucher dikelompokkan dalam satu batch untuk dicetak atau dikelola bersama"
        icon={<Layers className="size-5" />}
        actions={
          <>
            {!isReseller && <Toggle checked={all} onChange={setAll} label="Semua router" />}
            {can('voucher.write') && (
              <Link to="/vouchers/generate">
                <Button icon={<Plus className="size-4" />}>Buat voucher</Button>
              </Link>
            )}
          </>
        }
      />
      <Card className="overflow-hidden">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={() => refetch()} />
        ) : !data?.length ? (
          <EmptyState icon={<Layers className="size-6" />} title="Belum ada batch voucher" action={can('voucher.write') && <Link to="/vouchers/generate"><Button>Buat voucher pertama</Button></Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Profil</th>
                  <th>Jumlah</th>
                  <th>Pemakaian</th>
                  <th>Harga</th>
                  <th>Reseller</th>
                  <th>Dibuat</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data.map((b) => {
                  const usedPct = b.qty ? ((b.qty - b.unused) / b.qty) * 100 : 0;
                  return (
                    <tr key={b.id}>
                      <td>
                        <p className="font-mono text-xs font-bold">{b.code}</p>
                        <p className="text-[11px] text-subtle">{b.note || b.router_name}</p>
                      </td>
                      <td>
                        <Badge tone="violet">{b.profile}</Badge>
                        <p className="mt-0.5 text-[11px] text-subtle">{durationLabel(b.validity)}</p>
                      </td>
                      <td className="font-semibold">{b.qty}</td>
                      <td className="min-w-40">
                        <div className="mb-1 flex gap-2 text-[11px]">
                          <span className="text-cyan-500">{b.unused} sisa</span>
                          <span className="text-emerald-500">{b.active} online</span>
                          <span className="text-violet-500">{b.used} terpakai</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div className="bg-gradient-brand h-full" style={{ width: `${usedPct}%` }} />
                        </div>
                      </td>
                      <td className="tabular-nums">
                        {formatMoney(b.price)}
                        {b.cost > 0 && <p className="text-[11px] text-subtle">modal {formatMoney(b.cost)}</p>}
                      </td>
                      <td className="text-xs">{b.reseller_name ?? <span className="text-subtle">langsung</span>}</td>
                      <td className="text-xs">
                        <p>{formatDate(b.created_at)}</p>
                        <p className="text-subtle">oleh {b.created_by}</p>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <IconButton title="Cetak semua" onClick={() => window.open(`/print?batchId=${b.id}`, '_blank')}>
                          <Printer className="size-4" />
                        </IconButton>
                        <IconButton title="Cetak yang belum dipakai" onClick={() => window.open(`/print?batchId=${b.id}&onlyUnused=1`, '_blank')}>
                          <Printer className="size-4 text-cyan-500" />
                        </IconButton>
                        <Link to={`/vouchers?batchId=${b.id}`}>
                          <IconButton title="Lihat voucher">
                            <List className="size-4" />
                          </IconButton>
                        </Link>
                        <IconButton title="Ekspor CSV" onClick={() => run(() => download('/api/reports/vouchers.csv', { batchId: b.id }, `voucher-${b.code}.csv`).then(() => true))}>
                          <FileDown className="size-4" />
                        </IconButton>
                        {can('voucher.write') && !isReseller && (
                          <IconButton title="Hapus batch" tone="danger" onClick={() => setDeleting(b)}>
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
      </Card>
      {deleting && (
        <Modal
          open
          size="sm"
          onClose={() => setDeleting(null)}
          title={`Hapus batch ${deleting.code}?`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Batal
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={async () => {
                  const r = await run(() => del(`/api/vouchers/batches/${deleting.id}`, { refund: refund ? 1 : undefined }), 'Batch dihapus');
                  if (r) {
                    setDeleting(null);
                    void qc.invalidateQueries({ queryKey: ['batches'] });
                    void qc.invalidateQueries({ queryKey: ['vouchers'] });
                    void qc.invalidateQueries({ queryKey: ['resellers'] });
                  }
                }}
              >
                Hapus {deleting.qty} voucher
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">Semua voucher di batch ini akan dihapus dari router (sesi aktif diputus) dan dari database.</p>
          {deleting.reseller_id && deleting.unused > 0 && (
            <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
              <Toggle checked={refund} onChange={setRefund} label={`Kembalikan saldo ${deleting.unused} voucher belum terpakai ke ${deleting.reseller_name}`} />
              <p className="mt-1 pl-12 text-xs text-muted">≈ {formatMoney((deleting.cost / deleting.qty) * deleting.unused)}</p>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
