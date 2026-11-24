/**
 * Membaca jejak Mikhmon di router: metadata profil di script on-login dan tanggal habis di komentar user.
 *
 * Mikhmon menyimpan data profil di awal on-login sebagai  :put (",rem,4000,1d,5000,,Disable,");
 * (mode kedaluwarsa, harga, masa aktif, harga jual, ..., kunci user), lalu saat voucher pertama
 * dipakai, komentar user diganti tanggal habis, mis. "nov/30/2026 10:00:00" (RouterOS < 7.10) atau
 * "2026-11-30 10:00:00" (7.10+). Script Mikhmon yang membaca format lama rusak di 7.10+.
 * Profil tanpa masa aktif ditulis  :put (",,5000,,,noexp,Disable,").
 */

export interface MikhmonMeta {
  expMode: string;
  /** Harga untuk pelanggan: harga jual Mikhmon bila diisi, selain itu harga. */
  price: number;
  validity: string;
  /** Harga modal reseller: kolom "Price" Mikhmon bila harga jual diisi dan lebih murah. */
  resellerPrice: number;
  lockUser: string;
}

export function parseMikhmonMeta(onLogin: string | undefined): MikhmonMeta | null {
  const m = (onLogin ?? '').match(/:put\s*\(\s*"\s*,([^"]*)"\s*\)/);
  if (!m) return null;
  const f = m[1].split(',');
  const num = (s: string | undefined) => {
    const n = Number(String(s ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const base = num(f[1]);
  const sell = num(f[3]);
  // Mikhmon mencetak harga jual di voucher bila tidak 0; kolom "Price" hanya dipakai bila harga jual kosong
  return {
    expMode: (f[4] ?? '').trim() === 'noexp' ? 'noexp' : (f[0] ?? '').trim(),
    price: sell > 0 ? sell : base,
    validity: /^(\d+[wdhms])+$/i.test((f[2] ?? '').trim()) ? f[2].trim().toLowerCase() : '',
    resellerPrice: sell > 0 && base > 0 && base < sell ? base : 0,
    lockUser: (f[5] ?? '').trim(),
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Tanggal RouterOS ("nov/30/2026 10:00:00" atau "2026-11-30 10:00:00") dalam jam lokal router → Date (UTC).
 * offsetMin = selisih zona waktu router dari UTC dalam menit (WIB = 420). Tanggal tidak masuk akal → null.
 */
export function parseRouterDate(text: string | undefined, offsetMin: number): Date | null {
  const s = (text ?? '').trim().toLowerCase();
  let y: number, mo: number, d: number;
  let hh = 0,
    mm = 0,
    ss = 0;
  let m = s.match(/([a-z]{3})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    mo = MONTHS.indexOf(m[1]);
    if (mo < 0) return null;
    d = Number(m[2]);
    y = Number(m[3]);
    [hh, mm, ss] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  } else if ((m = s.match(/(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) {
    y = Number(m[1]);
    mo = Number(m[2]) - 1;
    d = Number(m[3]);
    [hh, mm, ss] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  } else return null;
  if (y < 2015 || y > 2100 || mo < 0 || mo > 11 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null;
  const utc = Date.UTC(y, mo, d, hh, mm, ss) - offsetMin * 60_000;
  const back = new Date(utc + offsetMin * 60_000);
  if (back.getUTCDate() !== d) return null; // mis. 31 Februari
  return new Date(utc);
}

/** Scheduler pengecek kedaluwarsa ala Mikhmon: menghapus/menonaktifkan user hotspot berdasarkan komentar/tanggal. */
export function isExpiryScheduler(s: { name?: string; 'on-event'?: string }, mikhmonProfiles: Set<string>) {
  const ev = (s['on-event'] ?? '').toLowerCase();
  const touchesUsers = /hotspot\s+(user|active)/.test(ev) && /(remove|disable)/.test(ev);
  const usesDate = /(comment|date|clock)/.test(ev);
  return (touchesUsers && usesDate) || mikhmonProfiles.has(s.name ?? '');
}

/**
 * User hotspot yang merupakan voucher Mikhmon: komentar "vc-..." / "up-..." (belum dipakai) atau
 * berisi tanggal (sudah dipakai, termasuk tanggal yang rusak oleh script lama). Akun member biasa dilewati.
 */
export function isMikhmonVoucher(comment: string | undefined, offsetMin: number) {
  const c = (comment ?? '').trim();
  if (/^(vc|up)-/i.test(c)) return true;
  if (parseRouterDate(c, offsetMin)) return true;
  return /^[a-z]{3}\/\d{2}\/\d{4}|^\d{4}-\d{2}-\d{2}/i.test(c);
}

/** User hotspot yang tampak seperti voucher (bukan akun member tetap). */
export function looksLikeVoucher(u: { name?: string; password?: string; comment?: string }, offsetMin: number) {
  return (!!u.name && u.password === u.name) || isMikhmonVoucher(u.comment, offsetMin);
}
