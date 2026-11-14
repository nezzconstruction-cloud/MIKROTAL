import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDown, ArrowUp, Clock, Cpu, Gauge as GaugeIcon, HardDrive, History, Network, RefreshCw, ScrollText, Thermometer, Users, Zap } from 'lucide-react';
import clsx from 'clsx';
import { get, post } from '../lib/api';
import { useLiveTraffic, useRealtime } from '../lib/realtime';
import { formatBps, formatBytes, humanDuration, pct } from '../lib/format';
import { Badge, Button, Card, CardHeader, ErrorBox, Gauge, KeyValue, Loading, PageHeader, StatCard, Tabs, useAction } from '../components/ui';
import { MetricsChart, Sparkline, TrafficChart } from '../components/charts';
import { RequireRouter } from '../components/RequireRouter';
import type { RouterInfo } from '../lib/router-context';

interface Overview {
  resource: Record<string, string>;
  identity: string;
  routerboard: Record<string, string>;
  health: Record<string, string>[];
  clock: Record<string, string>;
  interfaces: Record<string, string>[];
  logs: Record<string, string>[];
}

function MonitorBody({ routerId, router }: { routerId: number; router: RouterInfo }) {
  const { snapshots } = useRealtime();
  const snap = snapshots[routerId] ?? router.snapshot;
  const [range, setRange] = useState<'1h' | '6h' | '24h' | '7d' | '30d'>('6h');
  const { run, busy } = useAction();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['overview', routerId],
    queryFn: () => get<Overview>(`/api/routers/${routerId}/overview`),
    refetchInterval: 30000,
  });
  const metrics = useQuery({
    queryKey: ['metrics', routerId, range],
    queryFn: () => get<Record<string, number>[]>(`/api/routers/${routerId}/metrics`, { range }),
    refetchInterval: 60000,
  });

  const ifaceNames = useMemo(() => (data?.interfaces ?? []).filter((i) => i.disabled !== 'true' && i.running === 'true').map((i) => i.name).slice(0, 24), [data]);
  const wan = snap?.wan || router.wan_interface || ifaceNames[0];
  const live = useLiveTraffic(routerId, ifaceNames, 90);
  const wanSeries = wan ? live[wan] ?? [] : [];
  const wanLast = wanSeries[wanSeries.length - 1];

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} onRetry={() => refetch()} />;

  const res = data.resource;
  const memTotal = Number(res['total-memory'] ?? 0);
  const memUsed = memTotal - Number(res['free-memory'] ?? 0);
  const hddTotal = Number(res['total-hdd-space'] ?? 0);
  const hddUsed = hddTotal - Number(res['free-hdd-space'] ?? 0);
  const cpu = snap?.online ? snap.cpu ?? Number(res['cpu-load']) : Number(res['cpu-load'] ?? 0);
  const temp = data.health.find((h) => h.name === 'temperature' || h.name === 'cpu-temperature')?.value ?? data.health[0]?.temperature;
  const volt = data.health.find((h) => h.name === 'voltage')?.value ?? data.health[0]?.voltage;
  const metricRows = (metrics.data ?? []).map((m) => ({ ...m, mem_pct: m.mem_total ? (m.mem_used / m.mem_total) * 100 : 0 }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.identity || router.name}
        subtitle={`${res['board-name'] ?? ''} • RouterOS ${res.version ?? ''} • ${router.simulate ? 'simulasi' : `${router.host}:${router.port}`}`}
        icon={<Activity className="size-5" />}
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw className={clsx('size-4', busy && 'animate-spin')} />}
            onClick={() =>
              run(async () => {
                await post(`/api/routers/${routerId}/reconnect`);
                await refetch();
                return true;
              })
            }
          >
            Segarkan
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Uptime" value={humanDuration(snap?.uptimeSeconds ?? 0, 2)} icon={<Clock className="size-5" />} tone="blue" sub={data.clock.time ? `Jam router ${data.clock.time} ${data.clock.date ?? ''}` : undefined} />
        <StatCard label="Hotspot online" value={snap?.hotspotActive ?? 0} icon={<Users className="size-5" />} tone="cyan" sub={`PPP ${snap?.pppActive ?? 0} • DHCP ${snap?.dhcpLeases ?? 0} lease`} />
        <StatCard
          label={`WAN ${wan ?? ''}`}
          value={
            <span className="flex items-baseline gap-2 text-xl">
              <ArrowDown className="size-4 text-cyan-500" />
              {formatBps(wanLast?.rx ?? snap?.rx)}
            </span>
          }
          icon={<Zap className="size-5" />}
          tone="violet"
          sub={
            <span className="flex items-center gap-1">
              <ArrowUp className="size-3 text-violet-500" /> {formatBps(wanLast?.tx ?? snap?.tx)}
            </span>
          }
        />
        <StatCard label="Kesehatan" value={temp ? `${temp}°C` : '—'} icon={<Thermometer className="size-5" />} tone={Number(temp) > 70 ? 'rose' : 'green'} sub={volt ? `Tegangan ${volt} V` : 'Sensor tidak tersedia'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader title="Sumber daya" icon={<Cpu className="size-4" />} subtitle={`${res['cpu-count'] ?? '?'} core ${res.cpu ?? ''} @ ${res['cpu-frequency'] ?? '?'} MHz`} />
          <div className="grid grid-cols-3 gap-2 px-3 py-5">
            <Gauge value={cpu} label="CPU" sub={`${res['cpu-count'] ?? 1} core`} size={100} />
            <Gauge value={pct(memUsed, memTotal)} label="Memori" sub={`${formatBytes(memUsed)} / ${formatBytes(memTotal)}`} size={100} />
            <Gauge value={pct(hddUsed, hddTotal)} label="Storage" sub={`${formatBytes(hddUsed)} / ${formatBytes(hddTotal)}`} size={100} />
          </div>
          <div className="border-t border-line px-5 py-4">
            <KeyValue
              items={[
                ['Model', data.routerboard.model ?? res['board-name']],
                ['Serial', data.routerboard['serial-number'] ?? '—'],
                ['Firmware', data.routerboard['current-firmware'] ?? '—'],
                ['Arsitektur', res['architecture-name'] ?? '—'],
                ['Build', res['build-time'] ?? '—'],
              ]}
            />
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader
            title={`Trafik live ${wan ?? ''}`}
            subtitle="Diperbarui tiap 2 detik"
            icon={<GaugeIcon className="size-4" />}
            actions={
              <Link to="/traffic" className="text-xs font-medium text-brand hover:underline">
                Monitor semua interface
              </Link>
            }
          />
          <div className="p-4">{wanSeries.length < 2 ? <div className="flex h-[260px] items-center justify-center text-sm text-muted">Mengumpulkan data trafik...</div> : <TrafficChart data={wanSeries} height={260} />}</div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Interface" icon={<Network className="size-4" />} subtitle={`${data.interfaces.length} interface, ${ifaceNames.length} aktif`} actions={<Link to="/res/interfaces" className="text-xs font-medium text-brand hover:underline">Kelola</Link>} />
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Interface</th>
                <th>Tipe</th>
                <th>Status</th>
                <th>Download</th>
                <th>Upload</th>
                <th className="w-40">Tren</th>
                <th>Total RX / TX</th>
              </tr>
            </thead>
            <tbody>
              {data.interfaces.map((i) => {
                const s = live[i.name] ?? [];
                const last = s[s.length - 1];
                return (
                  <tr key={i['.id']} className={clsx(i.disabled === 'true' && 'row-disabled')}>
                    <td>
                      <p className="font-mono text-xs font-semibold">{i.name}</p>
                      {i.comment && <p className="text-[11px] text-subtle">{i.comment}</p>}
                    </td>
                    <td>
                      <Badge tone="violet">{i.type}</Badge>
                    </td>
                    <td>{i.disabled === 'true' ? <Badge>nonaktif</Badge> : i.running === 'true' ? <Badge tone="green" dot>up</Badge> : <Badge tone="red" dot>down</Badge>}</td>
                    <td className="tabular-nums text-cyan-600 dark:text-cyan-400">{last ? formatBps(last.rx) : '—'}</td>
                    <td className="tabular-nums text-violet-600 dark:text-violet-400">{last ? formatBps(last.tx) : '—'}</td>
                    <td>{s.length > 1 ? <Sparkline data={s as any} dataKey="rx" height={28} /> : <span className="text-subtle">—</span>}</td>
                    <td className="text-xs text-muted tabular-nums">
                      {formatBytes(i['rx-byte'])} / {formatBytes(i['tx-byte'])}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Riwayat"
          icon={<History className="size-4" />}
          subtitle="Data disimpan tiap menit"
          actions={
            <Tabs
              value={range}
              onChange={setRange}
              items={[
                { value: '1h', label: '1 jam' },
                { value: '6h', label: '6 jam' },
                { value: '24h', label: '24 jam' },
                { value: '7d', label: '7 hari' },
                { value: '30d', label: '30 hari' },
              ]}
            />
          }
        />
        {metricRows.length < 2 ? (
          <p className="px-5 py-12 text-center text-sm text-muted">Belum cukup data riwayat. Grafik akan muncul setelah beberapa menit pemantauan.</p>
        ) : (
          <div className="grid gap-4 p-4 lg:grid-cols-3">
            <div>
              <p className="mb-2 text-xs font-semibold text-muted">CPU & Memori (%)</p>
              <MetricsChart
                data={metricRows}
                height={200}
                format={(v) => `${Math.round(v)}%`}
                lines={[
                  { key: 'cpu', label: 'CPU', color: '#22d3ee' },
                  { key: 'mem_pct', label: 'Memori', color: '#a78bfa' },
                ]}
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-muted">Trafik WAN</p>
              <MetricsChart
                data={metricRows}
                height={200}
                format={(v) => formatBps(v, 0)}
                lines={[
                  { key: 'rx_bps', label: 'Download', color: '#22d3ee' },
                  { key: 'tx_bps', label: 'Upload', color: '#a78bfa' },
                ]}
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-muted">Pengguna online</p>
              <MetricsChart
                data={metricRows}
                height={200}
                format={(v) => String(Math.round(v))}
                lines={[
                  { key: 'hotspot_active', label: 'Hotspot', color: '#34d399' },
                  { key: 'ppp_active', label: 'PPP', color: '#fbbf24' },
                ]}
              />
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Log terbaru" icon={<ScrollText className="size-4" />} actions={<Link to="/logs" className="text-xs font-medium text-brand hover:underline">Semua log</Link>} />
        <div className="max-h-80 divide-y divide-line overflow-y-auto font-mono text-xs">
          {data.logs.map((l) => (
            <div key={l['.id']} className="flex gap-3 px-5 py-2">
              <span className="shrink-0 text-subtle">{l.time}</span>
              <span className="w-40 shrink-0 truncate text-brand">{l.topics}</span>
              <span className="min-w-0 break-words">{l.message}</span>
            </div>
          ))}
        </div>
      </Card>
      <div className="flex items-center gap-2 text-xs text-subtle">
        <HardDrive className="size-3.5" /> Data dari RouterOS API • {new Date().toLocaleTimeString('id-ID')}
      </div>
    </div>
  );
}

export default function Monitor() {
  return <RequireRouter>{(id, router) => <MonitorBody key={id} routerId={id} router={router} />}</RequireRouter>;
}
