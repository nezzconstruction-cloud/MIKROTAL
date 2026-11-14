import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, UserX, Users, Wifi } from 'lucide-react';
import clsx from 'clsx';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatBytes, formatMoney, humanDuration, parseDuration, timeLeft } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, IconButton, Loading, PageHeader, SearchInput, StatCard, Toggle, useAction, useFeedback } from '../components/ui';
import { RequireRouter } from '../components/RequireRouter';

interface ActiveRow {
  '.id': string;
  user: string;
  address: string;
  'mac-address': string;
  uptime: string;
  'session-time-left'?: string;
  'bytes-in': string;
  'bytes-out': string;
  'login-by': string;
  server: string;
  voucher: { profile: string; price: number; expires_at: string | null; validity: string } | null;
}

function ActiveBody({ routerId }: { routerId: number }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run } = useAction();
  const [q, setQ] = useState('');
  const [auto, setAuto] = useState(true);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['hs-active', routerId],
    queryFn: () => get<ActiveRow[]>(`/api/routers/${routerId}/hotspot/active`),
    refetchInterval: auto ? 5000 : false,
  });

  const rows = useMemo(() => {
    const list = data ?? [];
    if (!q) return list;
    const s = q.toLowerCase();
    return list.filter((r) => [r.user, r.address, r['mac-address']].some((v) => (v ?? '').toLowerCase().includes(s)));
  }, [data, q]);

  const totalDown = (data ?? []).reduce((s, r) => s + Number(r['bytes-out'] ?? 0), 0);
  const totalUp = (data ?? []).reduce((s, r) => s + Number(r['bytes-in'] ?? 0), 0);
  const vouchers = (data ?? []).filter((r) => r.voucher).length;

  const kick = async (r: ActiveRow) => {
    if (!(await confirm({ title: 'Putuskan pengguna?', message: <>Sesi <b>{r.user}</b> ({r.address}) akan diputus. Pengguna bisa login lagi selama akun masih berlaku.</>, confirmText: 'Putuskan', danger: true }))) return;
    await run(() => post(`/api/routers/${routerId}/hotspot/active/${encodeURIComponent(r['.id'])}/kick`), `${r.user} diputus`);
    void qc.invalidateQueries({ queryKey: ['hs-active', routerId] });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sesi Hotspot Aktif"
        subtitle="Pengguna yang sedang terhubung, diperbarui otomatis tiap 5 detik"
        icon={<Wifi className="size-5" />}
        actions={
          <>
            <Toggle checked={auto} onChange={setAuto} label="Live" />
            <Button variant="secondary" icon={<RefreshCw className={clsx('size-4', isFetching && 'animate-spin')} />} onClick={() => refetch()}>
              Muat ulang
            </Button>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Sedang online" value={data?.length ?? 0} icon={<Users className="size-5" />} tone="cyan" sub={`${vouchers} voucher • ${(data?.length ?? 0) - vouchers} member`} />
        <StatCard label="Total download sesi" value={formatBytes(totalDown)} icon={<Wifi className="size-5" />} tone="violet" />
        <StatCard label="Total upload sesi" value={formatBytes(totalUp)} icon={<Wifi className="size-5" />} tone="green" />
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <SearchInput value={q} onChange={setQ} placeholder="Cari user, IP, MAC..." />
          <span className="text-xs text-muted">{rows.length} sesi</span>
        </div>
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={() => refetch()} />
        ) : !rows.length ? (
          <EmptyState icon={<Users className="size-6" />} title="Tidak ada pengguna online" description="Pengguna yang login ke hotspot akan muncul di sini secara otomatis." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Pengguna</th>
                  <th>IP / MAC</th>
                  <th>Uptime</th>
                  <th>Sisa</th>
                  <th>Download</th>
                  <th>Upload</th>
                  <th>Paket</th>
                  {can('hotspot.write') && <th className="text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r['.id']}>
                    <td>
                      <p className="font-mono text-xs font-semibold">{r.user}</p>
                      <p className="text-[11px] text-subtle">
                        {r.server} • {r['login-by']}
                      </p>
                    </td>
                    <td>
                      <p className="font-mono text-xs">{r.address}</p>
                      <p className="font-mono text-[11px] text-subtle">{r['mac-address']}</p>
                    </td>
                    <td className="tabular-nums">{humanDuration(parseDuration(r.uptime), 2)}</td>
                    <td className="text-xs">
                      {r.voucher?.expires_at ? <Badge tone="yellow">{timeLeft(r.voucher.expires_at)}</Badge> : r['session-time-left'] ? <Badge tone="blue">{humanDuration(parseDuration(r['session-time-left']), 2)}</Badge> : <span className="text-subtle">—</span>}
                    </td>
                    <td className="tabular-nums text-cyan-600 dark:text-cyan-400">{formatBytes(r['bytes-out'])}</td>
                    <td className="tabular-nums text-violet-600 dark:text-violet-400">{formatBytes(r['bytes-in'])}</td>
                    <td>
                      {r.voucher ? (
                        <div>
                          <Badge tone="violet">{r.voucher.profile}</Badge>
                          <p className="mt-0.5 text-[11px] text-subtle">{formatMoney(r.voucher.price)}</p>
                        </div>
                      ) : (
                        <Badge>member</Badge>
                      )}
                    </td>
                    {can('hotspot.write') && (
                      <td className="text-right">
                        <IconButton title="Putuskan" tone="danger" onClick={() => kick(r)}>
                          <UserX className="size-4" />
                        </IconButton>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function HotspotActive() {
  return <RequireRouter>{(id) => <ActiveBody key={id} routerId={id} />}</RequireRouter>;
}
