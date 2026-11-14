import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Lock, Ticket, User, Wifi, Zap } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Button, Input } from '../components/ui';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={(location.state as any)?.from ?? '/'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
      navigate((location.state as any)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal');
    } finally {
      setBusy(false);
    }
  };

  const features = [
    { icon: <Activity className="size-4" />, text: 'Monitoring realtime CPU, memori, trafik & alert Telegram' },
    { icon: <Wifi className="size-4" />, text: 'Kelola hotspot, PPPoE, firewall, queue tanpa Winbox' },
    { icon: <Ticket className="size-4" />, text: 'Voucher otomatis, cetak QR, reseller & laporan penjualan' },
  ];

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -left-32 -top-32 size-[480px] rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 size-[520px] rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-line bg-surface/80 shadow-2xl backdrop-blur-xl lg:grid-cols-2 dark:bg-surface/60">
        <div className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex">
          <div className="bg-gradient-brand absolute inset-0 opacity-90" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,.25),transparent_40%)]" />
          <div className="relative flex items-center gap-3 text-white">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              <Zap className="size-6" />
            </div>
            <div>
              <p className="text-xl font-extrabold tracking-tight">MIKROTAL</p>
              <p className="text-xs uppercase tracking-[0.25em] text-white/70">Mikrotik Digital</p>
            </div>
          </div>
          <div className="relative text-white">
            <h2 className="text-3xl font-bold leading-tight">Satu dashboard untuk seluruh jaringan MikroTik Anda.</h2>
            <ul className="mt-6 space-y-3">
              {features.map((f) => (
                <li key={f.text} className="flex items-start gap-3 text-sm text-white/90">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/15">{f.icon}</span>
                  {f.text}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs text-white/60">© {new Date().getFullYear()} MIKROTAL</p>
        </div>
        <form onSubmit={submit} className="flex flex-col justify-center p-8 sm:p-12">
          <div className="mb-8 lg:hidden">
            <p className="text-2xl font-extrabold">
              MIKRO<span className="text-gradient">TAL</span>
            </p>
          </div>
          <h1 className="text-2xl font-bold">Masuk</h1>
          <p className="mt-1 text-sm text-muted">Gunakan akun administrator, operator, atau reseller.</p>
          <div className="mt-8 space-y-4">
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <Input className="h-11 pl-10" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <Input className="h-11 pl-10" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-500">{error}</p>}
            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!username || !password}>
              Masuk ke dashboard
            </Button>
          </div>
          <p className="mt-6 text-center text-xs text-subtle">
            Pelanggan ingin cek voucher?{' '}
            <a href="/cek" className="font-medium text-brand hover:underline">
              Cek status voucher
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
