import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DB } from '../db/index.js';
import { hashPassword, SecretBox } from '../lib/security.js';
import { HttpError } from '../services/vouchers.js';
import { platformMigrations } from './schema.js';
import { deriveSecret, PlatformSettingsService } from './settings.js';

export interface PlanRow {
  id: number;
  code: string;
  name: string;
  price_monthly: number;
  max_routers: number;
  description: string;
  active: number;
  sort: number;
}

export interface TenantRow {
  id: number;
  slug: string;
  business_name: string;
  owner_name: string;
  email: string;
  phone: string;
  plan_id: number | null;
  status: 'active' | 'suspended' | 'deleted';
  trial: number;
  period_end: string;
  suspended_reason: string;
  notes: string;
  reminder_stage: string;
  created_at: string;
}

export interface InvoiceRow {
  id: number;
  number: string;
  tenant_id: number;
  plan_id: number;
  months: number;
  base_amount: number;
  unique_code: number;
  amount: number;
  status: 'pending' | 'review' | 'paid' | 'rejected' | 'cancelled';
  proof_file: string;
  payer_name: string;
  payer_note: string;
  reject_reason: string;
  reviewed_by: string;
  created_at: string;
  expires_at: string;
  submitted_at: string | null;
  paid_at: string | null;
}

/**
 * Tahap langganan:
 *  trial/active  : semua fitur jalan
 *  grace         : masa langganan habis, masih jalan beberapa hari (lihat graceDays) sambil menunggu pembayaran
 *  expired       : lewat masa tenggang. Hanya login & halaman Langganan; tugas otomatis (sinkron voucher, isolir, monitor) berhenti
 *  suspended     : dihentikan admin (mis. pelanggaran)
 */
export type Phase = 'trial' | 'active' | 'grace' | 'expired' | 'suspended' | 'deleted';

export interface TenantStatus {
  phase: Phase;
  canUse: boolean;
  trial: boolean;
  planCode: string;
  planName: string;
  maxRouters: number;
  periodEnd: string;
  graceEnd: string;
  /** Hari tersisa sampai periodEnd (negatif bila sudah lewat). */
  daysLeft: number;
  reason: string;
}

export const MONTH_OPTIONS = [1, 3, 6, 12] as const;
const DAY = 86400_000;

const RESERVED_SLUGS = new Set([
  'www', 'app', 'api', 'admin', 'panel', 'dashboard', 'vpn', 'chr', 'mail', 'smtp', 'imap', 'pop', 'ftp', 'ns1', 'ns2', 'dns',
  'cdn', 'static', 'assets', 'status', 'help', 'support', 'docs', 'blog', 'billing', 'login', 'signup', 'daftar', 'mikrotal', 'cloud', 'test', 'demo',
]);

export function validateSlug(slug: string): string | null {
  if (!/^[a-z][a-z0-9-]{2,29}$/.test(slug)) return 'Alamat 3-30 karakter: huruf kecil, angka, atau tanda minus, diawali huruf';
  if (slug.endsWith('-') || slug.includes('--')) return 'Alamat tidak boleh diakhiri tanda minus atau berisi "--"';
  if (RESERVED_SLUGS.has(slug)) return 'Alamat ini dipakai sistem, pilih yang lain';
  return null;
}

export function addMonths(fromIso: string, months: number) {
  const d = new Date(fromIso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

export interface PlatformOptions {
  dataDir: string;
  /** Rahasia utama (APP_SECRET). Semua kunci pelanggan diturunkan dari sini. */
  masterSecret: string;
  dbFile?: string;
  adminUsername: string;
  adminPassword: string;
}

export class Platform {
  readonly db: DB;
  readonly settings: PlatformSettingsService;
  /** Enkripsi rahasia platform (password CHR, kunci VPN). */
  readonly box: SecretBox;
  readonly proofDir: string;

  constructor(readonly opts: PlatformOptions) {
    this.db = new DB(opts.dbFile ?? path.join(opts.dataDir, 'platform', 'platform.db'), platformMigrations);
    this.settings = new PlatformSettingsService(this.db);
    this.box = new SecretBox(deriveSecret(opts.masterSecret, 'platform-box'));
    this.proofDir = path.join(opts.dataDir, 'platform', 'proofs');
    this.seed();
  }

  private seed() {
    if (!this.db.get('SELECT id FROM plans LIMIT 1')) {
      const plans: [string, string, number, number, string, number][] = [
        ['starter', 'Starter', 50000, 1, '1 router MikroTik. Cocok untuk hotspot voucher atau RT/RW Net kecil.', 1],
        ['bisnis', 'Bisnis', 100000, 3, 'Sampai 3 router. Reseller, PPPoE, dan isolir otomatis.', 2],
        ['pro', 'Pro', 200000, 10, 'Sampai 10 router untuk jaringan yang lebih besar.', 3],
      ];
      for (const [code, name, price, max, desc, sort] of plans)
        this.db.run('INSERT INTO plans (code, name, price_monthly, max_routers, description, sort) VALUES (?, ?, ?, ?, ?, ?)', [code, name, price, max, desc, sort]);
    }
    if (!this.db.get('SELECT id FROM platform_admins LIMIT 1')) {
      this.db.run('INSERT INTO platform_admins (username, password_hash, name, created_at) VALUES (?, ?, ?, ?)', [
        this.opts.adminUsername,
        hashPassword(this.opts.adminPassword),
        'Admin Platform',
        new Date().toISOString(),
      ]);
    }
  }

  /** APP_SECRET khusus satu pelanggan (JWT login & enkripsi password router di database pelanggan). */
  tenantSecret(slug: string) {
    return deriveSecret(this.opts.masterSecret, `tenant:${slug}`);
  }

  tenantDataDir(slug: string) {
    return path.join(this.opts.dataDir, 'tenants', slug);
  }

  audit(actor: string, action: string, target = '', detail?: unknown) {
    this.db.run('INSERT INTO platform_audit (actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)', [
      actor,
      action,
      target,
      detail === undefined ? '' : JSON.stringify(detail),
      new Date().toISOString(),
    ]);
  }

  // ---- paket ----
  plans(includeInactive = false) {
    return this.db.all<PlanRow>(`SELECT * FROM plans ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, price_monthly`);
  }

  plan(id: number | null | undefined) {
    return id ? this.db.get<PlanRow>('SELECT * FROM plans WHERE id = ?', [id]) : undefined;
  }

  planByCode(code: string) {
    return this.db.get<PlanRow>('SELECT * FROM plans WHERE code = ?', [code]);
  }

  // ---- pelanggan ----
  tenants() {
    return this.db.all<TenantRow>("SELECT * FROM tenants WHERE status != 'deleted' ORDER BY created_at DESC");
  }

  tenant(id: number) {
    return this.db.get<TenantRow>('SELECT * FROM tenants WHERE id = ?', [id]);
  }

  tenantBySlug(slug: string) {
    return this.db.get<TenantRow>('SELECT * FROM tenants WHERE slug = ?', [slug]);
  }

  requireTenant(id: number) {
    const t = this.tenant(id);
    if (!t) throw new HttpError(404, 'Pelanggan tidak ditemukan');
    return t;
  }

  slugAvailable(slug: string) {
    const err = validateSlug(slug);
    if (err) return { available: false, reason: err };
    if (this.tenantBySlug(slug)) return { available: false, reason: 'Alamat sudah dipakai' };
    return { available: true, reason: '' };
  }

  createTenant(input: { slug: string; businessName: string; ownerName: string; email: string; phone: string }) {
    const s = this.settings.get();
    const check = this.slugAvailable(input.slug);
    if (!check.available) throw new HttpError(400, check.reason);
    if (this.db.get('SELECT id FROM tenants WHERE email = ?', [input.email])) throw new HttpError(400, 'Email sudah terdaftar. Login di alamat MIKROTAL Anda, atau hubungi admin.');
    const firstPlan = this.plans()[0];
    const now = new Date();
    const { lastId } = this.db.run(
      `INSERT INTO tenants (slug, business_name, owner_name, email, phone, plan_id, trial, period_end, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [input.slug, input.businessName, input.ownerName, input.email, input.phone, firstPlan?.id ?? null, new Date(now.getTime() + s.trialDays * DAY).toISOString(), now.toISOString()],
    );
    return this.tenant(lastId)!;
  }

  status(t: TenantRow, now = Date.now()): TenantStatus {
    const s = this.settings.get();
    const plan = this.plan(t.plan_id);
    const end = Date.parse(t.period_end);
    const graceEnd = end + s.graceDays * DAY;
    const daysLeft = Math.ceil((end - now) / DAY);
    let phase: Phase;
    let reason = '';
    if (t.status === 'deleted') {
      phase = 'deleted';
      reason = 'Akun dihapus';
    } else if (t.status === 'suspended') {
      phase = 'suspended';
      reason = t.suspended_reason || 'Akun dihentikan sementara oleh admin';
    } else if (now <= end) phase = t.trial ? 'trial' : 'active';
    else if (now <= graceEnd) {
      phase = 'grace';
      reason = 'Masa langganan habis. Segera bayar sebelum masa tenggang berakhir.';
    } else {
      phase = 'expired';
      reason = 'Masa langganan habis. Bayar tagihan untuk mengaktifkan kembali.';
    }
    return {
      phase,
      canUse: phase === 'trial' || phase === 'active' || phase === 'grace',
      trial: !!t.trial,
      planCode: plan?.code ?? '',
      planName: t.trial ? `Uji coba (${plan?.name ?? '-'})` : (plan?.name ?? '-'),
      maxRouters: t.trial ? s.trialMaxRouters : (plan?.max_routers ?? 1),
      periodEnd: t.period_end,
      graceEnd: new Date(graceEnd).toISOString(),
      daysLeft,
      reason,
    };
  }

  updateTenant(id: number, patch: Partial<Pick<TenantRow, 'status' | 'suspended_reason' | 'notes' | 'plan_id' | 'period_end' | 'trial' | 'business_name' | 'phone'>>) {
    const t = this.requireTenant(id);
    const next = { ...t, ...patch };
    this.db.run(
      'UPDATE tenants SET status = ?, suspended_reason = ?, notes = ?, plan_id = ?, period_end = ?, trial = ?, business_name = ?, phone = ?, reminder_stage = ? WHERE id = ?',
      [next.status, next.suspended_reason, next.notes, next.plan_id, next.period_end, next.trial ? 1 : 0, next.business_name, next.phone, patch.period_end ? '' : t.reminder_stage, id],
    );
    return this.tenant(id)!;
  }

  setReminderStage(id: number, stage: string) {
    this.db.run('UPDATE tenants SET reminder_stage = ? WHERE id = ?', [stage, id]);
  }

  // ---- tagihan (transfer manual) ----
  invoices(filter: { tenantId?: number; status?: string } = {}) {
    const where: string[] = [];
    const params: any[] = [];
    if (filter.tenantId) {
      where.push('i.tenant_id = ?');
      params.push(filter.tenantId);
    }
    if (filter.status) {
      where.push('i.status = ?');
      params.push(filter.status);
    }
    return this.db.all<InvoiceRow & { plan_name: string; slug: string; business_name: string }>(
      `SELECT i.*, p.name AS plan_name, t.slug, t.business_name FROM invoices i JOIN plans p ON p.id = i.plan_id JOIN tenants t ON t.id = i.tenant_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.created_at DESC LIMIT 200`,
      params,
    );
  }

  invoice(id: number) {
    return this.db.get<InvoiceRow>('SELECT * FROM invoices WHERE id = ?', [id]);
  }

  requireInvoice(id: number, tenantId?: number) {
    const inv = this.invoice(id);
    if (!inv || (tenantId && inv.tenant_id !== tenantId)) throw new HttpError(404, 'Tagihan tidak ditemukan');
    return inv;
  }

  /** Tagihan baru dengan 3 digit kode unik agar transfer mudah dicocokkan. Tagihan lama yang belum dibayar dibatalkan. */
  createInvoice(tenantId: number, planCode: string, months: number) {
    const t = this.requireTenant(tenantId);
    if (t.status === 'deleted') throw new HttpError(400, 'Akun sudah dihapus');
    const plan = this.planByCode(planCode);
    if (!plan || !plan.active) throw new HttpError(400, 'Paket tidak tersedia');
    if (!(MONTH_OPTIONS as readonly number[]).includes(months)) throw new HttpError(400, 'Lama langganan harus 1, 3, 6, atau 12 bulan');
    const s = this.settings.get();
    if (!s.bankAccounts.length) throw new HttpError(503, 'Rekening pembayaran belum diatur admin. Hubungi admin MIKROTAL Cloud.');
    return this.db.transaction(() => {
      this.db.run("UPDATE invoices SET status = 'cancelled' WHERE tenant_id = ? AND status = 'pending'", [tenantId]);
      if (this.db.get("SELECT id FROM invoices WHERE tenant_id = ? AND status = 'review'", [tenantId]))
        throw new HttpError(400, 'Masih ada bukti transfer yang sedang diperiksa admin. Tunggu sampai selesai diperiksa.');
      const base = plan.price_monthly * months;
      const taken = new Set(this.db.all<{ amount: number }>("SELECT amount FROM invoices WHERE status IN ('pending','review')").map((r) => r.amount));
      let code = 0;
      for (let i = 0; i < 2000; i++) {
        const c = crypto.randomInt(1, 1000);
        if (!taken.has(base + c)) {
          code = c;
          break;
        }
      }
      if (!code) throw new HttpError(503, 'Gagal membuat kode unik, coba lagi');
      const now = new Date();
      const { lastId } = this.db.run(
        `INSERT INTO invoices (number, tenant_id, plan_id, months, base_amount, unique_code, amount, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`TMP-${crypto.randomUUID()}`, tenantId, plan.id, months, base, code, base + code, now.toISOString(), new Date(now.getTime() + s.invoiceDays * DAY).toISOString()],
      );
      const number = `INV-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(lastId).padStart(5, '0')}`;
      this.db.run('UPDATE invoices SET number = ? WHERE id = ?', [number, lastId]);
      return this.invoice(lastId)!;
    });
  }

  /** Pelanggan mengunggah bukti transfer (gambar/PDF, maks 2 MB). */
  submitProof(tenantId: number, invoiceId: number, input: { fileName: string; data: Buffer; payerName: string; note: string }) {
    const inv = this.requireInvoice(invoiceId, tenantId);
    if (inv.status !== 'pending' && inv.status !== 'rejected') throw new HttpError(400, 'Tagihan ini tidak menunggu pembayaran');
    const ext = path.extname(input.fileName).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext)) throw new HttpError(400, 'Bukti transfer harus berupa gambar (JPG/PNG/WEBP) atau PDF');
    if (input.data.length > 2 * 1024 * 1024) throw new HttpError(400, 'Ukuran bukti transfer maksimal 2 MB');
    if (!looksLikeFile(input.data, ext)) throw new HttpError(400, 'Isi berkas tidak sesuai jenisnya');
    fs.mkdirSync(this.proofDir, { recursive: true });
    const file = `${inv.number}-${Date.now()}${ext}`;
    fs.writeFileSync(path.join(this.proofDir, file), input.data);
    this.db.run("UPDATE invoices SET status = 'review', proof_file = ?, payer_name = ?, payer_note = ?, reject_reason = '', submitted_at = ? WHERE id = ?", [
      file,
      input.payerName,
      input.note,
      new Date().toISOString(),
      inv.id,
    ]);
    return this.invoice(inv.id)!;
  }

  cancelInvoice(tenantId: number, invoiceId: number) {
    const inv = this.requireInvoice(invoiceId, tenantId);
    if (inv.status !== 'pending' && inv.status !== 'rejected') throw new HttpError(400, 'Tagihan ini tidak bisa dibatalkan');
    this.db.run("UPDATE invoices SET status = 'cancelled' WHERE id = ?", [inv.id]);
  }

  proofPath(inv: InvoiceRow) {
    if (!inv.proof_file) return null;
    const p = path.join(this.proofDir, path.basename(inv.proof_file));
    return fs.existsSync(p) ? p : null;
  }

  /** Admin mengonfirmasi pembayaran: masa langganan diperpanjang dan paket diganti sesuai tagihan. */
  confirmInvoice(invoiceId: number, admin: string) {
    const inv = this.requireInvoice(invoiceId);
    if (inv.status === 'paid') throw new HttpError(400, 'Tagihan sudah lunas');
    if (inv.status === 'cancelled') throw new HttpError(400, 'Tagihan sudah dibatalkan');
    const t = this.requireTenant(inv.tenant_id);
    const now = new Date().toISOString();
    // Masa baru dihitung dari akhir masa lama bila masih berjalan, atau dari sekarang bila sudah habis.
    // Sisa masa uji coba tidak ditambahkan.
    const from = !t.trial && Date.parse(t.period_end) > Date.now() ? t.period_end : now;
    const periodEnd = addMonths(from, inv.months);
    this.db.transaction(() => {
      this.db.run("UPDATE invoices SET status = 'paid', paid_at = ?, reviewed_by = ? WHERE id = ?", [now, admin, inv.id]);
      this.db.run("UPDATE tenants SET plan_id = ?, trial = 0, period_end = ?, reminder_stage = '' WHERE id = ?", [inv.plan_id, periodEnd, t.id]);
    });
    this.audit(admin, 'invoice.confirm', inv.number, { tenant: t.slug, amount: inv.amount, periodEnd });
    return { invoice: this.invoice(inv.id)!, tenant: this.tenant(t.id)! };
  }

  rejectInvoice(invoiceId: number, admin: string, reason: string) {
    const inv = this.requireInvoice(invoiceId);
    if (inv.status !== 'review' && inv.status !== 'pending') throw new HttpError(400, 'Tagihan ini tidak sedang diperiksa');
    this.db.run("UPDATE invoices SET status = 'rejected', reject_reason = ?, reviewed_by = ? WHERE id = ?", [reason, admin, inv.id]);
    this.audit(admin, 'invoice.reject', inv.number, { reason });
    return this.invoice(inv.id)!;
  }

  /** Tagihan yang tidak dibayar sampai batas waktu dibatalkan (kode unik bisa dipakai lagi). */
  expireInvoices(now = new Date().toISOString()) {
    return this.db.run("UPDATE invoices SET status = 'cancelled' WHERE status = 'pending' AND expires_at < ?", [now]).changes;
  }

  close() {
    this.db.close();
  }
}

function looksLikeFile(buf: Buffer, ext: string) {
  const head = buf.subarray(0, 12);
  if (ext === '.pdf') return head.subarray(0, 4).toString('latin1') === '%PDF';
  if (ext === '.png') return head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG';
  if (ext === '.jpg' || ext === '.jpeg') return head[0] === 0xff && head[1] === 0xd8;
  if (ext === '.webp') return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}
