import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Activity,
  BarChart3,
  Bell,
  BookUser,
  Cable,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Network,
  RefreshCcwDot,
  Router as RouterIcon,
  Settings,
  Shield,
  ShieldCheck,
  Sun,
  Ticket,
  UserCog,
  Users,
  Wifi,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { get, post, setSubscriptionInactiveHandler } from '../lib/api';
import { useCloud } from '../lib/cloud';
import { formatDate } from '../lib/format';
import { ROLE_LABEL, useAuth } from '../lib/auth';
import { useRealtime } from '../lib/realtime';
import { useRouters } from '../lib/router-context';
import { timeAgo } from '../lib/format';
import { StatusDot } from './ui';

interface NavItem {
  to: string;
  label: string;
  perm?: string;
}
interface NavGroup {
  id: string;
  label: string;
  icon: ReactNode;
  perm?: string;
  items: NavItem[];
}

const r = (key: string, label: string): NavItem => ({ to: `/res/${key}`, label });

const NAV: NavGroup[] = [
  {
    id: 'pelanggan',
    label: 'Pelanggan PPPoE',
    icon: <Cable className="size-4" />,
    perm: 'voucher.view',
    items: [
      { to: '/customers', label: 'Pelanggan', perm: 'customer.view' },
      { to: '/pppoe/vouchers', label: 'Voucher Isi Ulang' },
      { to: '/pppoe/packages', label: 'Paket & Harga', perm: 'customer.view' },
      { to: '/topology', label: 'Topologi ODC / ODP', perm: 'customer.view' },
      { to: '/troubleshoot', label: 'Troubleshoot Jalur', perm: 'customer.view' },
    ],
  },
  {
    id: 'monitor',
    label: 'Monitoring',
    icon: <Activity className="size-4" />,
    perm: 'router.view',
    items: [
      { to: '/monitor', label: 'Monitor Router' },
      { to: '/traffic', label: 'Trafik Live' },
      { to: '/logs', label: 'Log Router' },
    ],
  },
  {
    id: 'hotspot',
    label: 'Hotspot',
    icon: <Wifi className="size-4" />,
    perm: 'hotspot.view',
    items: [
      { to: '/hotspot/active', label: 'Sesi Aktif' },
      { to: '/hotspot/portal', label: 'Portal Login' },
      { to: '/hotspot/profiles', label: 'Profil & Harga' },
      r('hotspot-users', 'Pengguna Hotspot'),
      r('hotspot-hosts', 'Host'),
      r('ip-binding', 'IP Binding'),
      r('walled-garden', 'Walled Garden'),
      r('walled-garden-ip', 'Walled Garden IP'),
      r('hotspot-servers', 'Server Hotspot'),
      r('hotspot-server-profiles', 'Profil Server'),
      r('hotspot-cookies', 'Cookie'),
    ],
  },
  {
    id: 'voucher',
    label: 'Voucher Hotspot',
    icon: <Ticket className="size-4" />,
    perm: 'voucher.view',
    items: [
      { to: '/vouchers/generate', label: 'Buat Voucher', perm: 'voucher.write' },
      { to: '/vouchers', label: 'Daftar Voucher' },
      { to: '/vouchers/batches', label: 'Batch & Cetak' },
    ],
  },
  {
    id: 'ppp',
    label: 'PPP (menu router)',
    icon: <Users className="size-4" />,
    perm: 'config.view',
    items: [r('ppp-secrets', 'PPP Secret'), r('ppp-profiles', 'PPP Profile'), r('ppp-active', 'PPP Aktif'), r('pppoe-servers', 'PPPoE Server')],
  },
  {
    id: 'network',
    label: 'Jaringan',
    icon: <Network className="size-4" />,
    perm: 'config.view',
    items: [
      r('interfaces', 'Interface'),
      r('bridges', 'Bridge'),
      r('bridge-ports', 'Bridge Port'),
      r('vlans', 'VLAN'),
      r('ip-address', 'IP Address'),
      r('routes', 'Routing'),
      r('pools', 'IP Pool'),
      r('dhcp-servers', 'DHCP Server'),
      r('dhcp-networks', 'DHCP Network'),
      r('dhcp-leases', 'DHCP Lease'),
      r('dns-static', 'DNS Static'),
      r('arp', 'ARP'),
      r('neighbors', 'Neighbor'),
    ],
  },
  {
    id: 'firewall',
    label: 'Firewall & QoS',
    icon: <Shield className="size-4" />,
    perm: 'config.view',
    items: [r('firewall-filter', 'Filter Rules'), r('firewall-nat', 'NAT'), r('firewall-mangle', 'Mangle'), r('address-list', 'Address List'), r('queue-simple', 'Simple Queue'), r('queue-types', 'Queue Type')],
  },
  {
    id: 'system',
    label: 'Sistem & Tools',
    icon: <Wrench className="size-4" />,
    perm: 'config.view',
    items: [
      { to: '/router-menu', label: 'Semua Menu Router' },
      { to: '/system', label: 'Sistem & Backup' },
      r('scheduler', 'Scheduler'),
      r('scripts', 'Script'),
      r('router-users', 'User Router'),
      r('services', 'IP Service'),
      r('files', 'File'),
      { to: '/tools/ping', label: 'Ping' },
      { to: '/tools/terminal', label: 'Terminal API', perm: 'terminal' },
    ],
  },
];

const TOP_LINKS: (NavItem & { icon: ReactNode })[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="size-4" /> },
  { to: '/routers', label: 'Router', icon: <RouterIcon className="size-4" />, perm: 'router.view' },
  { to: '/sync', label: 'Sinkronisasi Router', icon: <RefreshCcwDot className="size-4" />, perm: 'config.view' },
];

const BUSINESS_LINKS: (NavItem & { icon: ReactNode })[] = [
  { to: '/resellers', label: 'Reseller', icon: <BookUser className="size-4" />, perm: 'reseller.view' },
  { to: '/reports', label: 'Laporan Penjualan', icon: <BarChart3 className="size-4" />, perm: 'report.view' },
];

const ADMIN_LINKS: (NavItem & { icon: ReactNode })[] = [
  { to: '/users', label: 'Pengguna Aplikasi', icon: <UserCog className="size-4" />, perm: 'users.manage' },
  { to: '/audit', label: 'Audit Log', icon: <FileClock className="size-4" />, perm: 'audit.view' },
  { to: '/settings', label: 'Pengaturan', icon: <Settings className="size-4" />, perm: 'settings.manage' },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('mikrotal.theme', dark ? 'dark' : 'light');
    } catch {
      /* abaikan */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function SideLink({ to, label, icon, onClick }: { to: string; label: string; icon?: ReactNode; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === '/' || to === '/vouchers'}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition',
          isActive ? 'bg-brand/10 font-semibold text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg',
          !icon && 'py-1.5 pl-9',
        )
      }
    >
      {icon}
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('mikrotal.nav') ?? '{}');
    } catch {
      return {};
    }
  });

  const { data: cloud } = useCloud();
  const groups = useMemo(
    () => NAV.filter((g) => !g.perm || can(g.perm)).map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(i.perm)) })),
    [can],
  );

  useEffect(() => {
    const active = groups.find((g) => g.items.some((i) => location.pathname === i.to || (i.to !== '/vouchers' && location.pathname.startsWith(i.to + '/'))));
    if (active && !open[active.id]) setOpen((o) => ({ ...o, [active.id]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem('mikrotal.nav', JSON.stringify(open));
    } catch {
      /* abaikan */
    }
  }, [open]);

  return (
    <div className="flex h-full flex-col">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-3 px-5 pb-4 pt-5">
        <div className="bg-gradient-brand flex size-9 items-center justify-center rounded-xl shadow-lg shadow-cyan-500/30">
          <Zap className="size-5 text-white" />
        </div>
        <div>
          <p className="text-base font-extrabold tracking-tight">
            MIKRO<span className="text-gradient">TAL</span>
          </p>
          <p className="-mt-0.5 text-[10px] uppercase tracking-[0.2em] text-subtle">Mikrotik Digital</p>
        </div>
      </Link>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {TOP_LINKS.filter((l) => !l.perm || can(l.perm)).map((l) => (
          <SideLink key={l.to} {...l} onClick={onNavigate} />
        ))}
        {cloud && (can('settings.manage') || can('router.manage')) && <SideLink to="/cloud" label="Langganan & VPN" icon={<CreditCard className="size-4" />} onClick={onNavigate} />}
        {groups.length > 0 && <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-subtle">MikroTik</p>}
        {groups.map((g) => (
          <div key={g.id}>
            <button
              onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-muted transition hover:bg-surface-2 hover:text-fg"
            >
              {g.icon}
              <span className="flex-1 text-left">{g.label}</span>
              {open[g.id] ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
            {open[g.id] && (
              <div className="mb-1 space-y-0.5">
                {g.items.map((i) => (
                  <SideLink key={i.to} to={i.to} label={i.label} onClick={onNavigate} />
                ))}
              </div>
            )}
          </div>
        ))}
        {BUSINESS_LINKS.some((l) => !l.perm || can(l.perm)) && <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-subtle">Bisnis</p>}
        {BUSINESS_LINKS.filter((l) => (!l.perm || can(l.perm)) && !(l.to === '/resellers' && user?.role === 'reseller')).map((l) => (
          <SideLink key={l.to} {...l} onClick={onNavigate} />
        ))}
        {user?.role === 'reseller' && <SideLink to="/my-balance" label="Saldo & Transaksi" icon={<ClipboardList className="size-4" />} onClick={onNavigate} />}
        {ADMIN_LINKS.some((l) => !l.perm || can(l.perm)) && <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-subtle">Administrasi</p>}
        {ADMIN_LINKS.filter((l) => !l.perm || can(l.perm)).map((l) => (
          <SideLink key={l.to} {...l} onClick={onNavigate} />
        ))}
      </nav>
      <div className="border-t border-line p-3">
        <a href="/cek" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted hover:bg-surface-2 hover:text-fg">
          <ShieldCheck className="size-4" /> Halaman cek voucher pelanggan
        </a>
      </div>
    </div>
  );
}

function RouterSwitcher() {
  const { routers, router, setRouterId } = useRouters();
  const { snapshots } = useRealtime();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  if (!routers.length) return null;
  const online = (id: number) => snapshots[id]?.online ?? routers.find((r) => r.id === id)?.snapshot?.online;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex h-9 max-w-[240px] items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm hover:border-brand/50">
        <StatusDot online={router ? online(router.id) : undefined} />
        <span className="truncate font-medium">{router?.name ?? 'Pilih router'}</span>
        <ChevronDown className="size-3.5 shrink-0 text-subtle" />
      </button>
      {open && (
        <div className="animate-in absolute left-0 top-11 z-40 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl dark:bg-elevated">
          <p className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Pilih router aktif</p>
          <div className="max-h-80 overflow-y-auto p-1">
            {routers.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setRouterId(r.id);
                  setOpen(false);
                }}
                className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2', r.id === router?.id && 'bg-brand/10')}
              >
                <StatusDot online={online(r.id)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="truncate text-xs text-muted">
                    {r.simulate ? 'Simulasi' : `${r.host}:${r.port}`} {r.location && `• ${r.location}`}
                  </p>
                </div>
              </button>
            ))}
          </div>
          <Link to="/routers" onClick={() => setOpen(false)} className="block border-t border-line px-3 py-2 text-center text-xs font-medium text-brand hover:bg-surface-2">
            Kelola router
          </Link>
        </div>
      )}
    </div>
  );
}

interface AlertItem {
  id: number;
  level: 'info' | 'warning' | 'critical' | 'success';
  title: string;
  message: string;
  router_name?: string;
  is_read: number;
  created_at: string;
}

function AlertsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['alerts'], queryFn: () => get<{ rows: AlertItem[]; unread: number }>('/api/alerts', { limit: 30 }), refetchInterval: 60000 });
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const color = { info: 'bg-cyan-500', warning: 'bg-amber-500', critical: 'bg-rose-500', success: 'bg-emerald-500' };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Notifikasi">
        <Bell className="size-[18px]" />
        {!!data?.unread && <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="animate-in absolute right-0 top-11 z-40 w-[min(380px,calc(100vw-1rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl dark:bg-elevated">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold">Notifikasi</p>
            <button
              className="text-xs font-medium text-brand hover:underline"
              onClick={async () => {
                await post('/api/alerts/read-all');
                void qc.invalidateQueries({ queryKey: ['alerts'] });
              }}
            >
              Tandai dibaca
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {!data?.rows.length && <p className="px-4 py-10 text-center text-sm text-muted">Belum ada notifikasi</p>}
            {data?.rows.map((a) => (
              <div key={a.id} className={clsx('flex gap-3 border-b border-line px-4 py-3 last:border-0', !a.is_read && 'bg-brand/5')}>
                <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', color[a.level])} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{a.title}</p>
                  {a.message && <p className="mt-0.5 text-xs text-muted">{a.message}</p>}
                  <p className="mt-1 text-[11px] text-subtle">{timeAgo(a.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  if (!user) return null;
  const initials = (user.name || user.username).split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-surface-2">
        <div className="bg-gradient-brand flex size-7 items-center justify-center rounded-lg text-xs font-bold text-white">{initials}</div>
        <div className="hidden text-left leading-tight md:block">
          <p className="text-xs font-semibold">{user.name || user.username}</p>
          <p className="text-[10px] text-muted">{ROLE_LABEL[user.role]}</p>
        </div>
      </button>
      {open && (
        <div className="animate-in absolute right-0 top-11 z-40 w-56 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-2xl dark:bg-elevated">
          <div className="border-b border-line px-3 py-2">
            <p className="text-sm font-semibold">{user.username}</p>
            <p className="text-xs text-muted">
              {ROLE_LABEL[user.role]}
              {user.reseller_name && ` • ${user.reseller_name}`}
            </p>
          </div>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              navigate('/account');
            }}
          >
            <UserCog className="size-4" /> Akun saya
          </button>
          <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-500 hover:bg-surface-2" onClick={logout}>
            <LogOut className="size-4" /> Keluar
          </button>
        </div>
      )}
    </div>
  );
}

/** MIKROTAL Cloud: pengingat masa langganan di atas setiap halaman. */
function SubscriptionBanner() {
  const { data } = useCloud();
  const location = useLocation();
  if (!data || location.pathname === '/cloud') return null;
  const st = data.status;
  const soon = (st.phase === 'trial' || st.phase === 'active') && st.daysLeft <= 7;
  if (!soon && st.canUse) return null;
  const danger = !st.canUse;
  const text =
    st.phase === 'grace'
      ? `Masa langganan habis ${formatDate(st.periodEnd, false)}. Layanan berhenti ${formatDate(st.graceEnd, false)} bila belum dibayar.`
      : danger
        ? st.reason
        : `${st.trial ? 'Masa uji coba' : 'Langganan'} berakhir ${st.daysLeft <= 0 ? 'hari ini' : `${st.daysLeft} hari lagi`} (${formatDate(st.periodEnd, false)}).`;
  return (
    <div
      className={clsx(
        'no-print mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm',
        danger || st.phase === 'grace' ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      )}
    >
      <CreditCard className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      <Link to="/cloud" className="rounded-lg bg-white/60 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-white dark:bg-white/10 dark:text-white">
        {st.trial ? 'Pilih paket' : 'Bayar sekarang'}
      </Link>
    </div>
  );
}

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { dark, toggle } = useTheme();
  const { connected } = useRealtime();
  const { can } = useAuth();
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    setSubscriptionInactiveHandler(() => {
      void qc.invalidateQueries({ queryKey: ['cloud-subscription'] });
      navigate('/cloud');
    });
    return () => setSubscriptionInactiveHandler(undefined);
  }, [navigate, qc]);

  return (
    <div className="flex h-full">
      <aside className="no-print hidden w-64 shrink-0 border-r border-line bg-surface/70 backdrop-blur lg:block dark:bg-surface/40">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <aside className="animate-in absolute inset-y-0 left-0 w-72 border-r border-line bg-surface dark:bg-elevated">
            <button className="absolute right-3 top-5 text-muted" onClick={() => setMobileOpen(false)} aria-label="Tutup menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/80 px-3 backdrop-blur-md sm:px-5">
          <button className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Buka menu">
            <Menu className="size-5" />
          </button>
          {can('router.view') && <RouterSwitcher />}
          <div className="flex-1" />
          <div className={clsx('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium sm:flex', connected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-500/10 text-subtle')} title="Koneksi realtime">
            <span className={clsx('size-1.5 rounded-full', connected ? 'live-dot bg-emerald-500' : 'bg-slate-400')} />
            {connected ? 'Live' : 'Offline'}
          </div>
          <button onClick={toggle} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Ganti tema">
            {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </button>
          {can('router.view') && <AlertsBell />}
          <UserMenu />
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden p-3 sm:p-5 lg:p-6">
          <SubscriptionBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

