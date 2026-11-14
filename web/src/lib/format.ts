export function formatBytes(bytes: number | string | undefined | null, digits = 1): string {
  const n = Number(bytes ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function formatBps(bps: number | string | undefined | null, digits = 1): string {
  const n = Number(bps ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '0 bps';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  return `${(n / Math.pow(1000, i)).toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function formatMoney(n: number | undefined | null, currency = 'IDR'): string {
  const v = Number(n ?? 0);
  if (currency === 'IDR') return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
  try {
    return v.toLocaleString('id-ID', { style: 'currency', currency, maximumFractionDigits: 0 });
  } catch {
    return `${currency} ${v.toLocaleString('id-ID')}`;
  }
}

export function formatNumber(n: number | undefined | null): string {
  return Number(n ?? 0).toLocaleString('id-ID');
}

const UNIT: [string, number][] = [
  ['w', 604800],
  ['d', 86400],
  ['h', 3600],
  ['m', 60],
  ['s', 1],
];

export function parseDuration(input: string | number | undefined | null): number {
  if (input === null || input === undefined) return 0;
  if (typeof input === 'number') return input;
  let s = input.trim().toLowerCase();
  if (!s || s === 'none') return 0;
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  const clock = s.match(/(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/);
  if (clock) {
    total += Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    s = s.slice(0, clock.index);
  }
  const re = /(\d+)(ms|w|d|h|m|s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[2] === 'ms') continue;
    total += Number(m[1]) * (UNIT.find((u) => u[0] === m![2])?.[1] ?? 0);
  }
  return total;
}

const ID_UNIT: Record<string, string> = { w: 'mgg', d: 'hr', h: 'j', m: 'm', s: 'd' };

/** 93784 → "1hr 2j 3m" (ringkas, maksimal 3 bagian) */
export function humanDuration(seconds: number | undefined | null, parts = 3): string {
  let s = Math.max(0, Math.floor(Number(seconds ?? 0)));
  if (s === 0) return '0d';
  const out: string[] = [];
  for (const [u, v] of UNIT) {
    if (s >= v) {
      out.push(`${Math.floor(s / v)}${ID_UNIT[u]}`);
      s %= v;
    }
    if (out.length >= parts) break;
  }
  return out.join(' ');
}

/** Ubah durasi RouterOS / singkat ke kalimat: "1d" → "1 hari" */
export function durationLabel(v: string | undefined | null): string {
  const secs = parseDuration(v ?? '');
  if (!secs) return '-';
  const names: [number, string][] = [
    [604800, 'minggu'],
    [86400, 'hari'],
    [3600, 'jam'],
    [60, 'menit'],
    [1, 'detik'],
  ];
  if (secs % 86400 === 0 && secs >= 86400 && secs % 604800 !== 0) return `${secs / 86400} hari`;
  for (const [d, n] of names) if (secs % d === 0) return `${secs / d} ${n}`;
  return humanDuration(secs);
}

export function formatDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', withTime ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeAgo(iso: string | number | null | undefined): string {
  if (!iso) return '-';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  const diff = (Date.now() - t) / 1000;
  if (diff < 10) return 'baru saja';
  if (diff < 60) return `${Math.floor(diff)} detik lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}

export function timeLeft(iso: string | null | undefined): string {
  if (!iso) return '-';
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  if (diff <= 0) return 'habis';
  return humanDuration(diff, 2);
}

export function pct(used?: number, total?: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, ((used ?? 0) / total) * 100));
}

export function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
