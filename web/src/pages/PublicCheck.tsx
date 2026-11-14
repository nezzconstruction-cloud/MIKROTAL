import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, Database, Search, Wifi, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { durationLabel, formatBytes, formatDate, formatMoney, humanDuration, timeLeft } from '../lib/format';
import { Button, Input } from '../components/ui';

interface Result {
  code: string;
  profile: string;
  status: string;
  price: number;
  validity: string;
  activated_at: string | null;
  expires_at: string | null;
  time_limit: string;
  time_used: number;
  time_left: number | null;
  data_limit: number;
  data_used: number;
}

const STATUS: Record<string, { label: string; color: string; ok: boolean }> = {
  unused: { label: 'Belum digunakan', color: 'text-cyan-500', ok: true },
  active: { label: 'Sedang online', color: 'text-emerald-500', ok: true },
  used: { label: 'Aktif (sudah dipakai)', color: 'text-violet-500', ok: true },
  expired: { label: 'Sudah habis', color: 'text-rose-500', ok: false },
  removed: { label: 'Tidak berlaku', color: 'text-rose-500', ok: false },
  disabled: { label: 'Diblokir', color: 'text-amber-500', ok: false },
};

export default function PublicCheck() {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [brand, setBrand] = useState<{ name: string; tagline: string; phone: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/public/brand').then(setBrand).catch(() => undefined);
    if (params.get('code')) void check(params.get('code')!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function check(c: string) {
    if (!c.trim()) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await api<Result>(`/api/public/voucher/${encodeURIComponent(c.trim())}`));
      setParams({ code: c.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memeriksa voucher');
    } finally {
      setBusy(false);
    }
  }

  const st = result ? STATUS[result.status] ?? { label: result.status, color: '', ok: false } : null;

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -left-32 -top-32 size-96 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 size-96 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="bg-gradient-brand mx-auto flex size-14 items-center justify-center rounded-2xl text-white shadow-xl shadow-cyan-500/30">
            <Wifi className="size-7" />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold">{brand?.name ?? 'Cek Voucher'}</h1>
          <p className="text-sm text-muted">{brand?.tagline ?? 'Periksa sisa masa aktif voucher Anda'}</p>
        </div>
        <div className="card p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void check(code);
            }}
            className="flex gap-2"
          >
            <Input className="h-12 text-center font-mono text-lg tracking-widest" placeholder="KODE VOUCHER" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            <Button type="submit" size="lg" className="h-12" loading={busy} icon={<Search className="size-4" />}>
              Cek
            </Button>
          </form>
          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-500">
              <XCircle className="size-4" /> {error}
            </div>
          )}
          {result && st && (
            <div className="animate-in mt-6">
              <div className="flex items-center gap-3">
                {st.ok ? <CheckCircle2 className={`size-10 ${st.color}`} /> : <XCircle className={`size-10 ${st.color}`} />}
                <div>
                  <p className="font-mono text-xl font-bold tracking-wider">{result.code}</p>
                  <p className={`text-sm font-semibold ${st.color}`}>{st.label}</p>
                </div>
              </div>
              <div className="mt-5 space-y-3 rounded-xl bg-surface-2 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Paket</span>
                  <b>
                    {result.profile} • {formatMoney(result.price)}
                  </b>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Masa aktif</span>
                  <b>{durationLabel(result.validity)}</b>
                </div>
                {result.activated_at && (
                  <div className="flex justify-between">
                    <span className="text-muted">Mulai dipakai</span>
                    <b>{formatDate(result.activated_at)}</b>
                  </div>
                )}
                {result.expires_at && (
                  <div className="flex justify-between">
                    <span className="flex items-center gap-1 text-muted">
                      <Clock className="size-3.5" /> Berlaku sampai
                    </span>
                    <b>
                      {formatDate(result.expires_at)} <span className="text-amber-500">({timeLeft(result.expires_at)})</span>
                    </b>
                  </div>
                )}
                {result.time_left !== null && (
                  <div className="flex justify-between">
                    <span className="text-muted">Sisa waktu pakai</span>
                    <b>{humanDuration(result.time_left, 2)}</b>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="flex items-center gap-1 text-muted">
                    <Database className="size-3.5" /> Kuota terpakai
                  </span>
                  <b>
                    {formatBytes(result.data_used)}
                    {result.data_limit > 0 && ` / ${formatBytes(result.data_limit)}`}
                  </b>
                </div>
              </div>
            </div>
          )}
        </div>
        {brand?.phone && (
          <p className="mt-4 text-center text-xs text-muted">
            Butuh bantuan? Hubungi <b>{brand.phone}</b>
          </p>
        )}
      </div>
    </div>
  );
}
