import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Cloud, Lock, Network, Router as RouterIcon, ShieldCheck, Ticket, Users, Zap } from 'lucide-react';
import { formatMoney } from '../lib/format';
import { Button, Card, Field, Input, Loading, useAction } from '../components/ui';
import { pget, ppost } from './api';

interface Info {
  brandName: string;
  baseDomain: string;
  exampleUrl: string;
  plans: { code: string; name: string; price_monthly: number; max_routers: number; description: string }[];
  trialDays: number;
  trialMaxRouters: number;
  signupOpen: boolean;
  support: { whatsapp: string; email: string };
}

const FEATURES = [
  { icon: <Ticket className="size-5" />, title: 'Voucher hotspot', text: 'Generate, cetak, reseller dengan saldo, laporan penjualan, dan portal login.' },
  { icon: <Users className="size-5" />, title: 'Pelanggan PPPoE', text: 'Paket bulanan, voucher isi ulang, isolir otomatis, peta ODC/ODP.' },
  { icon: <RouterIcon className="size-5" />, title: 'Monitoring router', text: 'CPU, trafik, log, dan semua menu RouterOS dari browser.' },
  { icon: <Lock className="size-5" />, title: 'Tanpa IP publik', text: 'Router terhubung lewat VPN pribadi. Cukup tempel satu skrip di terminal.' },
];

function SignupForm({ info }: { info: Info }) {
  const [f, setF] = useState({ businessName: '', slug: '', ownerName: '', email: '', phone: '', username: 'admin', password: '' });
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugState, setSlugState] = useState<{ available: boolean; reason: string; url: string } | null>(null);
  const [done, setDone] = useState<{ url: string } | null>(null);
  const { run, busy } = useAction();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (slugEdited) return;
    const auto = f.businessName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
    setF((x) => ({ ...x, slug: /^[a-z]/.test(auto) ? auto : auto ? `wifi-${auto}`.slice(0, 30) : '' }));
  }, [f.businessName, slugEdited]);

  useEffect(() => {
    if (!f.slug) return setSlugState(null);
    const t = setTimeout(() => {
      pget<{ available: boolean; reason: string; url: string }>('/slug', { slug: f.slug })
        .then(setSlugState)
        .catch(() => setSlugState(null));
    }, 350);
    return () => clearTimeout(t);
  }, [f.slug]);

  if (done) {
    return (
      <Card className="p-6 text-center">
        <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
        <p className="mt-3 text-lg font-bold">Akun siap dipakai!</p>
        <p className="mt-1 text-sm text-muted">Masa uji coba {info.trialDays} hari dimulai. Simpan alamat MIKROTAL Anda:</p>
        <p className="mt-3 break-all rounded-xl bg-surface-2 p-3 font-mono text-sm">{done.url}</p>
        <a href={`${done.url}/login`} className="mt-4 inline-block">
          <Button size="lg">Buka MIKROTAL saya</Button>
        </a>
        <p className="mt-3 text-xs text-subtle">Login dengan username "{f.username}" dan password yang tadi Anda buat.</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <p className="text-lg font-bold">Coba gratis {info.trialDays} hari</p>
      <p className="mb-4 text-xs text-muted">Tanpa kartu kredit. {info.trialMaxRouters} router selama uji coba.</p>
      {!info.signupOpen ? (
        <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">Pendaftaran sedang ditutup.</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => setDone(await ppost<{ url: string }>('/signup', f)));
          }}
        >
          <Field label="Nama usaha" required>
            <Input value={f.businessName} onChange={(e) => set('businessName', e.target.value)} placeholder="mis. RT/RW Net Jaya" />
          </Field>
          <Field
            label="Alamat MIKROTAL Anda"
            required
            hint={slugState ? (slugState.available ? <span className="text-emerald-600 dark:text-emerald-400">{slugState.url} tersedia</span> : <span className="text-rose-500">{slugState.reason}</span>) : `alamat.${info.baseDomain}`}
          >
            <div className="flex items-center gap-1">
              <Input
                value={f.slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                }}
                placeholder="rtrw-jaya"
              />
              <span className="shrink-0 text-xs text-muted">.{info.baseDomain}</span>
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nama pemilik" required>
              <Input value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
            </Field>
            <Field label="WhatsApp" required>
              <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="08xxxxxxxxxx" inputMode="tel" />
            </Field>
          </div>
          <Field label="Email" required>
            <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Username login" required>
              <Input value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="username" />
            </Field>
            <Field label="Password" required hint="Minimal 8 karakter">
              <Input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={slugState?.available === false}>
            Daftar dan mulai uji coba
          </Button>
          <p className="text-center text-[11px] text-subtle">Dengan mendaftar Anda menyetujui aturan pemakaian di bawah.</p>
        </form>
      )}
    </Card>
  );
}

export function Landing() {
  const { data: info, isLoading } = useQuery({ queryKey: ['platform-info'], queryFn: () => pget<Info>('/info') });
  useEffect(() => {
    if (info) document.title = info.brandName;
  }, [info]);
  if (isLoading || !info) return <Loading />;
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-5">
        <div className="bg-gradient-brand flex size-9 items-center justify-center rounded-xl shadow-lg shadow-cyan-500/30">
          <Zap className="size-5 text-white" />
        </div>
        <p className="text-base font-extrabold tracking-tight">{info.brandName}</p>
        <div className="flex-1" />
        <a href="#harga" className="hidden text-sm text-muted hover:text-fg sm:block">
          Harga
        </a>
        <a href="#aturan" className="hidden text-sm text-muted hover:text-fg sm:block">
          Cara koneksi
        </a>
        <Link to="/admin" className="text-xs text-subtle hover:text-fg">
          Admin
        </Link>
      </header>

      <section className="mx-auto grid max-w-6xl items-start gap-8 px-4 pb-12 pt-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="pt-4">
          <p className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
            <Cloud className="size-3.5" /> Aplikasi online, tanpa instal server
          </p>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Kelola hotspot & RT/RW Net <span className="text-gradient">MikroTik</span> dari mana saja
          </h1>
          <p className="mt-4 max-w-xl text-muted">
            Voucher, pelanggan PPPoE, reseller, isolir otomatis, dan monitoring dalam satu aplikasi. Tidak perlu komputer menyala 24 jam dan tidak perlu IP publik: router terhubung lewat VPN pribadi ke server
            kami.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((x) => (
              <div key={x.title} className="flex gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-brand">{x.icon}</div>
                <div>
                  <p className="text-sm font-semibold">{x.title}</p>
                  <p className="text-xs text-muted">{x.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div id="daftar">
          <SignupForm info={info} />
        </div>
      </section>

      <section id="harga" className="border-t border-line bg-surface/50 py-12">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-2xl font-bold">Harga langganan</h2>
          <p className="mt-1 text-center text-sm text-muted">Bayar per bulan sesuai jumlah router. Bisa 1, 3, 6, atau 12 bulan sekaligus lewat transfer bank.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {info.plans.map((p) => (
              <Card key={p.code} className="p-6">
                <p className="font-bold">{p.name}</p>
                <p className="mt-2 text-3xl font-extrabold">
                  {formatMoney(p.price_monthly)}
                  <span className="text-sm font-normal text-muted"> /bulan</span>
                </p>
                <p className="mt-2 text-sm font-medium text-brand">Sampai {p.max_routers} router</p>
                <p className="mt-2 text-sm text-muted">{p.description}</p>
                <a href="#daftar">
                  <Button variant="secondary" className="mt-5 w-full">
                    Coba gratis
                  </Button>
                </a>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="aturan" className="py-12">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 lg:grid-cols-2">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Network className="size-5 text-brand" /> Cara router terhubung
            </h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted">
              <li>Daftar, lalu buka menu <b className="text-fg">Langganan & VPN</b> di aplikasi Anda.</li>
              <li>
                Klik <b className="text-fg">Hubungkan router</b> dan pilih versi RouterOS: v7 memakai WireGuard, v6 memakai L2TP/IPsec atau SSTP.
              </li>
              <li>Salin skrip yang muncul, tempel ke New Terminal di Winbox, tekan Enter.</li>
              <li>Router tersambung ke server VPN kami dan langsung muncul online di MIKROTAL.</li>
            </ol>
            <p className="mt-4 text-xs text-subtle">Router cukup punya akses internet biasa. Tidak perlu IP publik, port forwarding, atau DDNS.</p>
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <ShieldCheck className="size-5 text-brand" /> Aturan pemakaian
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted">
              <li>Satu akun untuk satu usaha. Jumlah router mengikuti paket.</li>
              <li>Skrip hanya membuat interface VPN, satu IP tunnel, satu rule firewall, dan satu user API yang hanya bisa login dari server kami. Internet pelanggan Anda tidak melewati server kami.</li>
              <li>Router antar pelanggan tidak bisa saling menjangkau. Data tiap akun disimpan terpisah.</li>
              <li>Pembayaran lewat transfer bank dengan kode unik. Langganan aktif setelah bukti transfer dikonfirmasi.</li>
              <li>Bila masa langganan habis ada masa tenggang beberapa hari. Setelah itu sinkronisasi voucher, isolir otomatis, dan monitoring berhenti sampai dibayar. Data tidak dihapus.</li>
              <li>Bisa berhenti kapan saja: putuskan VPN dan hapus konfigurasi berkomentar "MIKROTAL Cloud" di router.</li>
            </ul>
          </div>
        </div>
      </section>
      <footer className="border-t border-line py-6 text-center text-xs text-subtle">
        {info.brandName}
        {info.support.whatsapp && ` • WhatsApp ${info.support.whatsapp}`}
        {info.support.email && ` • ${info.support.email}`}
      </footer>
    </div>
  );
}
