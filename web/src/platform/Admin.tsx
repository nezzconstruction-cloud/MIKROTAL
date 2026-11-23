import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BadgeCheck, Building2, CreditCard, FileText, KeyRound, LayoutDashboard, LogOut, Package, Plus, ScrollText, Server, Settings, Trash2, Zap } from 'lucide-react';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import { PHASE_LABEL, PHASE_TONE, type Phase } from '../lib/cloud';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, Select, StatCard, Tabs, Textarea, Toggle, useAction, useFeedback } from '../components/ui';
import { getAdminToken, pblobUrl, pget, ppatch, ppost, pput, setAdminToken, setPlatformUnauthorized } from './api';

// ---------------- login & tata letak ----------------

export function AdminLogin() {
  const nav = useNavigate();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const { run, busy } = useAction();
  if (getAdminToken()) return <Navigate to="/admin" replace />;
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="bg-gradient-brand flex size-9 items-center justify-center rounded-xl">
            <Zap className="size-5 text-white" />
          </div>
          <div>
            <p className="font-bold">Admin Platform</p>
            <p className="text-xs text-muted">MIKROTAL Cloud</p>
          </div>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await ppost<{ token: string }>('/admin/login', { username: u, password: p });
              setAdminToken(r.token);
              nav('/admin', { replace: true });
            });
          }}
        >
          <Field label="Username">
            <Input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus />
          </Field>
          <Field label="Password">
            <Input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            Masuk
          </Button>
        </form>
      </Card>
    </div>
  );
}

const LINKS = [
  { to: '/admin', label: 'Ringkasan', icon: <LayoutDashboard className="size-4" />, end: true },
  { to: '/admin/invoices', label: 'Pembayaran', icon: <CreditCard className="size-4" /> },
  { to: '/admin/tenants', label: 'Pelanggan', icon: <Building2 className="size-4" /> },
  { to: '/admin/plans', label: 'Paket', icon: <Package className="size-4" /> },
  { to: '/admin/settings', label: 'Pengaturan & VPN', icon: <Settings className="size-4" /> },
  { to: '/admin/audit', label: 'Audit', icon: <ScrollText className="size-4" /> },
];

export function AdminLayout() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const logout = () => {
    setAdminToken(null);
    qc.clear();
    nav('/admin/login', { replace: true });
  };
  useEffect(() => {
    setPlatformUnauthorized(logout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!getAdminToken()) return <Navigate to="/admin/login" replace />;
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="border-b border-line bg-surface/60 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="bg-gradient-brand flex size-8 items-center justify-center rounded-lg">
            <Zap className="size-4 text-white" />
          </div>
          <p className="text-sm font-bold">Admin Platform</p>
          <div className="flex-1" />
          <IconButton title="Keluar" onClick={logout} className="lg:hidden">
            <LogOut className="size-4" />
          </IconButton>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                clsx('flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px]', isActive ? 'bg-brand/10 font-medium text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg')
              }
            >
              {l.icon}
              {l.label}
            </NavLink>
          ))}
          <button onClick={logout} className="mt-4 hidden items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-muted hover:bg-surface-2 hover:text-fg lg:flex">
            <LogOut className="size-4" /> Keluar
          </button>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-3 sm:p-5 lg:p-6">
        <Outlet />
      </main>
    </div>
  );
}

// ---------------- ringkasan ----------------

interface Overview {
  tenants: number;
  phases: Partial<Record<Phase, number>>;
  mrr: number;
  paidThisMonth: number;
  paidCountThisMonth: number;
  invoicesToReview: number;
  vpn: { available: string[]; kinds: Record<string, string[]> };
}

export function AdminOverview() {
  const { data, error, isLoading } = useQuery({ queryKey: ['p-overview'], queryFn: () => pget<Overview>('/admin/overview'), refetchInterval: 30_000 });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  return (
    <div className="space-y-5">
      <PageHeader title="Ringkasan" icon={<LayoutDashboard className="size-5" />} />
      {data.invoicesToReview > 0 && (
        <NavLink to="/admin/invoices" className="flex items-center gap-3 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-sm">
          <BadgeCheck className="size-5 text-cyan-500" /> {data.invoicesToReview} bukti transfer menunggu diperiksa
        </NavLink>
      )}
      {!data.vpn.available.length && (
        <NavLink to="/admin/settings" className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <Server className="size-5 text-amber-500" /> Server VPN (CHR) belum siap. Pelanggan belum bisa menghubungkan router.
        </NavLink>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pelanggan" value={formatNumber(data.tenants)} icon={<Building2 className="size-5" />} sub={`${data.phases.active ?? 0} aktif • ${data.phases.trial ?? 0} uji coba`} />
        <StatCard label="Pendapatan bulanan (MRR)" value={formatMoney(data.mrr)} icon={<CreditCard className="size-5" />} tone="green" />
        <StatCard label="Diterima bulan ini" value={formatMoney(data.paidThisMonth)} icon={<BadgeCheck className="size-5" />} tone="violet" sub={`${data.paidCountThisMonth} pembayaran`} />
        <StatCard label="Perlu perhatian" value={formatNumber((data.phases.grace ?? 0) + (data.phases.expired ?? 0))} icon={<FileText className="size-5" />} tone="orange" sub={`${data.phases.grace ?? 0} tenggang • ${data.phases.expired ?? 0} berhenti`} />
      </div>
    </div>
  );
}

// ---------------- pembayaran ----------------

interface PInvoice {
  id: number;
  number: string;
  slug: string;
  business_name: string;
  plan_name: string;
  months: number;
  amount: number;
  unique_code: number;
  status: 'pending' | 'review' | 'paid' | 'rejected' | 'cancelled';
  has_proof: boolean;
  payer_name: string;
  payer_note: string;
  reject_reason: string;
  reviewed_by: string;
  created_at: string;
  submitted_at: string | null;
  paid_at: string | null;
}

const INV_TONE = { pending: 'yellow', review: 'cyan', paid: 'green', rejected: 'red', cancelled: 'gray' } as const;
const INV_LABEL = { pending: 'Menunggu transfer', review: 'Perlu diperiksa', paid: 'Lunas', rejected: 'Ditolak', cancelled: 'Batal' } as const;

function ProofModal({ inv, onClose, onDone }: { inv: PInvoice; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(false);
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  useEffect(() => {
    let u: string | null = null;
    if (inv.has_proof)
      void pblobUrl(`/admin/invoices/${inv.id}/proof`).then(async (x) => {
        u = x;
        const blob = await fetch(x).then((r) => r.blob());
        setIsPdf(blob.type === 'application/pdf');
        setUrl(x);
      });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [inv]);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Tagihan ${inv.number}`}
      footer={
        inv.status === 'review' || inv.status === 'pending' ? (
          <>
            <Input className="max-w-xs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan bila ditolak" />
            <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => run(async () => (await ppost(`/admin/invoices/${inv.id}/reject`, { reason }), onDone()), 'Ditolak')}>
              Tolak
            </Button>
            <Button variant="success" loading={busy} onClick={() => run(async () => (await ppost(`/admin/invoices/${inv.id}/confirm`), onDone()), 'Pembayaran dikonfirmasi')}>
              Konfirmasi lunas
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="space-y-2 text-sm">
          <p>
            <span className="text-muted">Pelanggan:</span> <b>{inv.business_name}</b> ({inv.slug})
          </p>
          <p>
            <span className="text-muted">Paket:</span> {inv.plan_name} • {inv.months} bulan
          </p>
          <p className="text-2xl font-extrabold tabular-nums">{formatMoney(inv.amount)}</p>
          <p className="text-xs text-muted">Kode unik {inv.unique_code}. Cocokkan dengan mutasi rekening.</p>
          <p>
            <span className="text-muted">Pengirim:</span> {inv.payer_name || '-'}
          </p>
          {inv.payer_note && <p className="text-xs text-muted">Catatan: {inv.payer_note}</p>}
          <p className="text-xs text-muted">Dikirim {formatDate(inv.submitted_at)}</p>
          {inv.reject_reason && <p className="text-xs text-rose-500">Ditolak: {inv.reject_reason}</p>}
        </div>
        <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-xl bg-surface-2">
          {!inv.has_proof ? (
            <p className="text-xs text-muted">Belum ada bukti transfer</p>
          ) : !url ? (
            <Loading />
          ) : isPdf ? (
            <a href={url} target="_blank" rel="noreferrer" className="text-sm text-brand">
              Buka PDF bukti transfer
            </a>
          ) : (
            <a href={url} target="_blank" rel="noreferrer">
              <img src={url} alt="Bukti transfer" className="max-h-[60vh] object-contain" />
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function AdminInvoices() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'review' | 'pending' | 'paid' | ''>('review');
  const { data, error, isLoading } = useQuery({ queryKey: ['p-invoices', status], queryFn: () => pget<PInvoice[]>('/admin/invoices', { status: status || undefined }) });
  const [open, setOpen] = useState<PInvoice | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader title="Pembayaran" subtitle="Cocokkan nominal (termasuk kode unik) dengan mutasi rekening, lalu konfirmasi." icon={<CreditCard className="size-5" />} />
      <Tabs
        value={status}
        onChange={setStatus}
        items={[
          { value: 'review', label: 'Perlu diperiksa' },
          { value: 'pending', label: 'Menunggu transfer' },
          { value: 'paid', label: 'Lunas' },
          { value: '', label: 'Semua' },
        ]}
      />
      <Card className="overflow-hidden">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !data?.length ? (
          <EmptyState icon={<CreditCard className="size-6" />} title="Tidak ada tagihan" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-subtle">
                <tr>
                  <th className="px-5 py-2">Tagihan</th>
                  <th className="px-3 py-2">Pelanggan</th>
                  <th className="px-3 py-2 text-right">Nominal</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.map((i) => (
                  <tr key={i.id} className="border-t border-line">
                    <td className="px-5 py-2.5">
                      <p className="font-mono text-xs">{i.number}</p>
                      <p className="text-xs text-muted">
                        {i.plan_name} • {i.months} bln • {formatDate(i.created_at)}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{i.business_name}</p>
                      <p className="text-xs text-muted">{i.slug}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatMoney(i.amount)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={INV_TONE[i.status]}>{INV_LABEL[i.status]}</Badge>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Button size="sm" variant={i.status === 'review' ? 'primary' : 'secondary'} onClick={() => setOpen(i)}>
                        {i.status === 'review' ? 'Periksa' : 'Detail'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && (
        <ProofModal
          inv={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            void qc.invalidateQueries({ queryKey: ['p-invoices'] });
            void qc.invalidateQueries({ queryKey: ['p-overview'] });
          }}
        />
      )}
    </div>
  );
}

// ---------------- pelanggan ----------------

interface PTenant {
  id: number;
  slug: string;
  business_name: string;
  owner_name: string;
  email: string;
  phone: string;
  status: 'active' | 'suspended';
  suspended_reason: string;
  notes: string;
  trial: number;
  period_end: string;
  created_at: string;
  url: string;
  state: { phase: Phase; planName: string; planCode: string; maxRouters: number; daysLeft: number };
  routers: number;
  routersOnline: number;
  vpnPeers: number;
}

function TenantModal({ t, plans, onClose, onSaved }: { t: PTenant; plans: { code: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { run, busy } = useAction();
  const { confirm } = useFeedback();
  const [plan, setPlan] = useState(t.state.planCode);
  const [notes, setNotes] = useState(t.notes);
  const [reason, setReason] = useState(t.suspended_reason);
  const [extend, setExtend] = useState(7);
  const [pw, setPw] = useState('');
  const [del, setDel] = useState('');
  const save = (body: Record<string, unknown>, msg: string) => run(async () => (await ppatch(`/admin/tenants/${t.id}`, body), onSaved()), msg);
  return (
    <Modal open onClose={onClose} size="lg" title={`${t.business_name} (${t.slug})`}>
      <div className="space-y-5 text-sm">
        <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
          <p>Pemilik: <b className="text-fg">{t.owner_name}</b></p>
          <p>WhatsApp: <a className="text-brand" href={`https://wa.me/${t.phone.replace(/\D/g, '').replace(/^0/, '62')}`} target="_blank" rel="noreferrer">{t.phone}</a></p>
          <p>Email: {t.email}</p>
          <p>Daftar: {formatDate(t.created_at, false)}</p>
          <p>Masa berlaku: {formatDate(t.period_end, false)} ({t.state.daysLeft} hari)</p>
          <p>Router: {t.routers} ({t.routersOnline} online) • VPN {t.vpnPeers}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Paket">
            <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="secondary" loading={busy} onClick={() => save({ plan_code: plan, trial: false }, 'Paket diubah')}>
            Simpan paket (bukan uji coba)
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Tambah masa aktif (hari)" hint="Mis. kompensasi gangguan, atau pembayaran di luar sistem. Negatif untuk mengurangi.">
            <Input type="number" value={extend} onChange={(e) => setExtend(Number(e.target.value))} />
          </Field>
          <Button variant="secondary" loading={busy} onClick={() => save({ extend_days: extend }, 'Masa aktif diubah')}>
            Tambah hari
          </Button>
        </div>
        <Field label="Catatan admin">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== t.notes && void save({ notes }, 'Catatan disimpan')} />
        </Field>
        <div className="rounded-xl border border-line p-3">
          {t.status === 'suspended' ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 text-xs text-rose-500">Dihentikan: {t.suspended_reason || '-'}</p>
              <Button variant="success" loading={busy} onClick={() => save({ status: 'active' }, 'Akun diaktifkan')}>
                Aktifkan kembali
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="Hentikan sementara (alasan)">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. penyalahgunaan" />
              </Field>
              <Button variant="danger" loading={busy} onClick={async () => (await confirm({ title: 'Hentikan akun?', message: 'Pelanggan hanya bisa login & membuka halaman Langganan. Tugas otomatis berhenti.', danger: true })) && save({ status: 'suspended', suspended_reason: reason }, 'Akun dihentikan')}>
                Hentikan
              </Button>
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Reset password pemilik" hint="Untuk pemilik yang lupa password. Kirim password baru lewat WhatsApp.">
            <Input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="password baru (min 8)" />
          </Field>
          <Button variant="secondary" icon={<KeyRound className="size-4" />} loading={busy} disabled={pw.length < 8} onClick={() => run(async () => { const r = await ppost<{ username: string }>(`/admin/tenants/${t.id}/reset-password`, { password: pw }); setPw(''); return r; }, 'Password direset')}>
            Reset
          </Button>
        </div>
        <div className="rounded-xl border border-rose-500/30 p-3">
          <p className="text-xs text-muted">Hapus akun: koneksi VPN diputus dan alamat tidak bisa dibuka. Data disimpan di server (folder data/tenants/{t.slug}) dan bisa dipulihkan manual.</p>
          <div className="mt-2 flex gap-2">
            <Input value={del} onChange={(e) => setDel(e.target.value)} placeholder={`ketik ${t.slug}`} />
            <Button variant="danger" icon={<Trash2 className="size-4" />} disabled={del !== t.slug} loading={busy} onClick={() => run(async () => (await ppost(`/admin/tenants/${t.id}/delete`, { confirm: del }), onSaved(), onClose()), 'Akun dihapus')}>
              Hapus
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function AdminTenants() {
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: ['p-tenants'], queryFn: () => pget<PTenant[]>('/admin/tenants') });
  const { data: plans } = useQuery({ queryKey: ['p-plans'], queryFn: () => pget<{ code: string; name: string }[]>('/admin/plans') });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<PTenant | null>(null);
  const rows = (data ?? []).filter((t) => !q || `${t.slug} ${t.business_name} ${t.owner_name} ${t.email} ${t.phone}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-5">
      <PageHeader title="Pelanggan" subtitle={`${data?.length ?? 0} akun`} icon={<Building2 className="size-5" />} actions={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari..." className="w-56" />} />
      <Card className="overflow-hidden">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !rows.length ? (
          <EmptyState icon={<Building2 className="size-6" />} title="Belum ada pelanggan" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-subtle">
                <tr>
                  <th className="px-5 py-2">Usaha</th>
                  <th className="px-3 py-2">Paket</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Berlaku s.d.</th>
                  <th className="px-3 py-2 text-right">Router</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="px-5 py-2.5">
                      <a href={t.url} target="_blank" rel="noreferrer" className="font-medium hover:text-brand">
                        {t.business_name}
                      </a>
                      <p className="text-xs text-muted">
                        {t.slug} • {t.owner_name} • {t.phone}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">{t.state.planName}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={PHASE_TONE[t.state.phase]} dot>
                        {PHASE_LABEL[t.state.phase]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {formatDate(t.period_end, false)}
                      <p className="text-muted">{t.state.daysLeft >= 0 ? `${t.state.daysLeft} hari lagi` : `lewat ${-t.state.daysLeft} hari`}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {t.routersOnline}/{t.routers}
                      <span className="text-subtle"> (maks {t.state.maxRouters})</span>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setOpen(t)}>
                        Kelola
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && (
        <TenantModal
          t={open}
          plans={plans ?? []}
          onClose={() => setOpen(null)}
          onSaved={async () => {
            await qc.invalidateQueries({ queryKey: ['p-tenants'] });
            const fresh = qc.getQueryData<PTenant[]>(['p-tenants'])?.find((x) => x.id === open.id);
            if (fresh) setOpen(fresh);
          }}
        />
      )}
    </div>
  );
}

// ---------------- paket ----------------

interface PPlan {
  id?: number;
  code: string;
  name: string;
  price_monthly: number;
  max_routers: number;
  description: string;
  active: boolean;
  sort: number;
}

export function AdminPlans() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['p-plans'], queryFn: () => pget<PPlan[]>('/admin/plans') });
  const [edit, setEdit] = useState<PPlan | null>(null);
  const { run, busy } = useAction();
  const save = async () => {
    if (!edit) return;
    if (edit.id) await pput(`/admin/plans/${edit.id}`, edit);
    else await ppost('/admin/plans', edit);
    await qc.invalidateQueries({ queryKey: ['p-plans'] });
    setEdit(null);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Paket"
        subtitle="Harga baru berlaku untuk tagihan berikutnya."
        icon={<Package className="size-5" />}
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEdit({ code: '', name: '', price_monthly: 0, max_routers: 1, description: '', active: true, sort: (data?.length ?? 0) + 1 })}>
            Paket baru
          </Button>
        }
      />
      {isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((p) => (
            <Card key={p.id} className={clsx('p-5', !p.active && 'opacity-60')}>
              <div className="flex items-center gap-2">
                <p className="flex-1 font-bold">{p.name}</p>
                {!p.active && <Badge>Nonaktif</Badge>}
                <span className="font-mono text-xs text-subtle">{p.code}</span>
              </div>
              <p className="mt-1 text-2xl font-extrabold">{formatMoney(p.price_monthly)}<span className="text-xs font-normal text-muted"> /bulan</span></p>
              <p className="text-sm text-brand">Maks {p.max_routers} router</p>
              <p className="mt-1 text-xs text-muted">{p.description}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => setEdit(p)}>
                Ubah
              </Button>
            </Card>
          ))}
        </div>
      )}
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={edit.id ? `Ubah paket ${edit.name}` : 'Paket baru'}
          footer={
            <Button loading={busy} onClick={() => run(save, 'Paket disimpan')}>
              Simpan
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kode" hint="huruf kecil, tidak bisa diubah">
              <Input value={edit.code} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
            </Field>
            <Field label="Nama">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Harga per bulan (Rp)">
              <Input type="number" value={edit.price_monthly} onChange={(e) => setEdit({ ...edit, price_monthly: Number(e.target.value) })} />
            </Field>
            <Field label="Maks router">
              <Input type="number" value={edit.max_routers} onChange={(e) => setEdit({ ...edit, max_routers: Number(e.target.value) })} />
            </Field>
            <Field label="Deskripsi" className="sm:col-span-2">
              <Textarea rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </Field>
            <Field label="Urutan">
              <Input type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) })} />
            </Field>
            <div className="flex items-end pb-2">
              <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Ditawarkan" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------- pengaturan & CHR ----------------

interface PSettings {
  brandName: string;
  supportWhatsapp: string;
  supportEmail: string;
  trialDays: number;
  trialMaxRouters: number;
  graceDays: number;
  invoiceDays: number;
  bankAccounts: { bank: string; number: string; holder: string }[];
  paymentNote: string;
  demoForNewTenants: boolean;
  signupOpen: boolean;
  chr: {
    host: string;
    port: number;
    username: string;
    tls: boolean;
    simulate: boolean;
    endpoint: string;
    wgInterface: string;
    wgPort: number;
    wgPublicKey: string;
    pppProfile: string;
    sstpPort: number;
    tunnelNetwork: string;
    hasPassword: boolean;
    hasIpsecSecret: boolean;
  };
}

export function AdminSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['p-settings'], queryFn: () => pget<PSettings>('/admin/settings') });
  const [f, setF] = useState<PSettings | null>(null);
  const [chrPassword, setChrPassword] = useState('');
  const [steps, setSteps] = useState<{ step: string; ok: boolean; detail?: string }[] | null>(null);
  const { run, busy } = useAction();
  const chrAction = useAction();
  const { toast } = useFeedback();
  useEffect(() => {
    if (data) setF(data);
  }, [data]);
  if (isLoading || !f) return <Loading />;
  const set = <K extends keyof PSettings>(k: K, v: PSettings[K]) => setF({ ...f, [k]: v });
  const setChr = <K extends keyof PSettings['chr']>(k: K, v: PSettings['chr'][K]) => setF({ ...f, chr: { ...f.chr, [k]: v } });
  const save = async () => {
    const { hasPassword, hasIpsecSecret, wgPublicKey, ...chr } = f.chr;
    await pput('/admin/settings', { ...f, chr: { ...chr, ...(chrPassword ? { password: chrPassword } : {}) } });
    setChrPassword('');
    await qc.invalidateQueries({ queryKey: ['p-settings'] });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Pengaturan & VPN" icon={<Settings className="size-5" />} actions={<Button loading={busy} onClick={() => run(save, 'Pengaturan disimpan')}>Simpan</Button>} />
      <Card>
        <CardHeader title="Umum & langganan" />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Nama layanan">
            <Input value={f.brandName} onChange={(e) => set('brandName', e.target.value)} />
          </Field>
          <Field label="WhatsApp bantuan">
            <Input value={f.supportWhatsapp} onChange={(e) => set('supportWhatsapp', e.target.value)} />
          </Field>
          <Field label="Email bantuan">
            <Input value={f.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} />
          </Field>
          <Field label="Lama uji coba (hari)">
            <Input type="number" value={f.trialDays} onChange={(e) => set('trialDays', Number(e.target.value))} />
          </Field>
          <Field label="Router selama uji coba">
            <Input type="number" value={f.trialMaxRouters} onChange={(e) => set('trialMaxRouters', Number(e.target.value))} />
          </Field>
          <Field label="Masa tenggang (hari)" hint="Setelah langganan habis, sebelum layanan berhenti">
            <Input type="number" value={f.graceDays} onChange={(e) => set('graceDays', Number(e.target.value))} />
          </Field>
          <Field label="Batas bayar tagihan (hari)">
            <Input type="number" value={f.invoiceDays} onChange={(e) => set('invoiceDays', Number(e.target.value))} />
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <Toggle checked={f.signupOpen} onChange={(v) => set('signupOpen', v)} label="Pendaftaran dibuka" />
            <Toggle checked={f.demoForNewTenants} onChange={(v) => set('demoForNewTenants', v)} label="Router simulasi untuk pelanggan baru" />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Rekening transfer"
          subtitle="Ditampilkan di tagihan pelanggan"
          actions={
            <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => set('bankAccounts', [...f.bankAccounts, { bank: '', number: '', holder: '' }])}>
              Tambah
            </Button>
          }
        />
        <div className="space-y-3 p-5">
          {!f.bankAccounts.length && <p className="text-xs text-amber-600 dark:text-amber-400">Belum ada rekening. Pelanggan belum bisa membuat tagihan.</p>}
          {f.bankAccounts.map((b, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[140px_1fr_1fr_auto]">
              <Input value={b.bank} placeholder="Bank (BCA)" onChange={(e) => set('bankAccounts', f.bankAccounts.map((x, j) => (j === i ? { ...x, bank: e.target.value } : x)))} />
              <Input value={b.number} placeholder="Nomor rekening" onChange={(e) => set('bankAccounts', f.bankAccounts.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} />
              <Input value={b.holder} placeholder="Atas nama" onChange={(e) => set('bankAccounts', f.bankAccounts.map((x, j) => (j === i ? { ...x, holder: e.target.value } : x)))} />
              <IconButton title="Hapus" tone="danger" onClick={() => set('bankAccounts', f.bankAccounts.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          ))}
          <Field label="Catatan pembayaran">
            <Textarea rows={2} value={f.paymentNote} onChange={(e) => set('paymentNote', e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Server VPN (MikroTik CHR)"
          subtitle="Router pelanggan tersambung ke CHR; MIKROTAL mengatur CHR lewat API. Lihat docs/CLOUD.md."
          icon={<Server className="size-4" />}
          actions={
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" loading={chrAction.busy} onClick={() => chrAction.run(async () => { await save(); const r = await ppost<{ identity: string; version: string }>('/admin/chr/test'); toast('success', `Tersambung ke ${r.identity}`, `RouterOS ${r.version}`); })}>
                Uji koneksi
              </Button>
              <Button size="sm" loading={chrAction.busy} onClick={() => chrAction.run(async () => { await save(); const r = await ppost<{ steps: typeof steps }>('/admin/chr/setup'); setSteps(r.steps); await qc.invalidateQueries({ queryKey: ['p-settings'] }); })}>
                Siapkan CHR
              </Button>
            </div>
          }
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Alamat API CHR" hint="Dari sisi server MIKROTAL, mis. IP lokal VM CHR">
            <Input value={f.chr.host} onChange={(e) => setChr('host', e.target.value)} placeholder="172.30.0.2" />
          </Field>
          <Field label="Port API">
            <Input type="number" value={f.chr.port} onChange={(e) => setChr('port', Number(e.target.value))} />
          </Field>
          <Field label="User API CHR">
            <Input value={f.chr.username} onChange={(e) => setChr('username', e.target.value)} />
          </Field>
          <Field label="Password API CHR" hint={f.chr.hasPassword ? 'Tersimpan. Isi untuk mengganti.' : 'Belum diisi'}>
            <Input type="password" value={chrPassword} onChange={(e) => setChrPassword(e.target.value)} />
          </Field>
          <Field label="Endpoint publik VPN" hint="Nama domain/IP CHR yang dituju router pelanggan">
            <Input value={f.chr.endpoint} onChange={(e) => setChr('endpoint', e.target.value)} placeholder="vpn.domain-anda.id" />
          </Field>
          <Field label="Jaringan tunnel" hint="Tidak bisa diubah setelah ada router terhubung">
            <Input value={f.chr.tunnelNetwork} onChange={(e) => setChr('tunnelNetwork', e.target.value)} />
          </Field>
          <Field label="Port WireGuard">
            <Input type="number" value={f.chr.wgPort} onChange={(e) => setChr('wgPort', Number(e.target.value))} />
          </Field>
          <Field label="Port SSTP">
            <Input type="number" value={f.chr.sstpPort} onChange={(e) => setChr('sstpPort', Number(e.target.value))} />
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <Toggle checked={f.chr.tls} onChange={(v) => setChr('tls', v)} label="API-SSL (port 8729)" />
            <Toggle checked={f.chr.simulate} onChange={(v) => setChr('simulate', v)} label="CHR simulasi (uji coba tanpa CHR)" />
          </div>
          <p className="text-xs text-muted sm:col-span-2 lg:col-span-3">
            WireGuard public key: <span className="break-all font-mono text-fg">{f.chr.wgPublicKey || 'belum ada (jalankan Siapkan CHR)'}</span> • IPsec secret L2TP: {f.chr.hasIpsecSecret ? 'tersimpan' : 'belum ada'}
          </p>
        </div>
        {steps && (
          <ul className="space-y-1 border-t border-line p-5 text-xs">
            {steps.map((s) => (
              <li key={s.step} className={s.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {s.ok ? '✓' : '!'} {s.step}
                {s.detail ? `: ${s.detail}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ChangePassword />
    </div>
  );
}

function ChangePassword() {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const { run, busy } = useAction();
  return (
    <Card>
      <CardHeader title="Password admin platform" icon={<KeyRound className="size-4" />} />
      <div className="grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Password lama">
          <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label="Password baru" hint="Minimal 10 karakter">
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Button loading={busy} disabled={!cur || pw.length < 10} onClick={() => run(async () => { await ppost('/admin/password', { current: cur, password: pw }); setCur(''); setPw(''); }, 'Password diganti')}>
          Ganti
        </Button>
      </div>
    </Card>
  );
}

export function AdminAudit() {
  const { data, isLoading } = useQuery({ queryKey: ['p-audit'], queryFn: () => pget<{ id: number; actor: string; action: string; target: string; created_at: string }[]>('/admin/audit') });
  return (
    <div className="space-y-5">
      <PageHeader title="Audit" icon={<ScrollText className="size-5" />} />
      <Card className="overflow-hidden">
        {isLoading ? (
          <Loading />
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {data?.map((a) => (
                <tr key={a.id} className="border-t border-line first:border-t-0">
                  <td className="whitespace-nowrap px-5 py-2 text-xs text-muted">{formatDate(a.created_at)}</td>
                  <td className="px-3 py-2">{a.actor}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.action}</td>
                  <td className="px-5 py-2 text-xs text-muted">{a.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
