import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ScrollText } from 'lucide-react';
import clsx from 'clsx';
import { get } from '../lib/api';
import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader, SearchInput, Tabs, Toggle } from '../components/ui';
import { RequireRouter } from '../components/RequireRouter';

const TOPICS = [
  { value: '', label: 'Semua' },
  { value: 'hotspot', label: 'Hotspot' },
  { value: 'system', label: 'Sistem' },
  { value: 'interface', label: 'Interface' },
  { value: 'dhcp', label: 'DHCP' },
  { value: 'pppoe', label: 'PPP' },
  { value: 'firewall', label: 'Firewall' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
];

function topicColor(t: string) {
  if (/error|critical/.test(t)) return 'text-rose-500';
  if (/warning/.test(t)) return 'text-amber-500';
  if (/hotspot/.test(t)) return 'text-cyan-500';
  if (/system|account/.test(t)) return 'text-violet-500';
  if (/interface/.test(t)) return 'text-emerald-500';
  return 'text-brand';
}

function LogsBody({ routerId }: { routerId: number }) {
  const [topic, setTopic] = useState('');
  const [q, setQ] = useState('');
  const [auto, setAuto] = useState(true);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['logs', routerId, topic],
    queryFn: () => get<Record<string, string>[]>(`/api/routers/${routerId}/logs`, { topic, limit: 500 }),
    refetchInterval: auto ? 5000 : false,
  });
  const rows = useMemo(() => {
    if (!q) return data ?? [];
    const s = q.toLowerCase();
    return (data ?? []).filter((r) => (r.message ?? '').toLowerCase().includes(s) || (r.topics ?? '').includes(s));
  }, [data, q]);

  return (
    <div>
      <PageHeader
        title="Log Router"
        subtitle="Catatan aktivitas router (login hotspot, sistem, interface, firewall)"
        icon={<ScrollText className="size-5" />}
        actions={
          <>
            <Toggle checked={auto} onChange={setAuto} label="Auto refresh" />
            <Button variant="secondary" icon={<RefreshCw className={clsx('size-4', isFetching && 'animate-spin')} />} onClick={() => refetch()}>
              Muat ulang
            </Button>
          </>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <Tabs value={topic} onChange={setTopic} items={TOPICS} />
          <SearchInput value={q} onChange={setQ} placeholder="Cari pesan log..." />
        </div>
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={() => refetch()} />
        ) : !rows.length ? (
          <EmptyState title="Tidak ada log" />
        ) : (
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto font-mono text-xs">
            {rows.map((l, i) => (
              <div key={l['.id'] ?? i} className="flex gap-4 border-b border-line px-4 py-2 hover:bg-surface-2">
                <span className="w-16 shrink-0 text-subtle">{l.time}</span>
                <span className={clsx('hidden w-48 shrink-0 truncate sm:block', topicColor(l.topics ?? ''))}>{l.topics}</span>
                <span className="min-w-0 break-words">{l.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function Logs() {
  return <RequireRouter>{(id) => <LogsBody key={id} routerId={id} />}</RequireRouter>;
}
