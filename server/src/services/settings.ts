import type { DB } from '../db/index.js';

export interface AppSettings {
  brand: {
    name: string;
    tagline: string;
    currency: string;
    phone: string;
    address: string;
    timezoneOffset: number; // menit dari UTC, WIB = 420
  };
  monitor: {
    pollSeconds: number;
    metricsEverySeconds: number;
    retentionDays: number;
  };
  alerts: {
    cpu: number;
    memory: number;
    temperature: number;
    offline: boolean;
    interfaceDown: boolean;
    telegram: { enabled: boolean; botToken: string; chatId: string };
  };
  voucher: {
    syncSeconds: number;
    autoRemoveExpired: boolean;
    defaultCharset: string;
    defaultLength: number;
    defaultPrefix: string;
    loginUrl: string;
  };
  backup: {
    enabled: boolean;
    hour: number;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  brand: { name: 'MIKROTAL', tagline: 'Mikrotik Digital', currency: 'IDR', phone: '', address: '', timezoneOffset: 420 },
  monitor: { pollSeconds: 10, metricsEverySeconds: 60, retentionDays: 30 },
  alerts: {
    cpu: 85,
    memory: 90,
    temperature: 70,
    offline: true,
    interfaceDown: true,
    telegram: { enabled: false, botToken: '', chatId: '' },
  },
  voucher: {
    syncSeconds: 60,
    autoRemoveExpired: true,
    defaultCharset: 'alnum-upper',
    defaultLength: 6,
    defaultPrefix: '',
    loginUrl: 'http://hotspot.lan/login',
  },
  backup: { enabled: false, hour: 3 },
};

function deepMerge<T>(base: T, patch: any): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return (patch === undefined ? base : patch) as T;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = (base as any)?.[k];
    out[k] = cur && typeof cur === 'object' && !Array.isArray(cur) ? deepMerge(cur, v) : v;
  }
  return out;
}

export class SettingsService {
  private cache?: AppSettings;

  constructor(private readonly db: DB) {}

  get(): AppSettings {
    if (this.cache) return this.cache;
    const row = this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'app'");
    const stored = row ? JSON.parse(row.value) : {};
    this.cache = deepMerge(DEFAULT_SETTINGS, stored);
    return this.cache;
  }

  update(patch: Partial<AppSettings> | Record<string, any>): AppSettings {
    const next = deepMerge(this.get(), patch);
    this.db.run(
      "INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(next)],
    );
    this.cache = next;
    return next;
  }

  /** Versi aman untuk dikirim ke browser (token disamarkan). */
  public(): AppSettings {
    const s = structuredClone(this.get());
    if (s.alerts.telegram.botToken) s.alerts.telegram.botToken = maskSecret(s.alerts.telegram.botToken);
    return s;
  }
}

export function maskSecret(v: string) {
  if (v.length <= 8) return '••••••••';
  return `${v.slice(0, 4)}••••••••${v.slice(-4)}`;
}

export function isMasked(v: string | undefined) {
  return typeof v === 'string' && v.includes('••••');
}
