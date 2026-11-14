import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Printer, Sparkles, Ticket, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { durationLabel, formatBytes, formatMoney } from '../lib/format';
import { Badge, Button, Card, CardHeader, Field, Input, Loading, PageHeader, Select, Toggle, useAction } from '../components/ui';
import { RequireRouter } from '../components/RequireRouter';

interface Profile {
  name: string;
  'rate-limit'?: string;
  meta: { price: number; reseller_price: number; validity: string; time_limit: string; data_limit: number };
}

const CHARSETS = [
  { value: 'alnum-upper', label: 'Huruf besar + angka (ABC234)', sample: 'K7MP4X' },
  { value: 'numeric', label: 'Angka saja (123456)', sample: '482913' },
  { value: 'upper', label: 'Huruf besar (ABCDEF)', sample: 'KXMPQR' },
  { value: 'lower', label: 'Huruf kecil (abcdef)', sample: 'kxmpqr' },
  { value: 'alnum-lower', label: 'Huruf kecil + angka (abc234)', sample: 'k7mp4x' },
  { value: 'alnum-mixed', label: 'Campuran (aB3dE5)', sample: 'k7MP4x' },
];

function GenerateBody({ routerId }: { routerId: number }) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isReseller = user?.role === 'reseller';
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get('/api/settings') });
  const profiles = useQuery({ queryKey: ['hs-profiles', routerId], queryFn: () => get<Profile[]>(`/api/routers/${routerId}/hotspot/profiles`) });
  const resellers = useQuery({ queryKey: ['resellers'], queryFn: () => get<any[]>('/api/resellers') });
  const servers = useQuery({ queryKey: ['res', routerId, '/ip/hotspot'], queryFn: () => get<any[]>(`/api/routers/${routerId}/res`, { path: '/ip/hotspot' }), enabled: !isReseller });
  const { run, busy } = useAction();
  const [result, setResult] = useState<{ batch: any; created: number; failed: number; errors: string[] } | null>(null);

  const [f, setF] = useState({
    profile: params.get('profile') ?? '',
    qty: 20,
    length: 6,
    charset: 'alnum-upper',
    prefix: '',
    mode: 'same' as 'same' | 'separate',
    passwordLength: 4,
    passwordCharset: 'numeric',
    price: '' as number | '',
    validity: '',
    timeLimit: '',
    dataLimit: '',
    server: 'all',
    resellerId: '' as number | '',
    note: '',
  });
  const [custom, setCustom] = useState(false);
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (settings.data) {
      setF((x) => ({ ...x, charset: settings.data.voucher.defaultCharset ?? x.charset, length: settings.data.voucher.defaultLength ?? x.length, prefix: x.prefix || settings.data.voucher.defaultPrefix || '' }));
    }
  }, [settings.data]);

  const list = (profiles.data ?? []).filter((p) => p.name !== 'default');
  const profile = list.find((p) => p.name === f.profile);
  useEffect(() => {
    if (!f.profile && list.length) set('profile', list[0].name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  const reseller = isReseller ? resellers.data?.[0] : resellers.data?.find((r) => r.id === f.resellerId);
  const price = custom && f.price !== '' ? Number(f.price) : profile?.meta.price ?? 0;
  const unitCost = reseller ? (profile?.meta.reseller_price && profile.meta.reseller_price > 0 ? profile.meta.reseller_price : price * (1 - (reseller.discount ?? 0) / 100)) : 0;
  const totalCost = unitCost * Number(f.qty || 0);
  const insufficient = reseller && totalCost > reseller.balance;
  const sample = useMemo(() => {
    const cs = CHARSETS.find((c) => c.value === f.charset)?.sample ?? 'ABC123';
    let s = '';
    while (s.length < f.length) s += cs;
    return `${f.prefix}${s.slice(0, f.length)}`;
  }, [f.charset, f.length, f.prefix]);

  const submit = async () => {
    const body: Record<string, unknown> = {
      routerId,
      profile: f.profile,
      qty: Number(f.qty),
      length: Number(f.length),
      charset: f.charset,
      prefix: f.prefix,
      mode: f.mode,
      passwordLength: Number(f.passwordLength),
      passwordCharset: f.passwordCharset,
      server: f.server,
      note: f.note,
      resellerId: f.resellerId || null,
    };
    if (custom) {
      if (f.price !== '') body.price = Number(f.price);
      body.validity = f.validity;
      body.timeLimit = f.timeLimit;
      if (f.dataLimit) body.dataLimit = f.dataLimit;
    }
    const r = await post('/api/vouchers/generate', body);
    setResult(r);
    void qc.invalidateQueries({ queryKey: ['vouchers'] });
    void qc.invalidateQueries({ queryKey: ['batches'] });
    void qc.invalidateQueries({ queryKey: ['resellers'] });
    void qc.invalidateQueries({ queryKey: ['hs-profiles', routerId] });
    return r;
  };

  if (profiles.isLoading) return <Loading />;

  return (
    <div>
      <PageHeader title="Buat Voucher" subtitle="Generate voucher hotspot massal langsung ke router, siap cetak" icon={<Ticket className="size-5" />} />
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Pilih paket" icon={<Sparkles className="size-4" />} />
          <div className="p-5">
            {!list.length ? (
              <p className="text-sm text-muted">Belum ada profil hotspot. Buat profil di menu Profil & Harga terlebih dahulu.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => set('profile', p.name)}
                    className={clsx('rounded-xl border p-4 text-left transition', f.profile === p.name ? 'border-brand bg-brand/5 ring-2 ring-brand/30' : 'border-line hover:border-brand/40')}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-mono font-bold">{p.name}</p>
                      {f.profile === p.name && <CheckCircle2 className="size-4 text-brand" />}
                    </div>
                    <p className="mt-1 text-lg font-extrabold">{formatMoney(isReseller ? (p.meta.reseller_price || p.meta.price * (1 - (reseller?.discount ?? 0) / 100)) : p.meta.price)}</p>
                    <p className="mt-1 text-xs text-muted">
                      {p['rate-limit'] || 'Unlimited'} • aktif {durationLabel(p.meta.validity)}
                      {p.meta.time_limit && ` • ${durationLabel(p.meta.time_limit)}`}
                      {p.meta.data_limit > 0 && ` • ${formatBytes(p.meta.data_limit)}`}
                    </p>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Jumlah voucher" required>
                <Input type="number" min={1} max={1000} value={f.qty} onChange={(e) => set('qty', e.target.value)} />
              </Field>
              <Field label="Panjang kode">
                <Input type="number" min={3} max={16} value={f.length} onChange={(e) => set('length', Number(e.target.value))} />
              </Field>
              <Field label="Prefix" hint="Opsional, mis. HS">
                <Input value={f.prefix} onChange={(e) => set('prefix', e.target.value.replace(/[^A-Za-z0-9-]/g, ''))} maxLength={10} />
              </Field>
              <Field label="Jenis karakter">
                <Select value={f.charset} onChange={(e) => set('charset', e.target.value)}>
                  {CHARSETS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Mode login" className="sm:col-span-2">
                <Select value={f.mode} onChange={(e) => set('mode', e.target.value)}>
                  <option value="same">Username = password (cukup ketik 1 kode)</option>
                  <option value="separate">Username & password berbeda</option>
                </Select>
              </Field>
              {f.mode === 'separate' && (
                <>
                  <Field label="Panjang password">
                    <Input type="number" min={3} max={16} value={f.passwordLength} onChange={(e) => set('passwordLength', Number(e.target.value))} />
                  </Field>
                  <Field label="Karakter password">
                    <Select value={f.passwordCharset} onChange={(e) => set('passwordCharset', e.target.value)}>
                      {CHARSETS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              )}
              {!isReseller && (
                <>
                  <Field label="Server hotspot">
                    <Select value={f.server} onChange={(e) => set('server', e.target.value)}>
                      <option value="all">Semua server</option>
                      {(servers.data ?? []).map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Untuk reseller" hint="Saldo reseller akan dipotong">
                    <Select value={f.resellerId} onChange={(e) => set('resellerId', e.target.value ? Number(e.target.value) : '')}>
                      <option value="">— Penjualan langsung —</option>
                      {(resellers.data ?? []).filter((r) => r.active).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({formatMoney(r.balance)})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Catatan" className="sm:col-span-2">
                    <Input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="mis. Stok warung Bu Sri" />
                  </Field>
                </>
              )}
            </div>

            {!isReseller && (
              <div className="mt-6 rounded-xl border border-line bg-surface-2 p-4">
                <Toggle checked={custom} onChange={setCustom} label="Ganti harga / masa aktif / batas untuk batch ini" />
                {custom && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-4">
                    <Field label="Harga">
                      <Input type="number" value={f.price} placeholder={String(profile?.meta.price ?? 0)} onChange={(e) => set('price', e.target.value === '' ? '' : Number(e.target.value))} />
                    </Field>
                    <Field label="Masa aktif">
                      <Input value={f.validity} placeholder={profile?.meta.validity || '1d'} onChange={(e) => set('validity', e.target.value)} />
                    </Field>
                    <Field label="Batas waktu">
                      <Input value={f.timeLimit} placeholder={profile?.meta.time_limit || 'mis. 3h'} onChange={(e) => set('timeLimit', e.target.value)} />
                    </Field>
                    <Field label="Batas kuota">
                      <Input value={f.dataLimit} placeholder="mis. 2G" onChange={(e) => set('dataLimit', e.target.value)} />
                    </Field>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="bg-gradient-brand p-5 text-white">
              <p className="text-xs uppercase tracking-widest text-white/70">Pratinjau voucher</p>
              <p className="mt-3 font-mono text-3xl font-bold tracking-widest">{sample}</p>
              {f.mode === 'separate' && <p className="mt-1 font-mono text-sm text-white/80">Password: {'•'.repeat(f.passwordLength)}</p>}
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-sm font-semibold">{f.profile || '—'}</p>
                  <p className="text-xs text-white/70">Aktif {durationLabel(custom && f.validity ? f.validity : profile?.meta.validity)}</p>
                </div>
                <p className="text-xl font-extrabold">{formatMoney(price)}</p>
              </div>
            </div>
            <div className="space-y-2 p-5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Jumlah</span>
                <b>{f.qty} voucher</b>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Nilai jual total</span>
                <b>{formatMoney(price * Number(f.qty || 0))}</b>
              </div>
              {reseller && (
                <>
                  <div className="flex justify-between border-t border-line pt-2">
                    <span className="flex items-center gap-1 text-muted">
                      <Wallet className="size-3.5" /> Saldo {reseller.name}
                    </span>
                    <b>{formatMoney(reseller.balance)}</b>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Dipotong ({formatMoney(unitCost)}/voucher)</span>
                    <b className={clsx(insufficient && 'text-rose-500')}>{formatMoney(totalCost)}</b>
                  </div>
                  {insufficient && <p className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-500">Saldo tidak mencukupi.</p>}
                </>
              )}
              <Button className="mt-3 w-full" size="lg" loading={busy} disabled={!f.profile || !f.qty || !!insufficient} onClick={() => run(submit)}>
                Generate {f.qty} voucher
              </Button>
              {busy && <p className="text-center text-xs text-muted">Menambahkan ke router, mohon tunggu...</p>}
            </div>
          </Card>

          {result && (
            <Card className="animate-in border-emerald-500/40 p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="size-6 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{result.created} voucher berhasil dibuat</p>
                  <p className="text-xs text-muted">
                    Batch <span className="font-mono">{result.batch.code}</span>
                    {result.failed > 0 && <Badge tone="red" className="ml-2">{result.failed} gagal</Badge>}
                  </p>
                  {result.errors.length > 0 && <p className="mt-1 text-xs text-rose-500">{result.errors[0]}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" icon={<Printer className="size-4" />} onClick={() => window.open(`/print?batchId=${result.batch.id}`, '_blank')}>
                      Cetak sekarang
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => navigate(`/vouchers?batchId=${result.batch.id}`)}>
                      Lihat daftar
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VoucherGenerate() {
  return <RequireRouter>{(id) => <GenerateBody key={id} routerId={id} />}</RequireRouter>;
}
