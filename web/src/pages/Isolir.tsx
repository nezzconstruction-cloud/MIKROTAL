import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Search, ShieldAlert, Ticket, Wifi, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, formatMoney, timeLeft } from '../lib/format';
import { Button, Field, Input } from '../components/ui';

interface PubCustomer {
  username: string;
  name: string;
  package: string;
  price: number;
  status: 'active' | 'isolated' | 'disabled';
  expires_at: string | null;
  online: boolean;
}

const KEY = 'mikrotal.pppoe.username';

/** Halaman publik: pelanggan PPPoE mengecek masa aktif dan mengisi voucher sendiri (juga tujuan pengalihan isolir). */
export default function Isolir() {
  const [params] = useSearchParams();
  const isolirMode = useLocation().pathname.startsWith('/isolir');
  const [brand, setBrand] = useState<{ name: string; tagline: string; phone: string } | null>(null);
  const [username, setUsername] = useState(() => {
    try {
      return params.get('username') ?? localStorage.getItem(KEY) ?? '';
    } catch {
      return params.get('username') ?? '';
    }
  });
  const [code, setCode] = useState(params.get('code') ?? '');
  const [customer, setCustomer] = useState<PubCustomer | null>(null);
  const [done, setDone] = useState<{ package_name: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'check' | 'redeem' | null>(null);

  useEffect(() => {
    api('/api/public/brand').then(setBrand).catch(() => undefined);
    if (username) void check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remember = (u: string) => {
    try {
      localStorage.setItem(KEY, u);
    } catch {
      /* abaikan */
    }
  };

  async function check(silent = false) {
    if (!username.trim()) return;
    setBusy('check');
    setError('');
    setDone(null);
    try {
      setCustomer(await api<PubCustomer>(`/api/public/pppoe/${encodeURIComponent(username.trim())}`));
      remember(username.trim());
    } catch (err) {
      setCustomer(null);
      if (!silent) setError(err instanceof Error ? err.message : 'Gagal memeriksa akun');
    } finally {
      setBusy(null);
    }
  }

  async function redeem() {
    if (!username.trim() || !code.trim()) return;
    setBusy('redeem');
    setError('');
    setDone(null);
    try {
      const r = await api<{ customer: PubCustomer; voucher: { package_name: string } }>('/api/public/pppoe/redeem', { method: 'POST', body: { username: username.trim(), code: code.trim() } });
      setCustomer(r.customer);
      setDone(r.voucher);
      setCode('');
      remember(username.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengisi voucher');
    } finally {
      setBusy(null);
    }
  }

  const expired = customer?.status === 'isolated';

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -left-32 -top-32 size-96 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 size-96 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="bg-gradient-brand mx-auto flex size-14 items-center justify-center rounded-2xl text-white shadow-xl shadow-cyan-500/30">
            <Wifi className="size-7" />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold">{brand?.name ?? 'Isi Ulang Internet'}</h1>
          <p className="text-sm text-muted">Cek masa aktif dan isi ulang internet rumah Anda</p>
        </div>

        {(isolirMode || expired) && !done && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-500" />
            <div className="text-sm">
              <p className="font-bold">Masa aktif internet Anda sudah habis</p>
              <p className="mt-0.5 text-muted">Internet dibatasi sementara. Masukkan kode voucher di bawah ini untuk mengaktifkannya kembali.</p>
            </div>
          </div>
        )}

        <div className="card space-y-4 p-6">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void (code.trim() ? redeem() : check());
            }}
          >
            <Field label="Username PPPoE" hint="Tertera di kartu pelanggan atau tanyakan ke admin">
              <div className="flex gap-2">
                <Input className="h-11 font-mono" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoCapitalize="none" autoCorrect="off" />
                <Button type="button" variant="secondary" className="h-11" loading={busy === 'check'} icon={<Search className="size-4" />} onClick={() => check()}>
                  Cek
                </Button>
              </div>
            </Field>
            <Field label="Kode voucher">
              <Input className="h-12 text-center font-mono text-lg tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} placeholder="0000 0000 00" inputMode="text" autoCapitalize="characters" />
            </Field>
            <Button type="submit" size="lg" className="h-12 w-full" loading={busy === 'redeem'} disabled={!username.trim() || !code.trim()} icon={<Ticket className="size-4" />}>
              Isi ulang sekarang
            </Button>
          </form>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-500">
              <XCircle className="size-4 shrink-0" /> {error}
            </div>
          )}
          {done && (
            <div className="animate-in flex items-start gap-3 rounded-xl bg-emerald-500/10 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />
              <div>
                <p className="font-bold text-emerald-600 dark:text-emerald-400">Isi ulang berhasil — {done.package_name}</p>
                <p className="text-muted">Internet aktif kembali dalam 1–2 menit. Jika belum, matikan lalu hidupkan router Anda.</p>
              </div>
            </div>
          )}
          {customer && (
            <div className="animate-in space-y-3 rounded-xl bg-surface-2 p-4 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted">Pelanggan</span>
                <b>{customer.name}</b>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">Paket</span>
                <b>
                  {customer.package || '—'}
                  {customer.price > 0 && ` • ${formatMoney(customer.price)}`}
                </b>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">Status</span>
                <b className={customer.status === 'active' ? 'text-emerald-500' : customer.status === 'isolated' ? 'text-amber-500' : 'text-rose-500'}>
                  {customer.status === 'active' ? 'Aktif' : customer.status === 'isolated' ? 'Masa aktif habis' : 'Dinonaktifkan'}
                </b>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">Berlaku sampai</span>
                <b>
                  {customer.expires_at ? (
                    <>
                      {formatDate(customer.expires_at)} {customer.status === 'active' && <span className="text-amber-500">({timeLeft(customer.expires_at)})</span>}
                    </>
                  ) : (
                    'Tanpa batas'
                  )}
                </b>
              </div>
            </div>
          )}
        </div>
        {brand?.phone && (
          <p className="mt-4 text-center text-xs text-muted">
            Butuh bantuan atau beli voucher? Hubungi <b>{brand.phone}</b>
          </p>
        )}
      </div>
    </div>
  );
}
