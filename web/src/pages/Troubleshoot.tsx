import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, Info, MapPin, Phone, Radar, Scissors, Stethoscope, Undo2 } from 'lucide-react';
import clsx from 'clsx';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, timeAgo } from '../lib/format';
import { FINDING_KIND, formatDistance, hasCoord, mapsLink, type Diagnosis, type Finding, type Topology } from '../lib/pppoe';
import { buildFiberMap } from '../lib/fibermap';
import { RequireRouter } from '../components/RequireRouter';
import { FiberMap, MapLegend } from '../components/FiberMap';
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, Select, useAction, useFeedback } from '../components/ui';

const CONFIDENCE_TONE = { tinggi: 'red', sedang: 'yellow', rendah: 'gray' } as const;

function FindingCard({ f, index, logs, active, onFocus }: { f: Finding; index: number; logs: Record<number, string>; active: boolean; onFocus: () => void }) {
  const critical = f.severity === 'critical';
  const target = hasCoord(f.to) ? f.to : hasCoord(f.from) ? f.from : null;
  return (
    <Card className={clsx('overflow-hidden transition', active && 'ring-2 ring-brand/60')}>
      <div className={clsx('flex items-start gap-3 border-b border-line px-4 py-3', critical ? 'bg-rose-500/5' : 'bg-amber-500/5')}>
        <span className={clsx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white', critical ? 'bg-rose-500' : 'bg-amber-500')}>{index}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{f.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={critical ? 'red' : 'yellow'}>{FINDING_KIND[f.kind]}</Badge>
            <Badge tone="blue">
              {f.from.name} → {f.to.name}
              {f.distanceM != null && ` • ±${formatDistance(f.distanceM)}`}
            </Badge>
            <Badge tone={CONFIDENCE_TONE[f.confidence]}>keyakinan {f.confidence}</Badge>
            {f.affected.length > 0 && <Badge>{f.affected.length} pelanggan</Badge>}
          </div>
        </div>
      </div>
      <div className="space-y-3 p-4 text-sm">
        <p className="text-muted">{f.reason}</p>
        <div>
          <p className="mb-1 text-xs font-semibold">Langkah pengecekan</p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
            {f.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
        {f.affected.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold">Pelanggan terdampak</p>
            <div className="divide-y divide-line rounded-lg border border-line">
              {f.affected.map((a) => (
                <div key={a.id} className="px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                    <Link to={`/customers?id=${a.id}`} className="font-semibold hover:underline">
                      {a.name} <span className="font-mono font-normal text-subtle">{a.username}</span>
                    </Link>
                    <span className="text-subtle">
                      {a.odp}
                      {a.port ? ` port ${a.port}` : ''} • offline {a.last_seen_at ? timeAgo(a.last_seen_at) : '—'}
                    </span>
                  </div>
                  {a.phone && (
                    <a href={`tel:${a.phone}`} className="mt-0.5 inline-flex items-center gap-1 text-brand hover:underline">
                      <Phone className="size-3" /> {a.phone}
                    </a>
                  )}
                  {(a.lastLog ?? logs[a.id]) && <p className="mt-1 break-all rounded bg-surface-2 px-2 py-1 font-mono text-[10px] text-muted">log router: {a.lastLog ?? logs[a.id]}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<MapPin className="size-3.5" />} disabled={!hasCoord(f.from) && !hasCoord(f.to)} onClick={onFocus}>
            Lihat segmen di peta
          </Button>
          {target && (
            <a href={mapsLink(target.lat, target.lng)} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary" icon={<ExternalLink className="size-3.5" />}>
                Arahkan ke {target.name}
              </Button>
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

function Simulator({ routerId, topo, onResult }: { routerId: number; topo: Topology; onResult: (d: Diagnosis) => void }) {
  const { run, busy } = useAction();
  const [target, setTarget] = useState('');
  const options = useMemo(() => {
    const odps = [...topo.odcs.flatMap((d) => d.odps), ...topo.looseOdps];
    return [
      ...topo.odcs.filter((d) => d.customers > 0).map((d) => ({ value: `odc:${d.id}`, label: `Feeder ke ${d.name} (${d.customers} pelanggan)` })),
      ...odps.filter((o) => o.used > 0).map((o) => ({ value: `odp:${o.id}`, label: `Distribusi ke ${o.name} (${o.used} pelanggan)` })),
      ...odps.flatMap((o) => o.customers.map((c) => ({ value: `customer:${c.id}`, label: `Drop ${c.name} (${o.name})` }))),
    ];
  }, [topo]);
  const send = async (body: Record<string, unknown>, ok: string) => {
    const r = await run(() => post<Diagnosis>('/api/troubleshoot/simulate', { routerId, ...body }), ok);
    if (r) onResult(r);
  };
  return (
    <Card className="flex flex-wrap items-center gap-3 border-dashed p-3">
      <div className="mr-auto min-w-0">
        <p className="text-xs font-semibold">Simulasi gangguan (router simulasi)</p>
        <p className="text-[11px] text-subtle">Putuskan satu jalur untuk mencoba hasil scan tanpa gangguan sungguhan.</p>
      </div>
      <Select className="h-9 w-72 max-w-full py-0 text-xs" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">— pilih jalur yang diputus —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="danger" disabled={!target || busy} icon={<Scissors className="size-3.5" />} onClick={() => send({ target: target.split(':')[0], id: Number(target.split(':')[1]) }, 'Jalur diputus (simulasi)')}>
        Putuskan
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} icon={<Undo2 className="size-3.5" />} onClick={() => send({ target: 'clear' }, 'Semua jalur dipulihkan')}>
        Pulihkan semua
      </Button>
    </Card>
  );
}

function Inner({ routerId, simulate }: { routerId: number; simulate: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const scan = useAction();
  const [logs, setLogs] = useState<Record<number, string>>({});
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [showCustomers, setShowCustomers] = useState(true);

  const topo = useQuery({ queryKey: ['topology', routerId], queryFn: () => get<Topology>('/api/topology', { routerId }), refetchInterval: 30000 });
  const diag = useQuery({ queryKey: ['troubleshoot', routerId], queryFn: () => get<Diagnosis>('/api/troubleshoot', { routerId }), refetchInterval: 30000 });

  const apply = (d: Diagnosis) => {
    qc.setQueryData(['troubleshoot', routerId], d);
    setLogs(Object.fromEntries(d.findings.flatMap((f) => f.affected.filter((a) => a.lastLog).map((a) => [a.id, a.lastLog!]))));
    setLastScan(d.scannedAt);
    setFocusKey(null);
    for (const key of ['topology', 'customers', 'pppoe-summary', 'alerts', 'dashboard']) void qc.invalidateQueries({ queryKey: [key] });
  };
  const runScan = async () => {
    const d = await scan.run(() => post<Diagnosis>('/api/troubleshoot/scan', { routerId }));
    if (!d) return;
    apply(d);
    if (d.syncError) toast('warning', 'Router tidak terjangkau', `${d.syncError}. Hasil di bawah memakai data terakhir yang tersimpan.`);
    else toast(d.findings.length ? 'warning' : 'success', d.findings.length ? `${d.findings.length} indikasi gangguan ditemukan` : 'Tidak ada indikasi kabel putus');
  };

  const map = useMemo(() => (topo.data ? buildFiberMap(topo.data, diag.data, { customers: showCustomers }) : null), [topo.data, diag.data, showCustomers]);
  const focus = useMemo(() => {
    const f = diag.data?.findings.find((x) => x.key === focusKey);
    if (!f) return null;
    return { key: f.key, from: hasCoord(f.from) ? ([f.from.lat, f.from.lng] as [number, number]) : null, to: hasCoord(f.to) ? ([f.to.lat, f.to.lng] as [number, number]) : null };
  }, [diag.data, focusKey]);

  if (topo.isLoading || diag.isLoading) return <Loading />;
  if (topo.error || diag.error || !topo.data || !diag.data) return <ErrorBox error={topo.error ?? diag.error} onRetry={() => (topo.refetch(), diag.refetch())} />;
  const d = diag.data;
  const critical = d.findings.filter((f) => f.severity === 'critical').length;
  const noTopology = !topo.data.odcs.length && !topo.data.looseOdps.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Troubleshoot Jalur"
        subtitle="Scan status PPPoE semua pelanggan untuk menunjuk segmen kabel yang diduga putus"
        icon={<Stethoscope className="size-5" />}
        actions={
          <Button icon={<Radar className={clsx('size-4', scan.busy && 'animate-spin')} />} loading={scan.busy} onClick={runScan}>
            Scan jalur sekarang
          </Button>
        }
      />

      {simulate && can('customer.write') && <Simulator routerId={routerId} topo={topo.data} onResult={apply} />}

      <Card className={clsx('flex flex-wrap items-center gap-x-6 gap-y-3 p-4', d.findings.length ? (critical ? 'border-rose-500/50 bg-rose-500/5' : 'border-amber-500/50 bg-amber-500/5') : 'border-emerald-500/40 bg-emerald-500/5')}>
        <div className="flex items-center gap-3">
          {d.findings.length ? <AlertTriangle className={clsx('size-8', critical ? 'text-rose-500' : 'text-amber-500')} /> : <CheckCircle2 className="size-8 text-emerald-500" />}
          <div>
            <p className="text-base font-bold">
              {d.findings.length ? `${d.findings.length} indikasi gangguan${critical ? ` (${critical} di kabel utama)` : ''}` : 'Tidak ada indikasi kabel putus'}
            </p>
            <p className="text-xs text-muted">{lastScan ? `Scan terakhir ${formatDate(lastScan)}` : `Data sinkronisasi terakhir (${formatDate(d.scannedAt)}). Tekan Scan untuk mengambil status terbaru dan log router.`}</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-x-6 gap-y-2 text-center text-xs">
          {[
            ['Online', d.totals.online, 'text-emerald-500'],
            ['Offline', d.totals.offline, d.totals.offline ? 'text-rose-500' : ''],
            ['Belum pernah online', d.totals.neverOnline, ''],
            ['Dipantau', d.totals.customers, ''],
          ].map(([label, value, cls]) => (
            <div key={label as string}>
              <p className={clsx('text-xl font-bold tabular-nums', cls as string)}>{value}</p>
              <p className="text-muted">{label}</p>
            </div>
          ))}
        </div>
      </Card>

      {noTopology && (
        <Card className="flex items-start gap-3 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-cyan-500" />
          <p className="text-muted">
            Belum ada ODC/ODP. Diagnosis membandingkan pelanggan yang berbagi jalur yang sama, jadi catat dulu ODC, ODP, dan port tiap pelanggan di{' '}
            <Link to="/topology" className="font-medium text-brand hover:underline">
              Topologi ODC / ODP
            </Link>
            .
          </p>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          {d.findings.map((f, i) => (
            <FindingCard key={f.key} f={f} index={i + 1} logs={logs} active={focusKey === f.key} onFocus={() => setFocusKey(f.key)} />
          ))}
          {!d.findings.length && (
            <Card className="p-6 text-center text-sm text-muted">
              Semua pelanggan yang pernah online saat ini tersambung, atau yang offline tidak membentuk pola kabel putus.
            </Card>
          )}
          {d.unassignedOffline.length > 0 && (
            <Card className="p-4">
              <p className="text-sm font-semibold">{d.unassignedOffline.length} pelanggan offline belum ditempatkan di ODP</p>
              <p className="mt-0.5 text-xs text-muted">Segmennya tidak bisa ditentukan. Isi ODP dan port-nya agar ikut dianalisis.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.unassignedOffline.map((c) => (
                  <Link key={c.id} to={`/customers?id=${c.id}`}>
                    <Badge tone="red">{c.name}</Badge>
                  </Link>
                ))}
              </div>
            </Card>
          )}
          {d.neverOnline.length > 0 && (
            <Card className="p-4">
              <p className="text-sm font-semibold">{d.neverOnline.length} pelanggan belum pernah online</p>
              <p className="mt-0.5 text-xs text-muted">Kemungkinan pemasangan belum selesai. Tidak dihitung sebagai gangguan.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.neverOnline.map((c) => (
                  <Link key={c.id} to={`/customers?id=${c.id}`}>
                    <Badge>
                      {c.name}
                      {c.odp ? ` • ${c.odp}` : ''}
                    </Badge>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-3 xl:sticky xl:top-20 xl:self-start">
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MapLegend customers={showCustomers} />
              <label className="flex items-center gap-2 text-[11px] text-muted">
                <input type="checkbox" checked={showCustomers} onChange={(e) => setShowCustomers(e.target.checked)} /> Rumah pelanggan
              </label>
            </div>
            {map && <FiberMap nodes={map.nodes} lines={map.lines} focus={focus} height={460} />}
            <p className="text-[11px] text-subtle">
              Garis ditarik lurus antar titik, bukan rute kabel sebenarnya.
              {map && map.missing > 0 && (
                <>
                  {' '}
                  {map.missing} titik belum punya koordinat: isi di{' '}
                  <Link to="/topology" className="text-brand hover:underline">
                    Topologi
                  </Link>
                  .
                </>
              )}
            </p>
          </Card>
          <Card className="flex items-start gap-3 p-4 text-xs text-muted">
            <Info className="mt-0.5 size-4 shrink-0 text-cyan-500" />
            <div className="space-y-1">
              <p>
                <b className="text-fg">Cara kerja scan.</b> Aplikasi tidak mengukur kabel secara fisik. Scan membandingkan pelanggan mana yang offline bersamaan, lalu menunjuk segmen yang mereka pakai bersama: server → ODC (feeder), ODC → ODP (distribusi), atau ODP → rumah (drop).
              </p>
              <p>Hasilnya menunjuk segmen, bukan meter ke berapa kabel putus. Titik pastinya tetap perlu OTDR atau power meter di lapangan. Pemadaman listrik satu gang bisa terlihat sama seperti kabel distribusi putus.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function Troubleshoot() {
  return <RequireRouter>{(routerId, router) => <Inner key={routerId} routerId={routerId} simulate={router.simulate} />}</RequireRouter>;
}
