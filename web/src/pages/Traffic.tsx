import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Gauge } from 'lucide-react';
import clsx from 'clsx';
import { res } from '../lib/api';
import { useLiveTraffic } from '../lib/realtime';
import { formatBps } from '../lib/format';
import { Card, CardHeader, EmptyState, Loading, PageHeader } from '../components/ui';
import { TrafficChart } from '../components/charts';
import { RequireRouter } from '../components/RequireRouter';

function TrafficBody({ routerId }: { routerId: number }) {
  const { data: ifaces, isLoading } = useQuery({ queryKey: ['res', routerId, '/interface'], queryFn: () => res.list(routerId, '/interface'), refetchInterval: 60000 });
  const storageKey = `mikrotal.traffic.${routerId}`;
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    } catch {
      return [];
    }
  });
  const running = useMemo(() => (ifaces ?? []).filter((i) => i.disabled !== 'true'), [ifaces]);

  useEffect(() => {
    if (!selected.length && running.length) setSelected(running.filter((i) => i.running === 'true').slice(0, 4).map((i) => i.name));
  }, [running, selected.length]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(selected));
    } catch {
      /* abaikan */
    }
  }, [selected, storageKey]);

  const live = useLiveTraffic(routerId, selected, 150);

  if (isLoading) return <Loading />;

  const toggle = (name: string) => setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : s.length >= 12 ? s : [...s, name]));

  return (
    <div className="space-y-5">
      <PageHeader title="Trafik Live" subtitle="Pantau bandwidth tiap interface secara realtime (interval 2 detik, maks. 12 interface)" icon={<Gauge className="size-5" />} />
      <Card className="p-4">
        <p className="mb-2 text-xs font-medium text-muted">Pilih interface</p>
        <div className="flex flex-wrap gap-2">
          {running.map((i) => (
            <button
              key={i.name}
              onClick={() => toggle(i.name)}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-xs transition',
                selected.includes(i.name) ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted hover:border-brand/40',
              )}
            >
              <span className={clsx('size-1.5 rounded-full', i.running === 'true' ? 'bg-emerald-500' : 'bg-rose-500')} />
              {i.name}
            </button>
          ))}
        </div>
      </Card>
      {!selected.length ? (
        <Card>
          <EmptyState title="Pilih minimal satu interface" />
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {selected.map((name) => {
            const s = live[name] ?? [];
            const last = s[s.length - 1];
            const peakRx = Math.max(0, ...s.map((p) => p.rx));
            const peakTx = Math.max(0, ...s.map((p) => p.tx));
            const avgRx = s.length ? s.reduce((a, p) => a + p.rx, 0) / s.length : 0;
            return (
              <Card key={name}>
                <CardHeader
                  title={<span className="font-mono">{name}</span>}
                  subtitle={`Puncak ↓${formatBps(peakRx)} ↑${formatBps(peakTx)} • rata-rata ↓${formatBps(avgRx)}`}
                  actions={
                    <div className="flex gap-3 text-sm font-semibold tabular-nums">
                      <span className="flex items-center gap-1 text-cyan-500">
                        <ArrowDown className="size-4" />
                        {formatBps(last?.rx)}
                      </span>
                      <span className="flex items-center gap-1 text-violet-500">
                        <ArrowUp className="size-4" />
                        {formatBps(last?.tx)}
                      </span>
                    </div>
                  }
                />
                <div className="p-4">{s.length < 2 ? <div className="flex h-[220px] items-center justify-center text-sm text-muted">Menunggu data...</div> : <TrafficChart data={s} showLegend={false} />}</div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Traffic() {
  return <RequireRouter>{(id) => <TrafficBody key={id} routerId={id} />}</RequireRouter>;
}
