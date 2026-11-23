import type { Platform, TenantRow, TenantStatus } from './platform.js';
import type { VpnService } from './vpn.js';

/**
 * Penghubung aplikasi satu pelanggan dengan platform (langganan, VPN). Hanya ada di mode cloud;
 * di instalasi sendiri (self-hosted) `ctx.cloud` kosong dan semua aturan di bawah tidak berlaku.
 */
export interface TenantCloud {
  slug: string;
  platform: Platform;
  vpn: VpnService;
  tenant(): TenantRow;
  status(): TenantStatus;
  /** Alamat yang boleh dihubungi aplikasi pelanggan (lihat resolveAllowedHost). */
  resolveRouterHost(host: string): Promise<string>;
  /** URL publik aplikasi pelanggan, mis. https://rtrw-jaya.mikrotal.id */
  publicUrl: string;
}

/** Jalur API yang tetap bisa dipakai saat langganan habis: login, info akun, dan halaman Langganan. */
export function allowedWhenInactive(url: string) {
  const p = url.split('?')[0];
  return /^\/api\/(auth\/(login|me|password)|cloud\/|ws$|util\/)/.test(p) || !p.startsWith('/api/');
}

/** Router simulasi untuk mencoba fitur: tidak dihitung kuota, tetapi dibatasi satu per pelanggan. */
export const MAX_SIMULATED_ROUTERS = 1;
