import crypto from 'node:crypto';
import type { DB } from '../db/index.js';

export interface BankAccount {
  bank: string;
  number: string;
  holder: string;
}

export interface ChrSettings {
  /** Alamat API CHR dari sisi server MIKROTAL (biasanya IP lokal VM/container CHR). */
  host: string;
  port: number;
  username: string;
  passwordEnc: string;
  tls: boolean;
  /** Hanya untuk uji/demo: CHR simulasi. */
  simulate: boolean;
  /** Alamat publik CHR yang dituju router pelanggan (nama domain atau IP). */
  endpoint: string;
  wgInterface: string;
  wgPort: number;
  /** Public key interface WireGuard di CHR (dibaca otomatis saat uji koneksi). */
  wgPublicKey: string;
  pppProfile: string;
  sstpPort: number;
  ipsecSecretEnc: string;
  /** Jaringan tunnel, mis. 10.200.0.0/16. IP pertama dipakai CHR/server. */
  tunnelNetwork: string;
}

export interface PlatformSettings {
  brandName: string;
  supportWhatsapp: string;
  supportEmail: string;
  trialDays: number;
  trialMaxRouters: number;
  graceDays: number;
  /** Tagihan yang belum dibayar dibatalkan setelah sekian hari. */
  invoiceDays: number;
  bankAccounts: BankAccount[];
  paymentNote: string;
  /** Router simulasi untuk mencoba fitur pada pelanggan baru. */
  demoForNewTenants: boolean;
  signupOpen: boolean;
  chr: ChrSettings;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  brandName: 'MIKROTAL Cloud',
  supportWhatsapp: '',
  supportEmail: '',
  trialDays: 14,
  trialMaxRouters: 1,
  graceDays: 3,
  invoiceDays: 3,
  bankAccounts: [],
  paymentNote: 'Transfer tepat sesuai nominal (termasuk 3 digit kode unik) agar pembayaran mudah dicocokkan.',
  demoForNewTenants: true,
  signupOpen: true,
  chr: {
    host: '',
    port: 8728,
    username: 'mikrotal',
    passwordEnc: '',
    tls: false,
    simulate: false,
    endpoint: '',
    wgInterface: 'mikrotal-wg',
    wgPort: 13231,
    wgPublicKey: '',
    pppProfile: 'mikrotal-cloud',
    sstpPort: 443,
    ipsecSecretEnc: '',
    tunnelNetwork: '10.200.0.0/16',
  },
};

function merge<T>(base: T, patch: any): T {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return (patch === undefined ? base : patch) as T;
  const out: any = { ...base };
  for (const k of Object.keys(base as any)) if (patch && k in patch) out[k] = merge((base as any)[k], patch[k]);
  return out;
}

export class PlatformSettingsService {
  private cache?: PlatformSettings;
  constructor(private readonly db: DB) {}

  get(): PlatformSettings {
    if (this.cache) return this.cache;
    const row = this.db.get<{ value: string }>("SELECT value FROM platform_settings WHERE key = 'settings'");
    let stored: any = {};
    try {
      stored = row ? JSON.parse(row.value) : {};
    } catch {
      stored = {};
    }
    this.cache = merge(DEFAULT_PLATFORM_SETTINGS, stored);
    return this.cache;
  }

  update(patch: Partial<PlatformSettings> & { chr?: Partial<ChrSettings> }) {
    const next = merge(this.get(), patch);
    this.db.run("INSERT INTO platform_settings (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(next)]);
    this.cache = next;
    return next;
  }
}

/** Kunci turunan per pelanggan: token login dan enkripsi password router satu pelanggan tidak berlaku di pelanggan lain. */
export function deriveSecret(master: string, scope: string) {
  return crypto.createHmac('sha256', master).update(`mikrotal-cloud:${scope}`).digest('hex');
}
