import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, Clock, Copy, CreditCard, FileUp, Network, Plus, Router as RouterIcon, ScrollText, ShieldCheck, Trash2, Wallet, XCircle } from 'lucide-react';
import { del, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { copyText, PHASE_LABEL, PHASE_TONE, useCloud, type CloudSubscription } from '../lib/cloud';
import { formatDate, formatMoney, timeAgo } from '../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, StatusDot, Tabs, Textarea, Toggle, useAction, useFeedback } from '../components/ui';

interface Invoice {
  id: number;
  number: string;
  plan_name: string;
  months: number;
  base_amount: number;
  unique_code: number;
  amount: number;
  status: 'pending' | 'review' | 'paid' | 'rejected' | 'cancelled';
  has_proof: boolean;
  payer_name: string;
  reject_reason: string;
  created_at: string;
  expires_at: string;
  submitted_at: string | null;
  paid_at: string | null;
}

type VpnKind = 'wireguard' | 'l2tp' | 'sstp';
interface VpnPeer {
  id: number;
  name: string;
  kind: VpnKind;
  tunnel_ip: string;
  ppp_user: string;
  api_user: string;
  router_id: number | null;
  last_seen_at: string | null;
  created_at: string;
  vpn: { online: boolean; lastSeen: string | null; detail: string };
  router: { id: number; name: string; status: string; status_message: string } | null;
}
interface VpnData {
  readiness: { kinds: Record<VpnKind, string[]>; available: VpnKind[] };
  endpoint: string;
  serverIp: string;
  maxRouters: number;
  usage: number;
  peers: VpnPeer[];
}

const INVOICE_STATUS: Record<Invoice['status'], { label: string; tone: 'yellow' | 'cyan' | 'green' | 'red' | 'gray' }> = {
  pending: { label: 'Menunggu transfer', tone: 'yellow' },
  review: { label: 'Bukti sedang diperiksa', tone: 'cyan' },
  paid: { label: 'Lunas', tone: 'green' },
  rejected: { label: 'Bukti ditolak', tone: 'red' },
  cancelled: { label: 'Dibatalkan', tone: 'gray' },
};

const KIND_INFO: Record<VpnKind, { label: string; version: string; note: string }> = {
  wireguard: { label: 'WireGuard', version: 'RouterOS v7', note: 'Paling ringan dan cepat. Disarankan untuk semua router v7.' },
  l2tp: { label: 'L2TP/IPsec', version: 'RouterOS v6 (atau v7)', note: 'Untuk router v6. Butuh port UDP 500, 4500, dan 1701 ke internet tidak diblokir.' },
  sstp: { label: 'SSTP', version: 'RouterOS v6 atau v7', note: 'Lewat port TCP 443 seperti HTTPS. Pakai bila L2TP diblokir ISP/jaringan.' },
};

function CopyButton({ text, label = 'Salin' }: { text: string; label?: string }) {
  const { toast } = useFeedback();
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={<Copy className="size-3.5" />}
      onClick={async () => {
        const ok = await copyText(text);
        toast(ok ? 'success' : 'error', ok ? 'Disalin' : 'Gagal menyalin, salin manual');
      }}
    >
      {label}
    </Button>
  );
}

/** Toggle dengan state sendiri, untuk dipakai di dalam dialog konfirmasi. */
function LocalToggle({ initial, onChange, label }: { initial: boolean; onChange: (v: boolean) => void; label: string }) {
  const [v, setV] = useState(initial);
  return (
    <Toggle
      checked={v}
      onChange={(x) => {
        setV(x);
        onChange(x);
      }}
      label={label}
    />
  );
}

// ======================= Langganan =======================

function StatusCard({ sub }: { sub: CloudSubscription }) {
  const st = sub.status;
  const pctUsed = Math.min(100, Math.round((sub.usage.routers / Math.max(1, st.maxRouters)) * 100));
  return (
    <Card className={clsx('p-5', !st.canUse && 'border-rose-500/50', st.phase === 'grace' && 'border-amber-500/50')}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold">{st.planName}</p>
            <Badge tone={PHASE_TONE[st.phase]} dot>
              {PHASE_LABEL[st.phase]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {st.phase === 'trial' || st.phase === 'active'
              ? `Berlaku sampai ${formatDate(st.periodEnd, false)} (${st.daysLeft} hari lagi)`
              : st.phase === 'grace'
                ? `Berakhir ${formatDate(st.periodEnd, false)}. Layanan berhenti ${formatDate(st.graceEnd, false)} bila belum dibayar.`
                : st.reason}
          </p>
          <p className="mt-2 text-xs text-subtle">
            Alamat Anda: <span className="font-mono text-fg">{sub.publicUrl}</span>
          </p>
        </div>
        <div className="w-full max-w-[220px]">
          <p className="text-xs text-muted">Router terpakai</p>
          <p className="text-2xl font-bold tabular-nums">
            {sub.usage.routers} <span className="text-base font-normal text-subtle">/ {st.maxRouters}</span>
          </p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className={clsx('h-full rounded-full', pctUsed >= 100 ? 'bg-amber-500' : 'bg-gradient-brand')} style={{ width: `${pctUsed}%` }} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function OpenInvoice({ inv, sub, onChanged }: { inv: Invoice; sub: CloudSubscription; onChanged: () => void }) {
  const { run, busy } = useAction();
  const { confirm } = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [payer, setPayer] = useState(sub.tenant.owner_name);
  const [note, setNote] = useState('');

  const upload = async () => {
    if (!file) throw new Error('Pilih foto/berkas bukti transfer');
    if (file.size > 2 * 1024 * 1024) throw new Error('Ukuran berkas maksimal 2 MB');
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Gagal membaca berkas'));
      r.readAsDataURL(file);
    });
    await post(`/api/cloud/invoices/${inv.id}/proof`, { fileName: file.name, dataBase64, payerName: payer, note });
    onChanged();
  };
  const cancel = async () => {
    if (!(await confirm({ title: 'Batalkan tagihan?', message: `Tagihan ${inv.number} dibatalkan. Anda bisa membuat tagihan baru kapan saja.`, confirmText: 'Batalkan tagihan', danger: true }))) return;
    await run(async () => {
      await post(`/api/cloud/invoices/${inv.id}/cancel`);
      onChanged();
    }, 'Tagihan dibatalkan');
  };

  const s = INVOICE_STATUS[inv.status];
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Tagihan ${inv.number}`}
        subtitle={`${inv.plan_name} • ${inv.months} bulan • dibuat ${formatDate(inv.created_at)}`}
        icon={<Wallet className="size-4" />}
        actions={
          <Badge tone={s.tone} dot>
            {s.label}
          </Badge>
        }
      />
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted">Transfer tepat sebesar</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <p className="text-3xl font-extrabold tabular-nums">{formatMoney(inv.amount)}</p>
              <CopyButton text={String(inv.amount)} label="Salin nominal" />
            </div>
            <p className="mt-1 text-xs text-subtle">
              {formatMoney(inv.base_amount)} + kode unik <b className="text-fg">{inv.unique_code}</b>. {sub.paymentNote}
            </p>
          </div>
          <div className="space-y-2">
            {sub.bankAccounts.map((b) => (
              <div key={b.bank + b.number} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
                <div className="flex-1">
                  <p className="text-xs font-semibold text-muted">{b.bank}</p>
                  <p className="font-mono text-lg font-bold tracking-wider">{b.number}</p>
                  <p className="text-xs text-muted">a.n. {b.holder}</p>
                </div>
                <CopyButton text={b.number.replace(/\s/g, '')} />
              </div>
            ))}
          </div>
          {inv.status === 'pending' && <p className="text-xs text-subtle">Bayar sebelum {formatDate(inv.expires_at)}. Setelah itu tagihan otomatis dibatalkan.</p>}
        </div>

        <div className="space-y-3">
          {inv.status === 'review' ? (
            <div className="flex h-full flex-col items-center justify-center rounded-xl bg-cyan-500/5 p-6 text-center">
              <Clock className="size-8 text-cyan-500" />
              <p className="mt-2 font-semibold">Bukti transfer sedang diperiksa</p>
              <p className="mt-1 text-xs text-muted">Dikirim {formatDate(inv.submitted_at)} atas nama {inv.payer_name}. Langganan aktif otomatis setelah dikonfirmasi admin, biasanya kurang dari 1x24 jam.</p>
            </div>
          ) : (
            <>
              {inv.status === 'rejected' && (
                <p className="flex gap-2 rounded-xl bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
                  <XCircle className="size-4 shrink-0" /> Ditolak: {inv.reject_reason}. Unggah ulang bukti yang benar.
                </p>
              )}
              <p className="text-sm font-semibold">Sudah transfer? Unggah buktinya</p>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line p-4 text-left text-sm hover:border-brand/60"
              >
                <FileUp className="size-5 text-brand" />
                <span className="min-w-0 flex-1 truncate">{file ? file.name : 'Pilih foto atau PDF bukti transfer (maks 2 MB)'}</span>
              </button>
              <Field label="Nama pengirim di rekening" required>
                <Input value={payer} onChange={(e) => setPayer(e.target.value)} />
              </Field>
              <Field label="Catatan (opsional)">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. transfer dari BRI" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button loading={busy} icon={<FileUp className="size-4" />} onClick={() => run(upload, 'Bukti transfer terkirim')}>
                  Kirim bukti transfer
                </Button>
                <Button variant="ghost" onClick={cancel}>
                  Batalkan tagihan
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function PlanPicker({ sub, onCreated }: { sub: CloudSubscription; onCreated: () => void }) {
  const [plan, setPlan] = useState(sub.status.trial ? (sub.plans[0]?.code ?? '') : sub.status.planCode || sub.plans[0]?.code || '');
  const [months, setMonths] = useState(sub.months[0] ?? 1);
  const { run, busy } = useAction();
  const p = sub.plans.find((x) => x.code === plan);
  const tooSmall = p && p.max_routers < sub.usage.routers;
  return (
    <Card>
      <CardHeader title={sub.status.trial ? 'Pilih paket langganan' : 'Perpanjang atau ganti paket'} icon={<CreditCard className="size-4" />} />
      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sub.plans.map((x) => (
            <button
              key={x.code}
              onClick={() => setPlan(x.code)}
              className={clsx('rounded-xl border p-4 text-left transition', plan === x.code ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line hover:border-brand/50')}
            >
              <div className="flex items-center justify-between">
                <p className="font-bold">{x.name}</p>
                {sub.status.planCode === x.code && !sub.status.trial && <Badge tone="green">Paket Anda</Badge>}
              </div>
              <p className="mt-1 text-xl font-extrabold">
                {formatMoney(x.price_monthly)}
                <span className="text-xs font-normal text-muted"> /bulan</span>
              </p>
              <p className="mt-1 text-xs font-medium text-brand">Sampai {x.max_routers} router</p>
              <p className="mt-1 text-xs text-muted">{x.description}</p>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Lama langganan">
            <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {sub.months.map((m) => (
                <option key={m} value={m}>
                  {m} bulan
                </option>
              ))}
            </Select>
          </Field>
          <div className="pb-1">
            <p className="text-xs text-muted">Total</p>
            <p className="text-lg font-bold">{p ? formatMoney(p.price_monthly * months) : '-'} <span className="text-xs font-normal text-subtle">+ kode unik</span></p>
          </div>
          <Button
            className="ml-auto"
            loading={busy}
            disabled={!p || !!tooSmall || !sub.bankAccounts.length}
            onClick={() =>
              run(async () => {
                await post('/api/cloud/invoices', { planCode: plan, months });
                onCreated();
              }, 'Tagihan dibuat')
            }
          >
            Buat tagihan
          </Button>
        </div>
        {tooSmall && <p className="text-xs text-amber-600 dark:text-amber-400">Paket ini maksimal {p?.max_routers} router, sedangkan Anda memakai {sub.usage.routers}. Hapus router dulu atau pilih paket lebih besar.</p>}
        {!sub.bankAccounts.length && <p className="text-xs text-amber-600 dark:text-amber-400">Rekening pembayaran belum diatur admin. Hubungi admin {sub.brandName}.</p>}
        <p className="text-[11px] text-subtle">
          Masa langganan baru ditambahkan setelah masa sekarang berakhir. Paket baru berlaku sejak pembayaran dikonfirmasi. Sisa masa uji coba tidak ditambahkan.
        </p>
      </div>
    </Card>
  );
}

function SubscriptionTab({ sub }: { sub: CloudSubscription }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const billing = can('settings.manage');
  const { data: invoices, isLoading } = useQuery({ queryKey: ['cloud-invoices'], queryFn: () => get<Invoice[]>('/api/cloud/invoices'), enabled: billing });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['cloud-invoices'] });
    void qc.invalidateQueries({ queryKey: ['cloud-subscription'] });
  };
  const open = invoices?.find((i) => i.status === 'pending' || i.status === 'review' || i.status === 'rejected');
  const history = invoices?.filter((i) => i !== open) ?? [];
  return (
    <div className="space-y-5">
      <StatusCard sub={sub} />
      {!billing ? (
        <Card className="p-5 text-sm text-muted">Pembayaran langganan diurus oleh pemilik akun ({sub.tenant.owner_name}).</Card>
      ) : isLoading ? (
        <Loading />
      ) : (
        <>
          {open ? <OpenInvoice inv={open} sub={sub} onChanged={refresh} /> : <PlanPicker sub={sub} onCreated={refresh} />}
          {history.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="Riwayat tagihan" icon={<ScrollText className="size-4" />} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wider text-subtle">
                    <tr>
                      <th className="px-5 py-2">Nomor</th>
                      <th className="px-3 py-2">Paket</th>
                      <th className="px-3 py-2 text-right">Jumlah</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-5 py-2">Tanggal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((i) => (
                      <tr key={i.id} className="border-t border-line">
                        <td className="px-5 py-2.5 font-mono text-xs">{i.number}</td>
                        <td className="px-3 py-2.5">
                          {i.plan_name} • {i.months} bln
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(i.amount)}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                        </td>
                        <td className="px-5 py-2.5 text-xs text-muted">{formatDate(i.paid_at ?? i.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
      {(sub.support.whatsapp || sub.support.email) && (
        <p className="text-xs text-muted">
          Butuh bantuan? {sub.support.whatsapp && <>WhatsApp <a className="text-brand" href={`https://wa.me/${sub.support.whatsapp.replace(/\D/g, '').replace(/^0/, '62')}`} target="_blank" rel="noreferrer">{sub.support.whatsapp}</a></>}
          {sub.support.whatsapp && sub.support.email && ' • '}
          {sub.support.email && <>Email <a className="text-brand" href={`mailto:${sub.support.email}`}>{sub.support.email}</a></>}
        </p>
      )}
    </div>
  );
}

// ======================= VPN =======================

function ScriptModal({ title, script, kind, onClose }: { title: string; script: string; kind: VpnKind; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="lg" title={title} footer={<Button onClick={onClose}>Selesai</Button>}>
      <div className="space-y-4 text-sm">
        <ol className="list-decimal space-y-1.5 pl-5 text-muted">
          <li>
            Buka router dengan <b className="text-fg">Winbox</b> atau <b className="text-fg">WebFig</b>, lalu klik <b className="text-fg">New Terminal</b>.
          </li>
          <li>
            Klik <b className="text-fg">Salin skrip</b> di bawah, tempel ke terminal (klik kanan → Paste), lalu tekan <b className="text-fg">Enter</b>.
          </li>
          <li>Tunggu sampai muncul tulisan "selesai". Dalam 1 menit status di halaman ini berubah menjadi Tersambung dan router online.</li>
        </ol>
        <div className="relative">
          <pre className="max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-200">{script}</pre>
          <div className="absolute right-3 top-3">
            <CopyButton text={script} label="Salin skrip" />
          </div>
        </div>
        <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          Skrip berisi kunci rahasia router Anda. Jangan dibagikan. Skrip aman dijalankan ulang bila terputus atau router di-reset.
          {kind === 'l2tp' && ' Bila tidak tersambung, kemungkinan ISP memblokir L2TP: hapus koneksi ini lalu buat ulang dengan SSTP.'}
        </p>
      </div>
    </Modal>
  );
}

function NewVpnModal({ data, onClose, onCreated }: { data: VpnData; onClose: () => void; onCreated: (r: { script: string; kind: VpnKind; name: string }) => void }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [kind, setKind] = useState<VpnKind>(data.readiness.available.includes('wireguard') ? 'wireguard' : (data.readiness.available[0] ?? 'wireguard'));
  const { run, busy } = useAction();
  const create = async () => {
    const r = await post<{ script: string }>('/api/cloud/vpn', { name, kind, location });
    onCreated({ script: r.script, kind, name });
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Hubungkan router ke MIKROTAL Cloud"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} disabled={!name.trim()} onClick={() => run(create)}>
            Buat skrip koneksi
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nama router" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Router Kantor" autoFocus />
        </Field>
        <Field label="Lokasi">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="opsional" />
        </Field>
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Versi RouterOS dan jenis VPN</p>
          <div className="space-y-2">
            {(['wireguard', 'l2tp', 'sstp'] as VpnKind[]).map((k) => {
              const ok = data.readiness.available.includes(k);
              return (
                <button
                  key={k}
                  disabled={!ok}
                  onClick={() => setKind(k)}
                  className={clsx(
                    'flex w-full items-start gap-3 rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50',
                    kind === k ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line hover:border-brand/50',
                  )}
                >
                  <Network className="mt-0.5 size-4 text-brand" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">
                      {KIND_INFO[k].version} <span className="font-normal text-muted">• {KIND_INFO[k].label}</span>
                    </p>
                    <p className="text-xs text-muted">{ok ? KIND_INFO[k].note : `Belum tersedia: ${data.readiness.kinds[k].join(', ')}`}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-subtle">Cek versi di Winbox: menu System → Resources (versi 7.x atau 6.x).</p>
        </div>
      </div>
    </Modal>
  );
}

function VpnTab() {
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run } = useAction();
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ['cloud-vpn'], queryFn: () => get<VpnData>('/api/cloud/vpn'), refetchInterval: 20_000 });
  const [creating, setCreating] = useState(false);
  const [script, setScript] = useState<{ title: string; script: string; kind: VpnKind } | null>(null);
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} onRetry={() => void refetch()} />;
  const full = data.usage >= data.maxRouters || data.peers.length >= data.maxRouters;

  const showScript = async (p: VpnPeer) => {
    const r = await run(() => get<{ script: string }>(`/api/cloud/vpn/${p.id}/script`));
    if (r) setScript({ title: `Skrip koneksi ${p.name}`, script: r.script, kind: p.kind });
  };
  const remove = async (p: VpnPeer) => {
    let alsoRouter = true;
    const ok = await confirm({
      title: `Putuskan ${p.name}?`,
      message: (
        <div className="space-y-3">
          <p>Koneksi VPN dihapus dari server. Router tidak bisa dijangkau MIKROTAL lagi sampai dihubungkan ulang. Konfigurasi di router bisa dihapus manual (semua berkomentar "MIKROTAL Cloud").</p>
          <LocalToggle initial onChange={(v) => (alsoRouter = v)} label="Hapus juga router ini dari daftar router MIKROTAL" />
        </div>
      ),
      confirmText: 'Putuskan',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await del(`/api/cloud/vpn/${p.id}`, { deleteRouter: alsoRouter });
      await qc.invalidateQueries({ queryKey: ['cloud-vpn'] });
      void qc.invalidateQueries({ queryKey: ['routers'] });
      void qc.invalidateQueries({ queryKey: ['cloud-subscription'] });
    }, 'Koneksi diputus');
  };

  return (
    <div className="space-y-5">
      <Card className="p-5 text-sm">
        <div className="flex flex-wrap items-start gap-4">
          <ShieldCheck className="size-8 shrink-0 text-brand" />
          <div className="min-w-0 flex-1 space-y-1.5 text-muted">
            <p className="font-semibold text-fg">Cara router terhubung ke MIKROTAL Cloud</p>
            <p>
              Router Anda tidak perlu IP publik. Router membuat sambungan VPN keluar ke server kami ({data.endpoint || 'server VPN'}) dan mendapat IP tunnel pribadi. MIKROTAL lalu mengatur router lewat API melalui tunnel itu
              saja.
            </p>
            <p>
              Skrip membuat user API khusus yang hanya bisa login dari {data.serverIp}, satu rule firewall untuk tunnel, dan tidak mengubah internet atau pengaturan lain di router. Router antar pelanggan
              tidak bisa saling menjangkau.
            </p>
          </div>
          <Button icon={<Plus className="size-4" />} disabled={full || !data.readiness.available.length} onClick={() => setCreating(true)}>
            Hubungkan router
          </Button>
        </div>
        {full && <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">Kuota paket Anda {data.maxRouters} router sudah terpakai. Upgrade paket di tab Langganan untuk menambah router.</p>}
        {!data.readiness.available.length && <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">Server VPN sedang disiapkan admin. Coba lagi nanti.</p>}
      </Card>

      {data.peers.length === 0 ? (
        <Card>
          <EmptyState icon={<RouterIcon className="size-6" />} title="Belum ada router terhubung" description="Klik Hubungkan router, pilih versi RouterOS, lalu tempel skrip ke terminal router." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.peers.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex items-start gap-3">
                <StatusDot online={p.vpn.online} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted">
                    {KIND_INFO[p.kind].label} • IP tunnel <span className="font-mono text-fg">{p.tunnel_ip}</span>
                  </p>
                </div>
                <Badge tone={p.vpn.online ? 'green' : 'gray'} dot>
                  {p.vpn.online ? 'Tersambung' : 'Belum tersambung'}
                </Badge>
              </div>
              <p className="mt-3 text-xs text-muted">{p.vpn.detail || (p.vpn.lastSeen ? `Terakhir tersambung ${timeAgo(p.vpn.lastSeen)}` : '')}</p>
              <p className="mt-1 text-xs text-muted">
                Router di MIKROTAL:{' '}
                {p.router ? (
                  <>
                    <b className="text-fg">{p.router.name}</b> ({p.router.status === 'online' ? 'online' : p.router.status_message || p.router.status || 'menunggu'})
                  </>
                ) : (
                  'sudah dihapus'
                )}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<ScrollText className="size-3.5" />} onClick={() => void showScript(p)}>
                  Lihat skrip
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => void remove(p)}>
                  Putuskan
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <NewVpnModal
          data={data}
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            setScript({ title: `Skrip koneksi ${r.name}`, script: r.script, kind: r.kind });
            void qc.invalidateQueries({ queryKey: ['cloud-vpn'] });
            void qc.invalidateQueries({ queryKey: ['routers'] });
            void qc.invalidateQueries({ queryKey: ['cloud-subscription'] });
          }}
        />
      )}
      {script && <ScriptModal {...script} onClose={() => setScript(null)} />}
    </div>
  );
}

export default function CloudPage() {
  const { data: sub, error, isLoading, refetch } = useCloud();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') === 'vpn' ? 'vpn' : 'langganan') as 'langganan' | 'vpn';
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;
  if (!sub) {
    return (
      <Card>
        <EmptyState icon={<CheckCircle2 className="size-6" />} title="Instalasi mandiri" description="Halaman ini hanya untuk MIKROTAL Cloud berlangganan." />
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Langganan & VPN" subtitle={`${sub.tenant.business_name} • ${sub.brandName}`} icon={<CreditCard className="size-5" />} />
      <Tabs
        value={tab}
        onChange={(v) => setParams(v === 'vpn' ? { tab: 'vpn' } : {})}
        items={[
          { value: 'langganan', label: 'Langganan' },
          ...(can('router.manage') ? [{ value: 'vpn' as const, label: 'Hubungkan Router (VPN)' }] : []),
        ]}
      />
      {tab === 'vpn' && can('router.manage') ? <VpnTab /> : <SubscriptionTab sub={sub} />}
    </div>
  );
}
