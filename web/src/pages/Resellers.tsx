import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookUser, History, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, Select, StatCard, Textarea, Toggle, useAction, useFeedback } from '../components/ui';

export interface Reseller {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  balance: number;
  discount: number;
  active: number;
  note: string;
  created_at: string;
  vouchers_total?: number;
  vouchers_unused?: number;
  total_purchase?: number;
}

const TX_LABEL: Record<string, { label: string; tone: 'green' | 'red' | 'blue' | 'yellow' }> = {
  topup: { label: 'Top up', tone: 'green' },
  purchase: { label: 'Beli voucher', tone: 'red' },
  refund: { label: 'Refund', tone: 'blue' },
  adjust: { label: 'Koreksi', tone: 'yellow' },
};

export function TransactionsTable({ resellerId }: { resellerId: number }) {
  const { data, isLoading } = useQuery({ queryKey: ['reseller-tx', resellerId], queryFn: () => get<any[]>(`/api/resellers/${resellerId}/transactions`) });
  if (isLoading) return <Loading />;
  if (!data?.length) return <EmptyState title="Belum ada transaksi" />;
  return (
    <div className="max-h-[60vh] overflow-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>Waktu</th>
            <th>Jenis</th>
            <th>Keterangan</th>
            <th className="text-right">Nominal</th>
            <th className="text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {data.map((t) => (
            <tr key={t.id}>
              <td className="text-xs">{formatDate(t.created_at)}</td>
              <td>
                <Badge tone={TX_LABEL[t.type]?.tone ?? 'gray'}>{TX_LABEL[t.type]?.label ?? t.type}</Badge>
              </td>
              <td className="text-xs">
                {t.note}
                {t.ref && <span className="ml-1 font-mono text-subtle">{t.ref}</span>}
                <p className="text-subtle">oleh {t.created_by}</p>
              </td>
              <td className={`text-right font-semibold tabular-nums ${t.amount >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {t.amount >= 0 ? '+' : ''}
                {formatMoney(t.amount)}
              </td>
              <td className="text-right tabular-nums">{formatMoney(t.balance_after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResellerForm({ initial, onClose }: { initial: Reseller | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { run, busy } = useAction();
  const [f, setF] = useState({ name: initial?.name ?? '', phone: initial?.phone ?? '', email: initial?.email ?? '', address: initial?.address ?? '', discount: initial?.discount ?? 10, active: initial ? !!initial.active : true, note: initial?.note ?? '' });
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const body = { ...f, discount: Number(f.discount) };
    if (initial) await patch(`/api/resellers/${initial.id}`, body);
    else await post('/api/resellers', body);
    await qc.invalidateQueries({ queryKey: ['resellers'] });
    return true;
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? `Ubah reseller ${initial.name}` : 'Reseller baru'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={async () => (await run(save, 'Reseller disimpan')) && onClose()}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nama reseller / toko" required className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="No. HP / WA">
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Diskon (%)" hint="Dipakai jika profil tidak punya harga reseller khusus">
          <Input type="number" min={0} max={100} value={f.discount} onChange={(e) => set('discount', e.target.value)} />
        </Field>
        <div className="pt-6">
          <Toggle checked={f.active} onChange={(v) => set('active', v)} label="Aktif" />
        </div>
        <Field label="Alamat" className="sm:col-span-2">
          <Input value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Catatan" className="sm:col-span-2">
          <Textarea rows={2} className="font-sans text-sm" value={f.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
      </div>
      {!initial && <p className="mt-4 text-xs text-muted">Setelah dibuat, buat akun login untuk reseller di menu Pengguna Aplikasi (peran Reseller) agar mereka bisa membuat voucher sendiri dari saldonya.</p>}
    </Modal>
  );
}

function BalanceModal({ reseller, onClose }: { reseller: Reseller; onClose: () => void }) {
  const qc = useQueryClient();
  const { run, busy } = useAction();
  const [type, setType] = useState<'topup' | 'adjust'>('topup');
  const [amount, setAmount] = useState<number | ''>('');
  const [note, setNote] = useState('');
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`Saldo ${reseller.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button
            loading={busy}
            disabled={!amount}
            onClick={async () => {
              const r = await run(() => post(`/api/resellers/${reseller.id}/balance`, { type, amount: Number(amount), note }), type === 'topup' ? 'Top up berhasil' : 'Saldo dikoreksi');
              if (r) {
                void qc.invalidateQueries({ queryKey: ['resellers'] });
                void qc.invalidateQueries({ queryKey: ['reseller-tx', reseller.id] });
                onClose();
              }
            }}
          >
            Simpan
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm">
        Saldo saat ini: <b>{formatMoney(reseller.balance)}</b>
      </p>
      <div className="space-y-4">
        <Field label="Jenis">
          <Select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="topup">Top up (tambah saldo)</option>
            <option value="adjust">Koreksi (boleh minus)</option>
          </Select>
        </Field>
        <Field label="Nominal">
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} placeholder="100000" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {[50000, 100000, 250000, 500000, 1000000].map((n) => (
            <button key={n} className="rounded-lg border border-line px-2.5 py-1 text-xs hover:border-brand" onClick={() => setAmount(n)}>
              {formatMoney(n)}
            </button>
          ))}
        </div>
        <Field label="Keterangan">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Transfer BCA / tunai" />
        </Field>
      </div>
    </Modal>
  );
}

export default function Resellers() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run } = useAction();
  const [editing, setEditing] = useState<Reseller | null | undefined>(undefined);
  const [balance, setBalance] = useState<Reseller | null>(null);
  const [history, setHistory] = useState<Reseller | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['resellers'], queryFn: () => get<Reseller[]>('/api/resellers') });
  const writable = can('reseller.write');

  const totalBalance = (data ?? []).reduce((s, r) => s + r.balance, 0);
  const totalPurchase = (data ?? []).reduce((s, r) => s + (r.total_purchase ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reseller"
        subtitle="Kelola mitra penjual voucher dengan sistem saldo (deposit)"
        icon={<BookUser className="size-5" />}
        actions={
          writable && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
              Reseller baru
            </Button>
          )
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Jumlah reseller" value={formatNumber(data?.length ?? 0)} icon={<BookUser className="size-5" />} tone="cyan" sub={`${(data ?? []).filter((r) => r.active).length} aktif`} />
        <StatCard label="Total saldo mengendap" value={formatMoney(totalBalance)} icon={<Wallet className="size-5" />} tone="green" />
        <StatCard label="Total pembelian voucher" value={formatMoney(totalPurchase)} icon={<History className="size-5" />} tone="violet" />
      </div>
      <Card className="overflow-hidden">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={() => refetch()} />
        ) : !data?.length ? (
          <EmptyState icon={<BookUser className="size-6" />} title="Belum ada reseller" description="Tambahkan reseller (warung, konter pulsa, dll) untuk menjual voucher dengan sistem saldo." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Reseller</th>
                  <th>Kontak</th>
                  <th>Diskon</th>
                  <th>Voucher</th>
                  <th>Total beli</th>
                  <th className="text-right">Saldo</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className={!r.active ? 'row-disabled' : ''}>
                    <td>
                      <p className="font-semibold">{r.name}</p>
                      {!r.active && <Badge>nonaktif</Badge>}
                      {r.address && <p className="text-[11px] text-subtle">{r.address}</p>}
                    </td>
                    <td className="text-xs">
                      <p>{r.phone || '—'}</p>
                      <p className="text-subtle">{r.email}</p>
                    </td>
                    <td>{r.discount}%</td>
                    <td className="text-xs">
                      {formatNumber(r.vouchers_total ?? 0)} <span className="text-subtle">({r.vouchers_unused ?? 0} belum terpakai)</span>
                    </td>
                    <td className="tabular-nums">{formatMoney(r.total_purchase ?? 0)}</td>
                    <td className="text-right text-base font-bold tabular-nums">{formatMoney(r.balance)}</td>
                    <td className="whitespace-nowrap text-right">
                      {writable && (
                        <Button size="sm" variant="secondary" icon={<Wallet className="size-3.5" />} onClick={() => setBalance(r)}>
                          Top up
                        </Button>
                      )}
                      <IconButton title="Riwayat transaksi" onClick={() => setHistory(r)}>
                        <History className="size-4" />
                      </IconButton>
                      {writable && (
                        <>
                          <IconButton title="Ubah" onClick={() => setEditing(r)}>
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton
                            title="Hapus"
                            tone="danger"
                            onClick={async () => {
                              if (!(await confirm({ title: `Hapus ${r.name}?`, message: 'Riwayat transaksi reseller ikut terhapus. Voucher yang sudah dibuat tetap ada.', danger: true, confirmText: 'Hapus' }))) return;
                              await run(() => del(`/api/resellers/${r.id}`), 'Reseller dihapus');
                              void qc.invalidateQueries({ queryKey: ['resellers'] });
                            }}
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing !== undefined && <ResellerForm initial={editing} onClose={() => setEditing(undefined)} />}
      {balance && <BalanceModal reseller={balance} onClose={() => setBalance(null)} />}
      {history && (
        <Modal open size="lg" onClose={() => setHistory(null)} title={`Riwayat transaksi ${history.name}`}>
          <TransactionsTable resellerId={history.id} />
        </Modal>
      )}
    </div>
  );
}
