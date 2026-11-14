import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileClock } from 'lucide-react';
import { get } from '../lib/api';
import { formatDate } from '../lib/format';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader, SearchInput } from '../components/ui';

export default function Audit() {
  const [q, setQ] = useState('');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['audit', q], queryFn: () => get<any[]>('/api/audit', { q, limit: 500 }) });
  const tone = (a: string) => (/delete|remove|reboot|failed/.test(a) ? 'red' : /create|add|generate|topup/.test(a) ? 'green' : /login/.test(a) ? 'blue' : 'violet');
  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Jejak semua tindakan pengguna di MIKROTAL" icon={<FileClock className="size-5" />} />
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <SearchInput value={q} onChange={setQ} placeholder="Cari pengguna / aksi..." />
        </div>
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={() => refetch()} />
        ) : !data?.length ? (
          <EmptyState title="Belum ada catatan" />
        ) : (
          <div className="max-h-[calc(100vh-240px)] overflow-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Pengguna</th>
                  <th>Aksi</th>
                  <th>Target</th>
                  <th>Detail</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-xs">{formatDate(a.created_at)}</td>
                    <td className="font-medium">{a.username || '—'}</td>
                    <td>
                      <Badge tone={tone(a.action) as any}>{a.action}</Badge>
                    </td>
                    <td className="font-mono text-xs">{a.target}</td>
                    <td className="max-w-md truncate font-mono text-[11px] text-muted" title={a.detail}>
                      {a.detail}
                    </td>
                    <td className="font-mono text-xs text-subtle">{a.ip}</td>
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
