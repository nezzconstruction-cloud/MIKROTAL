import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, Banknote, Cable, CheckCircle2, Cpu, MemoryStick, Plus, Router as RouterIcon, Ticket, TrendingUp, Users, Wallet, Wifi } from 'lucide-react';
import clsx from 'clsx';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtime, type Snapshot } from '../lib/realtime';
import { formatBps, formatDate, formatMoney, formatNumber, humanDuration, pct, timeAgo } from '../lib/format';
import { daysLeft } from '../lib/pppoe';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Loading, PageHeader, Progress, StatCard, StatusDot } from '../components/ui';
import { RevenueChart } from '../components/charts';
import { useRouters } from '../lib/router-context';

interface DashboardData {
  routers: { id: number; name: string; location: string; status: string; status_message: string; enabled: boolean; simulate: boolean; snapshot: Snapshot | null }[];
  totals: { routers: number; online: number; offline: number; hotspotActive: number; pppActive: number; rx: number; tx: number };
  revenue: { today: number; week: number; month: number; daily: { date: string; direct: number; reseller: number; pppoe: number; count: number }[] };
  vouchers: Record<string, number>;
  topProfiles: { profile: string; count: number; amount: number }[];
  alerts: { id: number; level: string; title: string; message: string; router_name?: string; created_at: string }[];
  unreadAlerts: number;
  reseller: { id: number; name: string; balance: number; discount: number } | null;
  pppoe: {
    customers: { total: number; online: number; active: number; isolated: number; disabled: number; offline: number; expiring: number };
    remindDays: number;
    expiringList: { id: number; name: string; username: string; phone: string; expires_at: string; online: number; package_name: string | null }[];
    vouchers: { unused: number; used: number };
    odp: { total: number; ports: number; used: number; down: number };
  } | null;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 19) return 'Selamat sore';
  return 'Selamat malam';
}

function RouterCard({ r, snap, onSelect }: { r: DashboardData['routers'][number]; snap: Snapshot | null; onSelect: () => void }) {
  const online = snap?.online;
  return (
    <Link to="/monitor" onClick={onSelect} className="card group block p-4 transition hover:border-brand/50">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot online={r.enabled ? online : undefined} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold group-hover:text-brand">{r.name}</p>
            <p className="truncate text-xs text-muted">{r.location || (r.simulate ? 'Router simulasi' : '—')}</p>
          </div>
        </div>
        {!r.enabled ? <Badge>nonaktif</Badge> : online ? <Badge tone="green">online</Badge> : snap ? <Badge tone="red">offline</Badge> : <Badge>memeriksa</Badge>}
      </div>
      {online && snap ? (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="mb-1 flex justify-between text-muted">
                <span className="flex items-center gap-1">
                  <Cpu className="size-3" /> CPU
                </span>
                <span className="font-semibold text-fg">{snap.cpu ?? 0}%</span>
              </div>
              <Progress value={snap.cpu ?? 0} />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-muted">
                <span className="flex items-center gap-1">
                  <MemoryStick className="size-3" /> RAM
                </span>
                <span className="font-semibold text-fg">{Math.round(pct(snap.memUsed, snap.memTotal))}%</span>
              </div>
              <Progress value={pct(snap.memUsed, snap.memTotal)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-2 p-2.5 text-center text-xs">
            <div>
              <p className="text-muted">Hotspot</p>
              <p className="mt-0.5 font-bold">{snap.hotspotActive ?? 0}</p>
            </div>
            <div>
              <p className="flex items-center justify-center gap-0.5 text-muted">
                <ArrowDown className="size-3 text-cyan-500" /> RX
              </p>
              <p className="mt-0.5 font-bold tabular-nums">{formatBps(snap.rx, 1)}</p>
            </div>
            <div>
              <p className="flex items-center justify-center gap-0.5 text-muted">
                <ArrowUp className="size-3 text-violet-500" /> TX
              </p>
              <p className="mt-0.5 font-bold tabular-nums">{formatBps(snap.tx, 1)}</p>
            </div>
          </div>
          <p className="truncate text-[11px] text-subtle">
            {snap.board} • RouterOS {snap.version} • uptime {humanDuration(snap.uptimeSeconds, 2)}
          </p>
        </div>
      ) : (
        <p className="mt-4 line-clamp-2 text-xs text-rose-500/90">{snap?.error ?? r.status_message ?? 'Menunggu data...'}</p>
      )}
    </Link>
  );
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const { snapshots } = useRealtime();
  const { setRouterId } = useRouters();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => get<DashboardData>('/api/dashboard'), refetchInterval: 20000 });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} onRetry={() => refetch()} />;

  const routers = data.routers.map((r) => ({ ...r, snap: snapshots[r.id] ?? r.snapshot }));
  const hotspotActive = routers.reduce((s, r) => s + (r.snap?.online ? r.snap.hotspotActive ?? 0 : 0), 0);
  const online = routers.filter((r) => r.snap?.online).length;
  const rx = routers.reduce((s, r) => s + (r.snap?.online ? r.snap.rx ?? 0 : 0), 0);
  const tx = routers.reduce((s, r) => s + (r.snap?.online ? r.snap.tx ?? 0 : 0), 0);
  const v = data.vouchers;
  const isReseller = user?.role === 'reseller';
  const pp = data.pppoe;

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <>
            {greeting()}, <span className="text-gradient">{user?.name || user?.username}</span>
          </>
        }
        subtitle={new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <>
            {can('customer.view') && (
              <Link to="/customers">
                <Button variant="secondary" icon={<Users className="size-4" />}>
                  Pelanggan
                </Button>
              </Link>
            )}
            {can('voucher.write') && (
              <Link to="/pppoe/vouchers">
                <Button icon={<Plus className="size-4" />}>Voucher PPPoE</Button>
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isReseller && data.reseller ? (
          <StatCard label="Saldo Anda" value={formatMoney(data.reseller.balance)} icon={<Wallet className="size-5" />} tone="green" sub={`Diskon ${data.reseller.discount}%`} />
        ) : (
          <StatCard label="Pendapatan hari ini" value={formatMoney(data.revenue.today)} icon={<Banknote className="size-5" />} tone="green" sub={`PPPoE + hotspot • ${formatNumber(v.activatedToday ?? 0)} voucher hotspot aktif hari ini`} />
        )}
        <StatCard label="Pendapatan bulan ini" value={formatMoney(data.revenue.month)} icon={<TrendingUp className="size-5" />} tone="violet" sub={`7 hari: ${formatMoney(data.revenue.week)}`} />
        {isReseller ? (
          <StatCard label="Voucher belum terpakai" value={formatNumber(v.unused ?? 0)} icon={<Ticket className="size-5" />} tone="cyan" sub={`${formatNumber(v.active ?? 0)} sedang online`} />
        ) : (
          <StatCard
            label="Pelanggan PPPoE online"
            value={
              <>
                {formatNumber(pp?.customers.online ?? 0)}
                <span className="text-base font-medium text-muted">/{formatNumber(pp?.customers.total ?? 0)}</span>
              </>
            }
            icon={<Cable className="size-5" />}
            tone="cyan"
            sub={`${formatNumber(pp?.customers.isolated ?? 0)} terisolir • hotspot online ${formatNumber(hotspotActive)}`}
          />
        )}
        {isReseller ? (
          <StatCard label="Voucher terpakai" value={formatNumber((v.used ?? 0) + (v.expired ?? 0))} icon={<CheckCircle2 className="size-5" />} tone="orange" />
        ) : (
          <StatCard
            label="Router online"
            value={
              <>
                {online}
                <span className="text-base font-medium text-muted">/{routers.length}</span>
              </>
            }
            icon={<RouterIcon className="size-5" />}
            tone={online < routers.filter((r) => r.enabled).length ? 'rose' : 'blue'}
            sub={
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-0.5">
                  <ArrowDown className="size-3 text-cyan-500" />
                  {formatBps(rx)}
                </span>
                <span className="flex items-center gap-0.5">
                  <ArrowUp className="size-3 text-violet-500" />
                  {formatBps(tx)}
                </span>
              </span>
            }
          />
        )}
      </div>

      {pp && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Jaringan PPPoE" subtitle="Pelanggan rumah lewat ODC / ODP" icon={<Cable className="size-4" />} actions={<Link to="/topology" className="text-xs font-medium text-brand hover:underline">Lihat topologi</Link>} />
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Online', value: pp.customers.online, to: '/customers?status=online', cls: 'text-emerald-500' },
                { label: 'Offline', value: pp.customers.offline, to: '/customers?status=offline', cls: pp.customers.offline ? 'text-rose-500' : '' },
                { label: 'Terisolir', value: pp.customers.isolated, to: '/customers?status=isolated', cls: pp.customers.isolated ? 'text-amber-500' : '' },
                { label: `Habis ≤ ${pp.remindDays} hari`, value: pp.customers.expiring, to: '/customers?status=expiring', cls: pp.customers.expiring ? 'text-amber-500' : '' },
                { label: 'Stok voucher', value: pp.vouchers.unused, to: '/pppoe/vouchers', cls: '' },
                { label: 'Port ODP', value: `${pp.odp.used}/${pp.odp.ports}`, to: '/topology', cls: pp.odp.down ? 'text-rose-500' : '' },
              ].map((x) => (
                <Link key={x.label} to={x.to} className="rounded-xl bg-surface-2 p-3 transition hover:ring-1 hover:ring-brand/40">
                  <p className="truncate text-[11px] text-muted">{x.label}</p>
                  <p className={clsx('mt-1 text-xl font-bold tabular-nums', x.cls)}>{typeof x.value === 'number' ? formatNumber(x.value) : x.value}</p>
                </Link>
              ))}
            </div>
            {pp.odp.down > 0 && (
              <Link to="/troubleshoot" className="mx-4 mb-4 flex items-center gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-500/20 dark:text-rose-400">
                <AlertTriangle className="size-4" /> {pp.odp.down} jalur kabel diduga putus — buka Troubleshoot Jalur untuk lokasi dan langkah pengecekan.
              </Link>
            )}
          </Card>
          <Card>
            <CardHeader title="Masa aktif hampir habis" icon={<Ticket className="size-4" />} actions={<Link to="/customers?status=expiring" className="text-xs font-medium text-brand hover:underline">Lihat semua</Link>} />
            <div className="divide-y divide-line">
              {!pp.expiringList.length && <p className="px-5 py-8 text-center text-sm text-muted">Tidak ada pelanggan yang habis dalam {pp.remindDays} hari.</p>}
              {pp.expiringList.map((c) => {
                const d = daysLeft(c.expires_at) ?? 0;
                return (
                  <Link key={c.id} to={`/customers?id=${c.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-surface-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="truncate text-[11px] text-subtle">
                        {c.package_name ?? c.username} • {formatDate(c.expires_at, false)}
                      </p>
                    </div>
                    <Badge tone={d <= 1 ? 'red' : 'yellow'}>{d <= 0 ? 'hari ini' : `${d} hari lagi`}</Badge>
                  </Link>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Penjualan 7 hari terakhir" subtitle="PPPoE saat voucher diisikan, hotspot saat dipakai, reseller saat pembelian" icon={<TrendingUp className="size-4" />} />
          <div className="p-4">
            <RevenueChart data={data.revenue.daily} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Status voucher hotspot" icon={<Ticket className="size-4" />} actions={<Link to="/vouchers" className="text-xs font-medium text-brand hover:underline">Lihat semua</Link>} />
          <div className="space-y-3 p-5">
            {[
              { k: 'unused', label: 'Belum dipakai', tone: 'bg-cyan-500' },
              { k: 'active', label: 'Sedang online', tone: 'bg-emerald-500' },
              { k: 'used', label: 'Sudah dipakai', tone: 'bg-violet-500' },
              { k: 'expired', label: 'Kedaluwarsa', tone: 'bg-slate-400' },
            ].map((s) => {
              const total = Object.entries(v).filter(([k]) => k !== 'activatedToday').reduce((a, [, b]) => a + b, 0) || 1;
              return (
                <div key={s.k}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="flex items-center gap-2 text-muted">
                      <span className={clsx('size-2 rounded-full', s.tone)} /> {s.label}
                    </span>
                    <span className="font-semibold">{formatNumber(v[s.k] ?? 0)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className={clsx('h-full rounded-full', s.tone)} style={{ width: `${((v[s.k] ?? 0) / total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            {data.topProfiles.length > 0 && (
              <div className="border-t border-line pt-4">
                <p className="mb-2 text-xs font-semibold text-muted">Paket terlaris bulan ini</p>
                {data.topProfiles.map((p, i) => (
                  <div key={p.profile} className="flex items-center justify-between py-1 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-md bg-surface-2 text-[10px] font-bold text-muted">{i + 1}</span>
                      {p.profile}
                    </span>
                    <span className="text-xs text-muted">
                      {p.count}× • <b className="text-fg">{formatMoney(p.amount)}</b>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {!isReseller && (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Wifi className="size-4 text-brand" /> Router
              </h2>
              <Link to="/routers" className="text-xs font-medium text-brand hover:underline">
                Kelola router
              </Link>
            </div>
            {routers.length ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {routers.map((r) => (
                  <RouterCard key={r.id} r={r} snap={r.snap} onSelect={() => setRouterId(r.id)} />
                ))}
              </div>
            ) : (
              <Card>
                <EmptyState icon={<RouterIcon className="size-6" />} title="Belum ada router" action={<Link to="/routers"><Button>Tambah router</Button></Link>} />
              </Card>
            )}
          </div>
          <Card>
            <CardHeader title="Notifikasi terbaru" icon={<AlertTriangle className="size-4" />} subtitle={data.unreadAlerts ? `${data.unreadAlerts} belum dibaca` : 'Semua sudah dibaca'} />
            <div className="divide-y divide-line">
              {!data.alerts.length && <p className="px-5 py-10 text-center text-sm text-muted">Jaringan aman, belum ada notifikasi.</p>}
              {data.alerts.map((a) => (
                <div key={a.id} className="flex gap-3 px-5 py-3">
                  <span
                    className={clsx('mt-1.5 size-2 shrink-0 rounded-full', {
                      'bg-rose-500': a.level === 'critical',
                      'bg-amber-500': a.level === 'warning',
                      'bg-emerald-500': a.level === 'success',
                      'bg-cyan-500': a.level === 'info',
                    })}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <p className="text-[11px] text-subtle">{timeAgo(a.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
