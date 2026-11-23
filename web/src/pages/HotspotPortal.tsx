import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, ImagePlus, LayoutTemplate, Monitor, Plus, RotateCcw, Save, Smartphone, Tablet, Trash2, Upload, X } from 'lucide-react';
import clsx from 'clsx';
import { ApiError, download, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { durationLabel, formatDate, formatMoney } from '../lib/format';
import { RequireRouter } from '../components/RequireRouter';
import { Badge, Button, Card, ErrorBox, Field, IconButton, Input, Loading, PageHeader, Select, Tabs, Textarea, Toggle, useAction, useFeedback } from '../components/ui';

type Preset = 'aurora' | 'glass' | 'minimal' | 'neon' | 'sunset';
interface PortalConfig {
  preset: Preset;
  theme: 'dark' | 'light' | 'auto';
  color1: string;
  color2: string;
  name: string;
  tagline: string;
  logo: string;
  background: string;
  loginMode: 'voucher' | 'member' | 'both';
  trial: boolean;
  qrScan: boolean;
  redirectUrl: string;
  redirectDelay: number;
  announcement: { enabled: boolean; text: string; style: 'marquee' | 'banner' };
  promos: { badge: string; title: string; text: string }[];
  showPrices: boolean;
  hiddenProfiles: string[];
  faq: { q: string; a: string }[];
  rules: string;
  whatsapp: string;
  waMessage: string;
  phone: string;
  address: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  website: string;
  cekVoucher: boolean;
  pppoeTopup: boolean;
  bilingual: boolean;
  showUsage: boolean;
  footer: string;
}
interface PortalData {
  config: PortalConfig;
  install: { profile: string; dir: string; previousDir: string; baseUrl: string; at: string; by: string } | null;
  hotspot: { servers: { name: string; interface: string; profile: string; disabled: boolean }[]; profiles: { name: string; htmlDirectory: string; dnsName: string }[] } | { error: string };
  baseUrl: string;
  prices: { profile: string; price: number; validity: string; speed: string }[];
}
interface InstallResult {
  dir: string;
  previousDir: string;
  files: { name: string; size: number }[];
  steps: string[];
  warnings: string[];
}

const PRESETS: { id: Preset; name: string; desc: string }[] = [
  { id: 'aurora', name: 'Aurora', desc: 'Cahaya warna bergerak lembut' },
  { id: 'glass', name: 'Glass', desc: 'Kartu kaca buram, cocok dengan foto latar' },
  { id: 'minimal', name: 'Minimal', desc: 'Bersih dan ringan' },
  { id: 'neon', name: 'Neon', desc: 'Garis grid dan cahaya neon' },
  { id: 'sunset', name: 'Sunset', desc: 'Pita warna lebar di bagian atas' },
];
const PALETTES: [string, string][] = [
  ['#06b6d4', '#6366f1'],
  ['#22c55e', '#0ea5e9'],
  ['#f97316', '#ec4899'],
  ['#8b5cf6', '#ec4899'],
  ['#ef4444', '#f59e0b'],
  ['#0f766e', '#14b8a6'],
  ['#2563eb', '#1e3a8a'],
  ['#eab308', '#f97316'],
];
const PAGES = [
  { value: 'login.html|normal', label: 'Login' },
  { value: 'login.html|error', label: 'Login gagal' },
  { value: 'alogin.html|normal', label: 'Berhasil' },
  { value: 'status.html|normal', label: 'Status' },
  { value: 'logout.html|normal', label: 'Keluar' },
  { value: 'error.html|normal', label: 'Kendala' },
] as const;
const DEVICES = { phone: { w: 390, h: 800, icon: Smartphone, label: 'HP' }, tablet: { w: 820, h: 1080, icon: Tablet, label: 'Tablet' }, desktop: { w: 1366, h: 860, icon: Monitor, label: 'Desktop' } } as const;

/** Perkecil gambar di browser sebelum disimpan, agar muat di memori router. */
async function resizeImage(file: File, maxW: number, type: 'image/png' | 'image/jpeg', maxBytes: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Berkas bukan gambar yang bisa dibaca'));
      i.src = url;
    });
    let w = Math.min(maxW, img.naturalWidth);
    for (let attempt = 0; attempt < 6; attempt++) {
      const h = Math.round((img.naturalHeight / img.naturalWidth) * w);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      const out = c.toDataURL(type, type === 'image/jpeg' ? 0.8 - attempt * 0.08 : undefined);
      if ((out.length * 3) / 4 <= maxBytes) return out;
      w = Math.round(w * 0.8);
    }
    throw new Error(`Gambar terlalu besar walau sudah diperkecil (maks ${Math.round(maxBytes / 1024)} KB)`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Seg<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div className="grid gap-1 rounded-xl border border-line bg-surface-2 p-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it) => (
        <button key={it.value} type="button" onClick={() => onChange(it.value)} className={clsx('rounded-lg px-2 py-1.5 text-xs font-medium transition', value === it.value ? 'bg-surface text-fg shadow-sm dark:bg-elevated' : 'text-muted hover:text-fg')}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-3 border-b border-line pb-5 last:border-0 last:pb-0">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function ImageField({ label, value, hint, onPick, onClear, round }: { label: string; value: string; hint: string; onPick: (f: File) => void; onClear: () => void; round?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      <div className="flex items-center gap-3">
        <div className={clsx('flex size-16 shrink-0 items-center justify-center overflow-hidden border border-line bg-surface-2', round ? 'rounded-2xl' : 'w-24 rounded-xl')}>
          {value ? <img src={value} alt="" className={clsx('size-full', round ? 'bg-white object-contain' : 'object-cover')} /> : <ImagePlus className="size-5 text-subtle" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" icon={<Upload className="size-3.5" />} onClick={() => ref.current?.click()}>
            {value ? 'Ganti' : 'Unggah'}
          </Button>
          {value && (
            <Button type="button" size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={onClear}>
              Hapus
            </Button>
          )}
        </div>
        <input
          ref={ref}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = '';
          }}
        />
      </div>
      <p className="mt-1 text-[11px] text-subtle">{hint}</p>
    </div>
  );
}

function ListEditor<T extends Record<string, string>>({ items, max, onChange, fields, addLabel, empty }: { items: T[]; max: number; onChange: (v: T[]) => void; fields: { key: keyof T; label: string; ph?: string; long?: boolean; max: number }[]; addLabel: string; empty: T }) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="relative space-y-2 rounded-xl border border-line bg-surface-2 p-3 pr-10">
          <IconButton title="Hapus" tone="danger" className="absolute right-1.5 top-1.5" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 className="size-3.5" />
          </IconButton>
          {fields.map((f) =>
            f.long ? (
              <Textarea key={String(f.key)} rows={2} maxLength={f.max} className="text-sm" placeholder={f.ph ?? f.label} value={it[f.key]} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x)))} />
            ) : (
              <Input key={String(f.key)} maxLength={f.max} placeholder={f.ph ?? f.label} value={it[f.key]} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x)))} />
            ),
          )}
        </div>
      ))}
      {items.length < max && (
        <Button type="button" size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => onChange([...items, { ...empty }])}>
          {addLabel}
        </Button>
      )}
      {!items.length && <p className="text-xs text-subtle">Belum ada. Bagian ini tidak ditampilkan.</p>}
    </div>
  );
}

function Preview({ routerId, config, baseUrl }: { routerId: number; config: PortalConfig; baseUrl: string }) {
  const [page, setPage] = useState<(typeof PAGES)[number]['value']>('login.html|normal');
  const [device, setDevice] = useState<keyof typeof DEVICES>('phone');
  const [html, setHtml] = useState('');
  const [size, setSize] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(600);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const [p, state] = page.split('|');
        const r = await post<{ html: string; size: number }>(`/api/routers/${routerId}/portal/preview`, { config, page: p, state, baseUrl });
        if (ac.signal.aborted) return;
        setHtml(r.html);
        setSize(r.size);
        setErr('');
      } catch (e) {
        if (!ac.signal.aborted) setErr(e instanceof ApiError ? e.message : String(e));
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [routerId, config, page, baseUrl]);

  const d = DEVICES[device];
  const scale = Math.min(1, (boxW - 32) / (d.w + 16));
  return (
    <Card className="overflow-hidden xl:sticky xl:top-20">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="max-w-full overflow-x-auto">
          <Tabs value={page} onChange={setPage} items={PAGES.map((p) => ({ value: p.value, label: p.label }))} />
        </div>
        <div className="flex items-center gap-1">
          {(Object.keys(DEVICES) as (keyof typeof DEVICES)[]).map((k) => {
            const I = DEVICES[k].icon;
            return (
              <IconButton key={k} title={DEVICES[k].label} onClick={() => setDevice(k)} className={clsx(device === k && 'bg-surface-2 text-brand')}>
                <I className="size-4" />
              </IconButton>
            );
          })}
        </div>
      </div>
      <div ref={box} className="relative flex justify-center overflow-hidden bg-surface-2 p-4" style={{ height: d.h * scale + 48 }}>
        <div style={{ width: d.w + 16, height: d.h + 16, transform: `scale(${scale})`, transformOrigin: 'top center' }} className={clsx('shrink-0 overflow-hidden border-8 border-slate-800 bg-black shadow-2xl', device === 'phone' ? 'rounded-[2.2rem]' : 'rounded-2xl')}>
          {html && <iframe title="Pratinjau portal" srcDoc={html} sandbox="allow-scripts" className="block border-0 bg-white" style={{ width: d.w, height: d.h }} />}
        </div>
        {loading && <span className="absolute right-6 top-6 rounded-full bg-slate-900/80 px-2.5 py-1 text-[11px] text-white">Memperbarui…</span>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[11px] text-muted">
        <span>Pratinjau memakai data contoh. Login tidak dikirim ke router.</span>
        <span>{size ? `${page.split('|')[0]} • ${(size / 1024).toFixed(1)} KB` : ''}</span>
      </div>
      {err && <p className="border-t border-line px-4 py-2 text-xs text-rose-500">{err}</p>}
    </Card>
  );
}

function InstallPanel({ routerId, data, config, dirty, onInstalled }: { routerId: number; data: PortalData; config: PortalConfig; dirty: boolean; onInstalled: () => void }) {
  const { can } = useAuth();
  const { confirm, toast } = useFeedback();
  const { run, busy } = useAction();
  const hs = 'error' in data.hotspot ? null : data.hotspot;
  const defProfile = data.install?.profile ?? hs?.servers.find((s) => !s.disabled)?.profile ?? hs?.profiles.find((p) => p.name !== 'default')?.name ?? '';
  const [profile, setProfile] = useState(defProfile);
  const [baseUrl, setBaseUrl] = useState(data.install?.baseUrl ?? data.baseUrl);
  const [allowWa, setAllowWa] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; steps: string[]; warnings?: string[]; message?: string } | null>(null);
  const prof = hs?.profiles.find((p) => p.name === profile);
  const usedBy = hs?.servers.filter((s) => s.profile === profile).map((s) => s.name) ?? [];
  const write = can('hotspot.write');

  const install = async () => {
    if (
      !(await confirm({
        title: `Pasang portal ke profil ${profile}?`,
        message: `Router akan mengunduh ${data.install ? 'ulang ' : ''}halaman portal dari ${baseUrl} ke folder baru, lalu profil ${profile} diarahkan ke folder itu. Folder halaman lama (${prof?.htmlDirectory || 'hotspot'}) tidak diubah dan bisa dipakai kembali kapan saja.${usedBy.length ? ` Server hotspot yang memakai profil ini: ${usedBy.join(', ')}.` : ''}`,
        confirmText: 'Pasang sekarang',
      }))
    )
      return;
    setResult(null);
    try {
      const r = await post<InstallResult>(`/api/routers/${routerId}/portal/install`, { config, profile, baseUrl, allowWhatsapp: allowWa });
      setResult({ ok: true, steps: r.steps, warnings: r.warnings });
      toast('success', 'Portal terpasang', `Halaman login baru aktif di ${r.dir}.`);
      onInstalled();
    } catch (e) {
      setResult({ ok: false, steps: e instanceof ApiError ? e.data?.steps ?? [] : [], message: e instanceof Error ? e.message : String(e) });
    }
  };

  const rollback = async () => {
    if (!data.install) return;
    if (!(await confirm({ title: 'Kembalikan halaman login lama?', message: `Profil ${data.install.profile} diarahkan kembali ke folder ${data.install.previousDir}. Berkas portal MIKROTAL tetap tersimpan di router.`, confirmText: 'Kembalikan', danger: true })))
      return;
    const r = await run(() => post(`/api/routers/${routerId}/portal/rollback`), 'Halaman login lama dipakai kembali');
    if (r) {
      setResult(null);
      onInstalled();
    }
  };

  if (!hs) return <ErrorBox error={new Error(`Data hotspot tidak bisa dibaca dari router: ${(data.hotspot as { error: string }).error}`)} />;
  return (
    <div className="space-y-5">
      {data.install ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Terpasang di profil {data.install.profile}</p>
            <p className="text-xs text-muted">
              Folder <span className="font-mono">{data.install.dir}</span> • {formatDate(data.install.at)} oleh {data.install.by}. Folder lama: <span className="font-mono">{data.install.previousDir}</span>
            </p>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">Belum dipasang. Router masih memakai halaman login lamanya.</p>
      )}
      {!hs.profiles.length ? (
        <p className="text-sm text-muted">Router ini belum punya server hotspot. Buat dulu lewat menu Hotspot › Server Hotspot.</p>
      ) : (
        <>
          <Field label="Profil server hotspot" hint={prof ? `Folder halaman sekarang: ${prof.htmlDirectory || 'hotspot'}${usedBy.length ? ` • dipakai ${usedBy.join(', ')}` : ' • belum dipakai server mana pun'}` : undefined}>
            <Select value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="">— pilih profil —</option>
              {hs.profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {hs.servers.some((s) => s.profile === p.name) ? ` (${hs.servers.filter((s) => s.profile === p.name).map((s) => s.name).join(', ')})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Alamat server MIKROTAL" hint="Dipakai router untuk mengunduh halaman, dan oleh pelanggan untuk membuka halaman cek voucher. Biasanya IP LAN komputer MIKROTAL beserta port-nya.">
            <Input className="font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://192.168.88.10:8080" />
          </Field>
          <div className="space-y-2">
            <Toggle checked={allowWa} onChange={setAllowWa} label="Izinkan WhatsApp sebelum login" />
            <p className="text-[11px] text-subtle">
              Menambah wa.me, *.whatsapp.com, dan *.whatsapp.net ke walled garden supaya tombol "Beli via WhatsApp" bisa dipakai pelanggan yang belum login. Artinya WhatsApp juga bisa dipakai gratis tanpa voucher.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">
            <p className="mb-1 font-semibold text-fg">Yang terjadi saat dipasang</p>
            <ol className="list-decimal space-y-0.5 pl-4">
              <li>Profil {profile || '…'} diarahkan ke folder baru <span className="font-mono">{prof ? (prof.htmlDirectory.includes('/') ? prof.htmlDirectory.slice(0, prof.htmlDirectory.lastIndexOf('/') + 1) : '') + 'mikrotal-portal' : 'mikrotal-portal'}</span>. Folder lama tidak diubah.</li>
              <li>Router mengunduh {config.background ? '6' : '5'} berkas dari server MIKROTAL dengan /tool fetch.</li>
              <li>Ukuran berkas di router diperiksa. Bila gagal, profil otomatis dikembalikan ke folder lama.</li>
              {(config.cekVoucher || config.pppoeTopup) && <li>IP server MIKROTAL ditambahkan ke walled garden agar halaman cek voucher bisa dibuka sebelum login.</li>}
            </ol>
          </div>
          {dirty && <p className="text-xs text-amber-500">Ada perubahan yang belum disimpan. Perubahan ikut disimpan saat dipasang.</p>}
          {write && (
            <div className="flex flex-wrap gap-2">
              <Button icon={<Upload className="size-4" />} loading={busy} disabled={!profile || !baseUrl} onClick={() => run(install)}>
                {data.install ? 'Pasang ulang ke router' : 'Pasang ke router'}
              </Button>
              {data.install && (
                <Button variant="secondary" icon={<RotateCcw className="size-4" />} disabled={busy} onClick={rollback}>
                  Kembalikan halaman lama
                </Button>
              )}
            </div>
          )}
          {result && (
            <div className={clsx('rounded-xl border p-3 text-xs', result.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5')}>
              <p className={clsx('mb-1 font-semibold', result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>{result.ok ? 'Berhasil dipasang' : 'Gagal dipasang'}</p>
              {result.message && <p className="mb-1 text-rose-600 dark:text-rose-400">{result.message}</p>}
              <ul className="list-disc space-y-0.5 pl-4 text-muted">
                {result.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
                {result.warnings?.map((s, i) => (
                  <li key={`w${i}`} className="text-amber-500">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="border-t border-line pt-4">
        <p className="text-xs text-muted">Pasang manual lewat Winbox? Unduh semua berkas beserta petunjuknya.</p>
        <Button className="mt-2" size="sm" variant="secondary" icon={<Download className="size-3.5" />} onClick={() => run(() => download(`/api/routers/${routerId}/portal/download`, { baseUrl }, 'mikrotal-portal.zip').then(() => true))}>
          Unduh ZIP
        </Button>
      </div>
    </div>
  );
}

function Editor({ routerId, data }: { routerId: number; data: PortalData }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const { run, busy } = useAction();
  const [c, setC] = useState<PortalConfig>(data.config);
  const [saved, setSaved] = useState(JSON.stringify(data.config));
  const [tab, setTab] = useState<'look' | 'login' | 'content' | 'contact' | 'install'>('look');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<any>('/api/settings') });
  const dirty = JSON.stringify(c) !== saved;
  const set = <K extends keyof PortalConfig>(k: K, v: PortalConfig[K]) => setC((x) => ({ ...x, [k]: v }));
  const write = can('hotspot.write');
  const brand = settings.data?.brand ?? {};

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const save = () =>
    run(async () => {
      const r = await put<{ config: PortalConfig }>(`/api/routers/${routerId}/portal`, { config: c });
      setSaved(JSON.stringify(r.config));
      return true;
    }, 'Desain portal disimpan');

  const pick = (k: 'logo' | 'background') => async (f: File) => {
    try {
      const url = k === 'logo' ? await resizeImage(f, 256, 'image/png', 95_000) : await resizeImage(f, 1600, 'image/jpeg', 290_000);
      set(k, url);
    } catch (e) {
      toast('error', 'Gambar tidak bisa dipakai', (e as Error).message);
    }
  };

  const previewConfig = useMemo(() => c, [c]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Portal Login Hotspot"
        subtitle="Rancang halaman login hotspot, lihat hasilnya, lalu pasang langsung ke router"
        icon={<LayoutTemplate className="size-5" />}
        actions={
          <>
            {data.install ? <Badge tone="green">Terpasang • {data.install.profile}</Badge> : <Badge>Belum dipasang</Badge>}
            {write && (
              <Button variant={dirty ? 'primary' : 'secondary'} icon={<Save className="size-4" />} loading={busy} disabled={!dirty} onClick={save}>
                {dirty ? 'Simpan' : 'Tersimpan'}
              </Button>
            )}
            {write && (
              <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setTab('install')}>
                Pasang ke router
              </Button>
            )}
          </>
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[440px_minmax(0,1fr)]">
        <Card className="min-w-0">
          <div className="overflow-x-auto border-b border-line px-4 py-3">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: 'look', label: 'Tampilan' },
                { value: 'login', label: 'Login' },
                { value: 'content', label: 'Konten' },
                { value: 'contact', label: 'Kontak' },
                { value: 'install', label: 'Pasang' },
              ]}
            />
          </div>
          <fieldset disabled={!write} className="space-y-5 p-4">
            {tab === 'look' && (
              <>
                <Section title="Gaya">
                  <div className="grid grid-cols-2 gap-2">
                    {PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => set('preset', p.id)}
                        className={clsx('overflow-hidden rounded-xl border text-left transition', c.preset === p.id ? 'border-brand ring-2 ring-brand/30' : 'border-line hover:border-brand/40')}
                      >
                        <div className="relative h-14 overflow-hidden" style={{ background: p.id === 'minimal' ? '#eef2f8' : p.id === 'sunset' ? `linear-gradient(160deg, ${c.color1}, ${c.color2})` : '#070b14' }}>
                          {p.id === 'aurora' && (
                            <>
                              <span className="absolute -left-3 -top-4 size-14 rounded-full opacity-70 blur-lg" style={{ background: c.color1 }} />
                              <span className="absolute -right-2 top-2 size-12 rounded-full opacity-70 blur-lg" style={{ background: c.color2 }} />
                            </>
                          )}
                          {p.id === 'neon' && <span className="absolute inset-0 opacity-40" style={{ backgroundImage: 'linear-gradient(#334155 1px,transparent 1px),linear-gradient(90deg,#334155 1px,transparent 1px)', backgroundSize: '10px 10px' }} />}
                          {p.id === 'glass' && <span className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${c.color1}66, ${c.color2}66)` }} />}
                          <span className={clsx('absolute bottom-2 left-1/2 h-6 w-16 -translate-x-1/2 rounded-md border', p.id === 'minimal' ? 'border-slate-300 bg-white' : 'border-white/25 bg-white/10 backdrop-blur')} style={p.id === 'neon' ? { borderColor: c.color1, boxShadow: `0 0 10px ${c.color1}` } : undefined} />
                        </div>
                        <div className="px-2.5 py-2">
                          <p className="text-xs font-semibold">{p.name}</p>
                          <p className="text-[10px] leading-tight text-muted">{p.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                  <Field label="Tema">
                    <Seg value={c.theme} onChange={(v) => set('theme', v)} items={[{ value: 'dark', label: 'Gelap' }, { value: 'light', label: 'Terang' }, { value: 'auto', label: 'Ikuti HP' }]} />
                  </Field>
                </Section>
                <Section title="Warna">
                  <div className="flex flex-wrap gap-2">
                    {PALETTES.map(([a, b]) => (
                      <button key={a + b} type="button" title={`${a} → ${b}`} onClick={() => setC((x) => ({ ...x, color1: a, color2: b }))} className={clsx('size-8 rounded-full border-2 transition', c.color1 === a && c.color2 === b ? 'border-fg' : 'border-transparent')} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Warna utama">
                      <div className="flex gap-2">
                        <Input type="color" className="h-[38px] w-12 shrink-0 p-1" value={c.color1} onChange={(e) => set('color1', e.target.value)} />
                        <Input className="font-mono text-xs" value={c.color1} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && set('color1', e.target.value)} />
                      </div>
                    </Field>
                    <Field label="Warna kedua">
                      <div className="flex gap-2">
                        <Input type="color" className="h-[38px] w-12 shrink-0 p-1" value={c.color2} onChange={(e) => set('color2', e.target.value)} />
                        <Input className="font-mono text-xs" value={c.color2} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && set('color2', e.target.value)} />
                      </div>
                    </Field>
                  </div>
                </Section>
                <Section title="Identitas">
                  <Field label="Nama hotspot" hint="Kosong = nama usaha di Pengaturan">
                    <Input maxLength={40} value={c.name} onChange={(e) => set('name', e.target.value)} placeholder={brand.name ?? 'MIKROTAL'} />
                  </Field>
                  <Field label="Slogan">
                    <Input maxLength={80} value={c.tagline} onChange={(e) => set('tagline', e.target.value)} />
                  </Field>
                  <ImageField label="Logo" value={c.logo} round hint="PNG/JPG/WEBP, otomatis diperkecil ke 256 px." onPick={pick('logo')} onClear={() => set('logo', '')} />
                  <ImageField label="Foto latar" value={c.background} hint="Opsional. Diperkecil otomatis (maks ±290 KB) dan disimpan sebagai berkas terpisah di router." onPick={pick('background')} onClear={() => set('background', '')} />
                </Section>
              </>
            )}

            {tab === 'login' && (
              <>
                <Section title="Cara login" hint="Voucher: cukup satu kolom kode. Member: username dan password terpisah.">
                  <Seg value={c.loginMode} onChange={(v) => set('loginMode', v)} items={[{ value: 'voucher', label: 'Voucher' }, { value: 'member', label: 'Member' }, { value: 'both', label: 'Keduanya' }]} />
                  <div className="space-y-3 pt-1">
                    <Toggle checked={c.qrScan} onChange={(v) => set('qrScan', v)} label="Tombol pindai QR voucher (pakai kamera HP)" />
                    <Toggle checked={c.trial} onChange={(v) => set('trial', v)} label="Tombol coba gratis (bila trial aktif di profil server)" />
                    <Toggle checked={c.bilingual} onChange={(v) => set('bilingual', v)} label="Tombol bahasa Indonesia / English" />
                  </div>
                  <p className="text-[11px] text-subtle">QR yang dicetak MIKROTAL di voucher langsung login otomatis saat dipindai. Login CHAP ditangani di halaman ini, tidak butuh md5.js.</p>
                </Section>
                <Section title="Setelah login">
                  <Field label="Buka halaman" hint="Kosong = halaman yang tadi ingin dibuka pelanggan">
                    <Input value={c.redirectUrl} onChange={(e) => set('redirectUrl', e.target.value.trim())} placeholder="https://www.google.com" />
                  </Field>
                  <Field label={`Hitung mundur: ${c.redirectDelay} detik`}>
                    <input type="range" min={0} max={15} value={c.redirectDelay} onChange={(e) => set('redirectDelay', Number(e.target.value))} className="w-full accent-cyan-500" />
                  </Field>
                  <Toggle checked={c.showUsage} onChange={(v) => set('showUsage', v)} label="Halaman status menampilkan pemakaian data, IP, dan MAC" />
                </Section>
              </>
            )}

            {tab === 'content' && (
              <>
                <Section title="Pengumuman">
                  <Toggle checked={c.announcement.enabled} onChange={(v) => set('announcement', { ...c.announcement, enabled: v })} label="Tampilkan pengumuman" />
                  {c.announcement.enabled && (
                    <>
                      <Seg value={c.announcement.style} onChange={(v) => set('announcement', { ...c.announcement, style: v })} items={[{ value: 'marquee', label: 'Teks berjalan' }, { value: 'banner', label: 'Banner diam' }]} />
                      <Textarea rows={2} maxLength={300} className="text-sm" value={c.announcement.text} onChange={(e) => set('announcement', { ...c.announcement, text: e.target.value })} placeholder="Promo akhir pekan: voucher 1 hari cuma Rp4.000!" />
                    </>
                  )}
                </Section>
                <Section title="Kartu promo" hint="Bergeser otomatis di bawah nama hotspot. Maksimal 6.">
                  <ListEditor
                    items={c.promos}
                    max={6}
                    onChange={(v) => set('promos', v)}
                    addLabel="Tambah promo"
                    empty={{ badge: '', title: '', text: '' }}
                    fields={[
                      { key: 'badge', label: 'Label kecil (mis. Baru)', max: 20 },
                      { key: 'title', label: 'Judul', max: 50 },
                      { key: 'text', label: 'Keterangan', max: 160, long: true },
                    ]}
                  />
                </Section>
                <Section title="Daftar harga" hint="Diambil dari menu Hotspot › Profil & Harga (profil yang punya harga).">
                  <Toggle checked={c.showPrices} onChange={(v) => set('showPrices', v)} label="Tampilkan daftar harga" />
                  {c.showPrices &&
                    (data.prices.length ? (
                      <div className="divide-y divide-line rounded-xl border border-line">
                        {data.prices.map((p) => {
                          const shown = !c.hiddenProfiles.includes(p.profile);
                          return (
                            <label key={p.profile} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                              <input type="checkbox" checked={shown} onChange={() => set('hiddenProfiles', shown ? [...c.hiddenProfiles, p.profile] : c.hiddenProfiles.filter((x) => x !== p.profile))} />
                              <span className="flex-1 font-medium">{p.profile}</span>
                              <span className="text-xs text-muted">
                                {formatMoney(p.price)} • {durationLabel(p.validity)}
                                {p.speed ? ` • ${p.speed}` : ''}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-subtle">Belum ada profil hotspot yang diberi harga.</p>
                    ))}
                </Section>
                <Section title="Pertanyaan umum (FAQ)">
                  <ListEditor
                    items={c.faq}
                    max={10}
                    onChange={(v) => set('faq', v)}
                    addLabel="Tambah pertanyaan"
                    empty={{ q: '', a: '' }}
                    fields={[
                      { key: 'q', label: 'Pertanyaan', max: 120 },
                      { key: 'a', label: 'Jawaban', max: 500, long: true },
                    ]}
                  />
                </Section>
                <Section title="Ketentuan pemakaian" hint="Satu baris satu poin.">
                  <Textarea rows={4} maxLength={1500} className="text-sm" value={c.rules} onChange={(e) => set('rules', e.target.value)} />
                </Section>
                <Section title="Teks kaki halaman">
                  <Input maxLength={120} value={c.footer} onChange={(e) => set('footer', e.target.value)} placeholder={`© ${new Date().getFullYear()} ${c.name || brand.name || 'Hotspot'}`} />
                </Section>
              </>
            )}

            {tab === 'contact' && (
              <>
                <Section title="WhatsApp penjualan" hint="Tombol Beli di tiap paket membuka WhatsApp dengan pesan otomatis.">
                  <Field label="Nomor WhatsApp" hint="Kosong = nomor di Pengaturan">
                    <Input maxLength={20} value={c.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder={brand.phone || '08xxxxxxxxxx'} />
                  </Field>
                  <Field label="Pesan otomatis" hint="{paket} diganti nama paket yang dipilih">
                    <Input maxLength={200} value={c.waMessage} onChange={(e) => set('waMessage', e.target.value)} />
                  </Field>
                </Section>
                <Section title="Kontak & media sosial">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Telepon">
                      <Input maxLength={30} value={c.phone} onChange={(e) => set('phone', e.target.value)} />
                    </Field>
                    <Field label="Instagram">
                      <Input maxLength={60} value={c.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder="@namausaha" />
                    </Field>
                    <Field label="TikTok">
                      <Input maxLength={60} value={c.tiktok} onChange={(e) => set('tiktok', e.target.value)} placeholder="@namausaha" />
                    </Field>
                    <Field label="Facebook">
                      <Input maxLength={100} value={c.facebook} onChange={(e) => set('facebook', e.target.value)} placeholder="namahalaman atau URL" />
                    </Field>
                    <Field label="Website" className="sm:col-span-2">
                      <Input maxLength={100} value={c.website} onChange={(e) => set('website', e.target.value)} />
                    </Field>
                    <Field label="Alamat" className="sm:col-span-2">
                      <Input maxLength={200} value={c.address} onChange={(e) => set('address', e.target.value)} />
                    </Field>
                  </div>
                  <p className="text-[11px] text-subtle">Tautan media sosial baru bisa dibuka setelah pelanggan login, kecuali situsnya ditambahkan ke walled garden.</p>
                </Section>
                <Section title="Tautan ke MIKROTAL">
                  <Toggle checked={c.cekVoucher} onChange={(v) => set('cekVoucher', v)} label="Tombol cek sisa voucher (halaman /cek)" />
                  <Toggle checked={c.pppoeTopup} onChange={(v) => set('pppoeTopup', v)} label="Tombol isi ulang internet rumah PPPoE (halaman /isi)" />
                </Section>
              </>
            )}

            {tab === 'install' && <InstallPanel routerId={routerId} data={data} config={c} dirty={dirty} onInstalled={() => {
              setSaved(JSON.stringify(c));
              void qc.invalidateQueries({ queryKey: ['portal', routerId] });
            }} />}
          </fieldset>
        </Card>
        <Preview routerId={routerId} config={previewConfig} baseUrl={data.install?.baseUrl ?? data.baseUrl} />
      </div>
    </div>
  );
}

function Inner({ routerId }: { routerId: number }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['portal', routerId], queryFn: () => get<PortalData>(`/api/routers/${routerId}/portal`) });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} onRetry={() => refetch()} />;
  return <Editor key={`${routerId}`} routerId={routerId} data={data} />;
}

export default function HotspotPortal() {
  return <RequireRouter>{(routerId) => <Inner key={routerId} routerId={routerId} />}</RequireRouter>;
}
