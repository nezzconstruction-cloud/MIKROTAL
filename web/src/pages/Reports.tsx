import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Banknote, FileDown, Package, ShoppingCart, Ticket, Wallet } from 'lucide-react';
import { download, get } from '../lib/api';
import { useRouters } from '../lib/router-context';
import { formatMoney, formatNumber, todayStr } from '../lib/format';
import { Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Select, StatCard, useAction } from '../components/ui';
import { RevenueChart } from '../components/charts';

interface Report {
  from: string;
  to: string;
  totals: { direct: number; reseller: number; pppoe: number; pppoeCount: number; total: number; activations: number; topups: number; directCount: number; resellerCount: number };
  daily: { date: string; direct: number; reseller: number; pppoe: number; count: number }[];
  byProfile: { profile: string; count: number; amount: number }[];
  byRouter: { router: string; count: number; amount: number }[];
  byReseller: { reseller: string; count: number; amount: number }[];
  stock: { profile: string; count: number; value: number }[];
}

const PRESETS = [
  { label: 'Hari ini', from: () => todayStr(), to: () => todayStr() },
  { label: '7 hari', from: () => todayStr(-6), to: () => todayStr() },
  { label: '30 hari', from: () => todayStr(-29), to: () => todayStr() },
  {
    label: 'Bulan ini',
    from: () => todayStr().slice(0, 8) + '01',
    to: () => todayStr(),
  },
  {
    label: 'Bulan lalu',
    from: () => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    },
    to: () => {
      const d = new Date();
      d.setDate(0);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
  },
];

function Breakdown({ title, rows, labelKey, icon }: { title: string; rows: { count: number; amount: number; [k: string]: any }[]; labelKey: string; icon: React.ReactNode }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <Card>
      <CardHeader title={title} icon={icon} />
      {!rows.length ? (
        <p className="px-5 py-8 text-center text-sm text-muted">Belum ada data</p>
      ) : (
        <div className="space-y-3 p-5">
          {rows.map((r) => (
            <div key={r[labelKey]}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium">{r[labelKey]}</span>
                <span className="text-xs text-muted">
                  {formatNumber(r.count)}× • <b className="text-fg">{formatMoney(r.amount)}</b>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="bg-gradient-brand h-full rounded-full" style={{ width: `${(r.amount / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Reports() {
  const { routers } = useRouters();
  const [from, setFrom] = useState(todayStr(-29));
  const [to, setTo] = useState(todayStr());
  const [routerId, setRouterId] = useState('');
  const { run } = useAction();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report', from, to, routerId], queryFn: () => get<Report>('/api/reports/sales', { from, to, routerId }) });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Laporan Penjualan"
        subtitle="PPPoE (saat voucher diisikan atau perpanjangan manual), hotspot langsung (saat dipakai), dan reseller (saat pembelian)"
        icon={<BarChart3 className="size-5" />}
        actions={
          <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => run(() => download('/api/reports/sales.csv', { from, to, routerId }, `penjualan-${from}-${to}.csv`).then(() => true))}>
            Ekspor CSV
          </Button>
        }
      />
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Dari">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Sampai">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Router">
          <Select value={routerId} onChange={(e) => setRouterId(e.target.value)}>
            <option value="">Semua router</option>
            {routers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant="ghost"
              onClick={() => {
                setFrom(p.from());
                setTo(p.to());
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </Card>
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total pendapatan" value={formatMoney(data.totals.total)} icon={<Banknote className="size-5" />} tone="green" />
            <StatCard label="PPPoE langsung" value={formatMoney(data.totals.pppoe)} icon={<Ticket className="size-5" />} tone="green" sub={`${formatNumber(data.totals.pppoeCount)} isi ulang • hotspot ${formatMoney(data.totals.direct)} (${formatNumber(data.totals.directCount)})`} />
            <StatCard label="Penjualan reseller" value={formatMoney(data.totals.reseller)} icon={<ShoppingCart className="size-5" />} tone="violet" sub={`${formatNumber(data.totals.resellerCount)} voucher dibeli`} />
            <StatCard label="Top up saldo reseller" value={formatMoney(data.totals.topups)} icon={<Wallet className="size-5" />} tone="orange" sub={`${formatNumber(data.totals.activations)} aktivasi total`} />
          </div>
          <Card>
            <CardHeader title="Grafik harian" icon={<BarChart3 className="size-4" />} subtitle={`${data.from} s/d ${data.to}`} />
            <div className="p-4">{data.daily.length ? <RevenueChart data={data.daily} height={300} /> : <EmptyState title="Tidak ada data" />}</div>
          </Card>
          <div className="grid gap-5 lg:grid-cols-3">
            <Breakdown title="Per profil" rows={data.byProfile} labelKey="profile" icon={<Package className="size-4" />} />
            <Breakdown title="Per reseller" rows={data.byReseller} labelKey="reseller" icon={<ShoppingCart className="size-4" />} />
            <Breakdown title="Per router" rows={data.byRouter} labelKey="router" icon={<BarChart3 className="size-4" />} />
          </div>
          <Card className="overflow-hidden">
            <CardHeader title="Stok voucher belum terpakai" icon={<Ticket className="size-4" />} subtitle="Potensi pendapatan dari voucher yang sudah dicetak" />
            {!data.stock.length ? (
              <p className="px-5 py-8 text-center text-sm text-muted">Tidak ada stok</p>
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Profil</th>
                    <th className="text-right">Jumlah</th>
                    <th className="text-right">Nilai</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stock.map((s) => (
                    <tr key={s.profile}>
                      <td className="font-mono font-semibold">{s.profile}</td>
                      <td className="text-right">{formatNumber(s.count)}</td>
                      <td className="text-right font-semibold">{formatMoney(s.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Rincian harian" />
            <div className="max-h-96 overflow-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th className="text-right">Transaksi</th>
                    <th className="text-right">PPPoE</th>
                    <th className="text-right">Hotspot</th>
                    <th className="text-right">Reseller</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.daily].reverse().map((d) => (
                    <tr key={d.date}>
                      <td>{new Date(`${d.date}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td className="text-right">{d.count}</td>
                      <td className="text-right tabular-nums">{formatMoney(d.pppoe)}</td>
                      <td className="text-right tabular-nums">{formatMoney(d.direct)}</td>
                      <td className="text-right tabular-nums">{formatMoney(d.reseller)}</td>
                      <td className="text-right font-semibold tabular-nums">{formatMoney(d.direct + d.reseller + d.pppoe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
