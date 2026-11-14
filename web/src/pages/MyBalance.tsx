import { useQuery } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { get } from '../lib/api';
import { formatMoney } from '../lib/format';
import { Card, CardHeader, EmptyState, Loading, PageHeader, StatCard } from '../components/ui';
import { TransactionsTable, type Reseller } from './Resellers';

export default function MyBalance() {
  const { data, isLoading } = useQuery({ queryKey: ['resellers'], queryFn: () => get<Reseller[]>('/api/resellers') });
  if (isLoading) return <Loading />;
  const r = data?.[0];
  if (!r) return <Card><EmptyState title="Akun belum terhubung ke reseller" description="Hubungi admin untuk menghubungkan akun Anda." /></Card>;
  return (
    <div className="space-y-5">
      <PageHeader title="Saldo & Transaksi" subtitle={r.name} icon={<Wallet className="size-5" />} />
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Saldo tersedia" value={formatMoney(r.balance)} icon={<Wallet className="size-5" />} tone="green" />
        <StatCard label="Diskon Anda" value={`${r.discount}%`} icon={<Wallet className="size-5" />} tone="violet" sub="Dari harga jual voucher" />
      </div>
      <Card className="overflow-hidden">
        <CardHeader title="Riwayat transaksi" />
        <TransactionsTable resellerId={r.id} />
      </Card>
    </div>
  );
}
