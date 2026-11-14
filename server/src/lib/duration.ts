const UNIT: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };

/**
 * Mengurai durasi format RouterOS ("1w2d3h4m5s", "3h", "00:30:00", "1d 02:00:00")
 * atau format singkat ("30m", "7d"). Mengembalikan detik, 0 jika kosong/tak valid.
 */
export function parseDuration(input: string | number | null | undefined): number {
  if (input === null || input === undefined) return 0;
  if (typeof input === 'number') return Math.max(0, Math.floor(input));
  let s = input.trim().toLowerCase();
  if (!s || s === 'none' || s === 'unlimited') return 0;
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  // bagian hh:mm:ss di akhir
  const clock = s.match(/(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/);
  if (clock) {
    total += Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    s = s.slice(0, clock.index).trim();
  }
  const re = /(\d+(?:\.\d+)?)\s*(ms|w|d|h|m|s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[2] === 'ms') continue;
    total += Number(m[1]) * UNIT[m[2]];
  }
  return Math.floor(total);
}

/** Format detik menjadi gaya RouterOS: 1w2d3h4m5s */
export function formatDuration(seconds: number): string {
  seconds = Math.max(0, Math.floor(seconds));
  if (seconds === 0) return '0s';
  let out = '';
  for (const [u, v] of Object.entries(UNIT)) {
    if (seconds >= v) {
      out += `${Math.floor(seconds / v)}${u}`;
      seconds %= v;
    }
  }
  return out;
}

/** Validasi string durasi masukan pengguna (kosong = valid). */
export function isValidDuration(input: string): boolean {
  const s = input.trim();
  if (!s) return true;
  return /^(\d+[wdhms])+$/i.test(s) || /^\d{1,3}:\d{2}:\d{2}$/.test(s);
}

/** Mengurai ukuran data: "500M", "1G", "1024", "1.5GB" → byte */
export function parseBytes(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') return Math.max(0, Math.floor(input));
  const m = input.trim().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*([KMGT]?)I?B?$/);
  if (!m) return 0;
  const mult: Record<string, number> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
  return Math.floor(Number(m[1]) * mult[m[2]]);
}
