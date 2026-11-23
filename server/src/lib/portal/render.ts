import { parseDuration } from '../duration.js';
import type { PortalConfig, PriceItem } from './config.js';
import { MD5_JS } from './md5.js';

/** File yang ditulis ke folder hotspot router. Halaman lain (redirect, rlogin, md5.js, dll) memakai bawaan router. */
export const PORTAL_PAGES = ['login.html', 'alogin.html', 'status.html', 'logout.html', 'error.html'] as const;
export type PortalPage = (typeof PORTAL_PAGES)[number];
export const BG_FILE = 'mt-bg.jpg';

export interface RenderContext {
  config: PortalConfig;
  brandName: string;
  brandPhone: string;
  currency: string;
  prices: PriceItem[];
  /** Alamat MIKROTAL yang bisa dibuka pelanggan, mis. http://192.168.88.10:8080 (untuk tautan cek voucher). */
  baseUrl: string;
  /** Untuk pratinjau: gambar latar disisipkan sebagai data URI, bukan file terpisah. */
  inlineAssets?: boolean;
}

/** Escape teks pengguna untuk HTML. "$" ikut di-escape agar tidak dibaca sebagai variabel RouterOS. */
export function h(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\$/g, '&#36;');
}

/** Nilai untuk disisipkan ke <script>: JSON aman dari "</script>" dan dari template RouterOS. */
function js(v: unknown) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\$/g, '\\u0024').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function money(n: number, currency = 'IDR') {
  try {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
  }
}

export function durationText(v: string, lang: 'id' | 'en' = 'id') {
  const s = parseDuration(v);
  if (!s) return '';
  const units: [number, string, string][] = [
    [604800, 'Minggu', 'week'],
    [86400, 'Hari', 'day'],
    [3600, 'Jam', 'hour'],
    [60, 'Menit', 'minute'],
  ];
  if (s % 86400 === 0 && s % 604800 !== 0) return lang === 'id' ? `${s / 86400} Hari` : `${s / 86400} day${s / 86400 > 1 ? 's' : ''}`;
  for (const [d, id, en] of units) if (s % d === 0) return lang === 'id' ? `${s / d} ${id}` : `${s / d} ${en}${s / d > 1 ? 's' : ''}`;
  return `${Math.round(s / 60)} ${lang === 'id' ? 'Menit' : 'minutes'}`;
}

export function bytesText(n: number) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** rate-limit RouterOS "rx/tx" dilihat dari router: tx = unduhan pelanggan. */
export function speedText(rate: string) {
  const part = (rate || '').trim().split(/\s+/)[0];
  if (!part) return '';
  const [, tx] = part.includes('/') ? part.split('/') : [part, part];
  const m = (tx ?? '').match(/^(\d+(?:\.\d+)?)([kKmMgG]?)$/);
  if (!m) return '';
  const unit = { k: 'Kbps', m: 'Mbps', g: 'Gbps', '': 'bps' }[m[2].toLowerCase() as 'k' | 'm' | 'g' | ''];
  return `${m[1]} ${unit}`;
}

function waNumber(s: string) {
  const d = (s || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  return d.startsWith('0') ? `62${d.slice(1)}` : d;
}

const I18N = {
  id: {
    hello0: 'Selamat pagi',
    hello1: 'Selamat siang',
    hello2: 'Selamat sore',
    hello3: 'Selamat malam',
    loginTitle: 'Masuk ke internet',
    loginSub: 'Masukkan kode voucher Anda untuk mulai berselancar.',
    tabVoucher: 'Voucher',
    tabMember: 'Member',
    code: 'Kode voucher',
    codePh: 'Ketik kode voucher',
    user: 'Username',
    pass: 'Password',
    go: 'Masuk sekarang',
    going: 'Menghubungkan...',
    scan: 'Pindai QR voucher',
    trial: 'Coba gratis',
    cek: 'Cek sisa voucher',
    topup: 'Isi ulang internet rumah',
    prices: 'Pilihan paket',
    pricesSub: 'Harga voucher hotspot yang tersedia.',
    buy: 'Beli via WhatsApp',
    faq: 'Pertanyaan umum',
    rules: 'Ketentuan pemakaian',
    contact: 'Hubungi kami',
    f1: 'Cepat',
    f2: 'Stabil',
    f3: 'Aman',
    scanHint: 'Arahkan kamera ke QR pada voucher',
    close: 'Tutup',
    emptyCode: 'Masukkan kode voucher terlebih dahulu.',
    emptyUser: 'Masukkan username dan password.',
    camErr: 'Kamera tidak bisa dibuka. Ketik kode secara manual.',
    preview: 'Pratinjau: login tidak dikirim ke router.',
    connected: 'Anda terhubung',
    left: 'Sisa waktu',
    ip: 'Alamat IP',
    mac: 'MAC',
    uptime: 'Lama terhubung',
    down: 'Unduhan',
    up: 'Unggahan',
    quota: 'Sisa kuota',
    logout: 'Keluar',
    trialMode: 'Mode trial',
    okTitle: 'Login berhasil',
    okSub: 'Selamat berselancar!',
    redirectIn: 'Mengalihkan dalam',
    seconds: 'detik',
    goNow: 'Lanjut sekarang',
    seeStatus: 'Lihat status',
    byeTitle: 'Anda telah keluar',
    byeSub: 'Terima kasih telah menggunakan layanan kami.',
    loginAgain: 'Login kembali',
    errTitle: 'Terjadi kendala',
    back: 'Kembali ke login',
    noscript: 'Aktifkan JavaScript di browser Anda untuk login.',
  },
  en: {
    hello0: 'Good morning',
    hello1: 'Good afternoon',
    hello2: 'Good afternoon',
    hello3: 'Good evening',
    loginTitle: 'Connect to the internet',
    loginSub: 'Enter your voucher code to start browsing.',
    tabVoucher: 'Voucher',
    tabMember: 'Member',
    code: 'Voucher code',
    codePh: 'Type your voucher code',
    user: 'Username',
    pass: 'Password',
    go: 'Connect now',
    going: 'Connecting...',
    scan: 'Scan voucher QR',
    trial: 'Free trial',
    cek: 'Check voucher balance',
    topup: 'Top up home internet',
    prices: 'Packages',
    pricesSub: 'Available hotspot voucher prices.',
    buy: 'Buy via WhatsApp',
    faq: 'FAQ',
    rules: 'Terms of use',
    contact: 'Contact us',
    f1: 'Fast',
    f2: 'Stable',
    f3: 'Secure',
    scanHint: 'Point the camera at the QR code on your voucher',
    close: 'Close',
    emptyCode: 'Please enter your voucher code.',
    emptyUser: 'Please enter username and password.',
    camErr: 'Camera unavailable. Please type the code.',
    preview: 'Preview: login is not sent to the router.',
    connected: 'You are connected',
    left: 'Time left',
    ip: 'IP address',
    mac: 'MAC',
    uptime: 'Connected for',
    down: 'Download',
    up: 'Upload',
    quota: 'Quota left',
    logout: 'Log out',
    trialMode: 'Trial mode',
    okTitle: 'Login successful',
    okSub: 'Enjoy browsing!',
    redirectIn: 'Redirecting in',
    seconds: 'seconds',
    goNow: 'Continue now',
    seeStatus: 'View status',
    byeTitle: 'You have logged out',
    byeSub: 'Thank you for using our service.',
    loginAgain: 'Log in again',
    errTitle: 'Something went wrong',
    back: 'Back to login',
    noscript: 'Please enable JavaScript to log in.',
  },
};
type Key = keyof (typeof I18N)['id'];

const ICON = {
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.4 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.6-.1l2 1c.3.1.5.2.5.3.1.1.1.6-.1 1.2z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/></svg>',
  ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
  fb: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8z"/></svg>',
  tt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 3c.4 2.2 1.9 3.8 4 4v3.2a7.6 7.6 0 0 1-4-1.2V15a6 6 0 1 1-6-6v3.3a2.7 2.7 0 1 0 2.7 2.7V3z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
};

function css(c: PortalConfig, bgUrl: string) {
  const bgImage = bgUrl ? `url("${bgUrl}")` : 'none';
  return `*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
:root{--c1:${c.color1};--c2:${c.color2};--r:22px;--bgi:${bgImage}}
.t-dark{--bg:#05070e;--fg:#e9eef8;--mu:#93a0b6;--card:rgba(15,21,36,.74);--line:rgba(148,163,184,.16);--in:rgba(2,6,23,.6);--chip:rgba(148,163,184,.1);--sh:0 30px 80px -24px rgba(0,0,0,.7)}
.t-light{--bg:#eef2f8;--fg:#0e1729;--mu:#5b6b82;--card:rgba(255,255,255,.88);--line:#dce3ee;--in:#f5f7fb;--chip:#eef2f7;--sh:0 30px 60px -28px rgba(15,23,42,.3)}
@media (prefers-color-scheme:light){.t-auto{--bg:#eef2f8;--fg:#0e1729;--mu:#5b6b82;--card:rgba(255,255,255,.88);--line:#dce3ee;--in:#f5f7fb;--chip:#eef2f7;--sh:0 30px 60px -28px rgba(15,23,42,.3)}}
@media (prefers-color-scheme:dark){.t-auto{--bg:#05070e;--fg:#e9eef8;--mu:#93a0b6;--card:rgba(15,21,36,.74);--line:rgba(148,163,184,.16);--in:rgba(2,6,23,.6);--chip:rgba(148,163,184,.1);--sh:0 30px 80px -24px rgba(0,0,0,.7)}}
body{font-family:Inter,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--fg);min-height:100vh;line-height:1.5;overflow-x:hidden}
a{color:inherit;text-decoration:none}
svg{width:18px;height:18px;flex:none}
button,input{font:inherit;color:inherit}
.bg{position:fixed;inset:0;z-index:-1;overflow:hidden;background:var(--bg)}
.bg:before{content:"";position:absolute;inset:0;background-image:var(--bgi);background-size:cover;background-position:center;opacity:.55}
.bg:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent,var(--bg) 92%)}
.bg i{position:absolute;border-radius:50%;filter:blur(70px);opacity:.55;animation:float 18s ease-in-out infinite}
.bg .b1{width:46vmax;height:46vmax;left:-12vmax;top:-14vmax;background:var(--c1)}
.bg .b2{width:40vmax;height:40vmax;right:-12vmax;top:18vh;background:var(--c2);animation-delay:-6s}
.bg .b3{width:30vmax;height:30vmax;left:20vw;bottom:-14vmax;background:var(--c1);opacity:.3;animation-delay:-12s}
@keyframes float{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(4vmax,3vmax) scale(1.08)}66%{transform:translate(-3vmax,2vmax) scale(.95)}}
.p-minimal .bg i,.p-sunset .bg i{display:none}
.p-minimal .bg:before{opacity:.25}
.p-neon .bg i{opacity:.28}
.p-neon .bg{background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:44px 44px}
.p-sunset .bg{background:linear-gradient(160deg,var(--c1),var(--c2)) top/100% 46vh no-repeat,var(--bg)}
.p-sunset .bg:before{height:46vh;opacity:.35}
.p-sunset .hero,.p-sunset .top{color:#fff}.p-sunset .hero .tag,.p-sunset .hello{color:rgba(255,255,255,.85)}
.p-glass .card{background:rgba(255,255,255,.08);backdrop-filter:blur(26px) saturate(1.6);-webkit-backdrop-filter:blur(26px) saturate(1.6);border-color:rgba(255,255,255,.18)}
.t-light.p-glass .card{background:rgba(255,255,255,.62)}
.p-minimal{--r:14px}.p-minimal .card{backdrop-filter:none;-webkit-backdrop-filter:none}
.p-neon .card{border-color:color-mix(in srgb,var(--c1) 55%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--c1) 30%,transparent),0 0 40px -8px var(--c1),var(--sh)}
.p-neon .btn{box-shadow:0 0 24px -4px var(--c1)}
.wrap{max-width:1120px;margin:0 auto;padding:18px 16px 28px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.logo{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;flex:none;overflow:hidden;color:#fff;font-weight:800;font-size:18px;background:linear-gradient(135deg,var(--c1),var(--c2));box-shadow:0 8px 24px -8px var(--c1)}
.logo img{width:100%;height:100%;object-fit:contain;background:#fff}
.brand b{display:block;font-size:15px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand small{display:block;color:var(--mu);font-size:11px}
.p-sunset .brand small{color:rgba(255,255,255,.8)}
.tools{display:flex;gap:6px}
.ib{height:36px;min-width:36px;padding:0 10px;border-radius:11px;border:1px solid var(--line);background:var(--card);display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:12px;font-weight:700;cursor:pointer;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.p-sunset .top .ib{color:#fff;background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.3)}
.ann{display:flex;align-items:center;gap:10px;overflow:hidden;border:1px solid var(--line);background:var(--card);border-radius:14px;padding:9px 12px;margin-bottom:18px;font-size:13px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.ann svg{color:var(--c1)}
.ann .mq{flex:1;overflow:hidden;white-space:nowrap;mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);-webkit-mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)}
.ann .mq span{display:inline-block;padding-left:100%;animation:mq 22s linear infinite}
@keyframes mq{to{transform:translateX(-100%)}}
.main{display:grid;gap:18px;align-items:start}
@media (min-width:900px){.main{grid-template-columns:1.05fr .95fr;gap:28px}.hero{padding-top:18px}}
.hello{color:var(--mu);font-size:14px;font-weight:600}
.hero h1{font-size:clamp(28px,6vw,46px);line-height:1.08;letter-spacing:-.03em;font-weight:800;margin:6px 0 10px}
.grad{background:linear-gradient(90deg,var(--c1),var(--c2));-webkit-background-clip:text;background-clip:text;color:transparent}
.p-sunset .grad{background:none;color:#fff}
.tag{color:var(--mu);font-size:15px;max-width:520px}
.feats{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.feat{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:var(--chip);border:1px solid var(--line);font-size:12px;font-weight:700}
.feat svg{width:15px;height:15px;color:var(--c1)}
.p-sunset .feat{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.28);color:#fff}.p-sunset .feat svg{color:#fff}
.promos{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;margin-top:18px;padding-bottom:6px;scrollbar-width:none}
.promos::-webkit-scrollbar{display:none}
.promo{scroll-snap-align:start;flex:0 0 min(280px,82%);border-radius:18px;padding:16px;color:#fff;background:linear-gradient(135deg,var(--c1),var(--c2));position:relative;overflow:hidden}
.promo:nth-child(2n){background:linear-gradient(135deg,var(--c2),var(--c1))}
.promo:after{content:"";position:absolute;right:-30px;top:-30px;width:110px;height:110px;border-radius:50%;background:rgba(255,255,255,.14)}
.promo .bd{display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;background:rgba(255,255,255,.22);padding:3px 8px;border-radius:999px}
.promo b{display:block;font-size:16px;margin-top:8px;line-height:1.25}
.promo p{font-size:13px;opacity:.9;margin-top:4px}
.dots{display:flex;gap:6px;margin-top:6px}.dots i{width:6px;height:6px;border-radius:9px;background:var(--line);transition:.3s}.dots i.on{width:18px;background:var(--c1)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:22px;box-shadow:var(--sh);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.card h2{font-size:20px;letter-spacing:-.02em}
.sub{color:var(--mu);font-size:13px;margin-top:3px}
.tabs{display:flex;gap:4px;padding:4px;border-radius:13px;background:var(--in);border:1px solid var(--line);margin:16px 0 4px}
.tabs button{flex:1;border:0;background:transparent;padding:9px;border-radius:10px;font-size:13px;font-weight:700;color:var(--mu);cursor:pointer;transition:.2s}
.tabs button.on{background:var(--card);color:var(--fg);box-shadow:0 4px 12px -6px rgba(0,0,0,.4)}
.fld{margin-top:14px}
.fld label{display:block;font-size:12px;font-weight:700;color:var(--mu);margin-bottom:6px}
.inp{position:relative}
.inp input{width:100%;height:52px;border-radius:14px;border:1px solid var(--line);background:var(--in);padding:0 16px;font-size:16px;outline:none;transition:.2s}
.inp input:focus{border-color:var(--c1);box-shadow:0 0 0 4px color-mix(in srgb,var(--c1) 22%,transparent)}
#code{text-align:center;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:21px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
#code::placeholder{font-family:Inter,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;letter-spacing:0;text-transform:none;font-weight:500}
.eye{position:absolute;right:8px;top:8px;width:36px;height:36px;border:0;border-radius:10px;background:transparent;color:var(--mu);display:grid;place-items:center;cursor:pointer}
.btn{width:100%;height:52px;margin-top:16px;border:0;border-radius:14px;font-size:15px;font-weight:800;color:#fff;cursor:pointer;background:linear-gradient(135deg,var(--c1),var(--c2));box-shadow:0 14px 30px -12px var(--c1);display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:transform .15s,filter .2s}
.btn:active{transform:scale(.98)}.btn:hover{filter:brightness(1.08)}
.btn[disabled]{opacity:.75}
.btn.ghost{background:var(--chip);color:var(--fg);box-shadow:none;border:1px solid var(--line)}
.btn.danger{background:linear-gradient(135deg,#f43f5e,#e11d48);box-shadow:0 14px 30px -12px #f43f5e}
.spin{width:18px;height:18px;border-radius:50%;border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.err{display:flex;gap:8px;align-items:flex-start;margin-top:14px;padding:11px 12px;border-radius:12px;background:rgba(244,63,94,.1);border:1px solid rgba(244,63,94,.3);color:#f43f5e;font-size:13px;font-weight:600;animation:shake .4s}
@keyframes shake{25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
.row{display:flex;gap:8px;margin-top:10px}
.row .btn{margin-top:0;height:46px;font-size:13px}
.links{display:grid;gap:8px;margin-top:14px}
.lk{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:12px;border:1px solid var(--line);background:var(--in);font-size:13px;font-weight:700}
.lk svg{color:var(--c1)}.lk:after{content:"\\203A";margin-left:auto;color:var(--mu);font-size:18px}
.sec{margin-top:34px}
.sec>h3{font-size:22px;letter-spacing:-.02em}
.prices{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:12px;margin-top:14px}
.price{position:relative;border-radius:18px;padding:18px 16px 16px;background:var(--card);border:1px solid var(--line);overflow:hidden;display:flex;flex-direction:column;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);transition:transform .2s}
.price:hover{transform:translateY(-3px)}
.price:before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:var(--pc,var(--c1))}
.price .nm{font-size:13px;font-weight:800;color:var(--mu);text-transform:uppercase;letter-spacing:.06em}
.price .pr{font-size:26px;font-weight:800;letter-spacing:-.02em;margin:4px 0 10px}
.price ul{list-style:none;display:grid;gap:6px;font-size:13px;margin-bottom:14px}
.price li{display:flex;align-items:center;gap:8px}.price li svg{width:15px;height:15px;color:var(--pc,var(--c1))}
.price .btn{margin-top:auto;height:42px;font-size:13px;background:#22c55e;box-shadow:0 10px 24px -12px #22c55e}
.cols{display:grid;gap:18px}
@media (min-width:900px){.cols{grid-template-columns:1fr 1fr}}
details{border:1px solid var(--line);background:var(--card);border-radius:14px;margin-top:10px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
summary{cursor:pointer;list-style:none;padding:13px 14px;font-weight:700;font-size:14px;display:flex;justify-content:space-between;gap:10px}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";color:var(--c1);font-size:20px;line-height:1}
details[open] summary:after{content:"\\2212"}
details p{padding:0 14px 14px;color:var(--mu);font-size:13px}
.rules{margin-top:10px;padding:14px 14px 14px 32px;border:1px solid var(--line);background:var(--card);border-radius:14px;color:var(--mu);font-size:13px;display:grid;gap:6px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.contact{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.ct{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:var(--card);font-size:13px;font-weight:700}
.ct.wa{background:#22c55e;border-color:#22c55e;color:#fff}
.foot{margin-top:34px;text-align:center;color:var(--mu);font-size:12px}
.foot b{color:var(--fg)}
.center{min-height:100vh;display:flex;flex-direction:column;justify-content:center}
.center .card{max-width:440px;width:100%;margin:0 auto;text-align:center}
.badge{width:76px;height:76px;margin:4px auto 14px;border-radius:50%;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--c1),var(--c2));box-shadow:0 18px 40px -14px var(--c1);animation:pop .5s cubic-bezier(.2,1.6,.4,1)}
.badge svg{width:36px;height:36px}
.badge.bad{background:linear-gradient(135deg,#f43f5e,#f97316);box-shadow:0 18px 40px -14px #f43f5e}
.badge.ok{background:linear-gradient(135deg,#10b981,#06b6d4)}
@keyframes pop{from{transform:scale(.4);opacity:0}}
.big{margin:16px 0 4px;padding:16px;border-radius:16px;background:var(--in);border:1px solid var(--line)}
.big small{display:block;color:var(--mu);font-size:12px;font-weight:700}
.big b{display:block;font-size:30px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;text-align:left}
.kv div{padding:10px 12px;border-radius:12px;background:var(--in);border:1px solid var(--line)}
.kv small{display:block;color:var(--mu);font-size:11px;font-weight:700}
.kv b{display:block;font-size:14px;word-break:break-all}
.pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:800;background:color-mix(in srgb,var(--c1) 18%,transparent);color:var(--c1);margin-top:6px}
.bar{height:6px;border-radius:9px;background:var(--line);overflow:hidden;margin-top:14px}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--c1),var(--c2));transition:width 1s linear}
.scan{position:fixed;inset:0;z-index:50;background:rgba(2,6,23,.82);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px)}
.scan[hidden],.toast[hidden]{display:none}
.sbox{width:100%;max-width:360px;text-align:center;color:#fff}
.sbox video{width:100%;aspect-ratio:1;object-fit:cover;border-radius:22px;border:3px solid var(--c1);background:#000}
.sbox p{margin:12px 0;font-size:14px}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:60;max-width:calc(100% - 32px);padding:11px 16px;border-radius:12px;background:#0f172a;color:#fff;font-size:13px;font-weight:600;box-shadow:0 12px 40px rgba(0,0,0,.4)}
.fade{animation:fu .6s ease both}
.fade:nth-child(2){animation-delay:.08s}.fade:nth-child(3){animation-delay:.16s}
@keyframes fu{from{opacity:0;transform:translateY(14px)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media (max-width:420px){.wrap{padding:14px 12px 24px}.card{padding:18px}.kv{grid-template-columns:1fr}}`;
}

function shell(ctx: RenderContext, page: { title: string; head?: string; body: string; script?: string; cls?: string }) {
  const c = ctx.config;
  const bgUrl = c.background ? (ctx.inlineAssets ? c.background : BG_FILE) : '';
  const lang = 'id';
  return `<!DOCTYPE html>
<html lang="${lang}" class="t-${c.theme} p-${c.preset}${page.cls ? ' ' + page.cls : ''}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${h(c.color1)}">
<meta http-equiv="pragma" content="no-cache">
<meta http-equiv="expires" content="-1">
<title>${h(page.title)}</title>
${page.head ?? ''}
<style>${css(c, bgUrl)}</style>
</head>
<body>
<div class="bg" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i></div>
${page.body}
<div class="toast" id="toast" hidden></div>
<script>${commonJs(ctx)}${page.script ?? ''}</script>
</body>
</html>
`;
}

function brandName(ctx: RenderContext) {
  return ctx.config.name.trim() || ctx.brandName || 'Hotspot';
}

function header(ctx: RenderContext) {
  const c = ctx.config;
  const name = brandName(ctx);
  const logo = c.logo ? `<img src="${c.logo}" alt="">` : h(name.slice(0, 1).toUpperCase());
  return `<header class="top">
<div class="brand"><div class="logo">${logo}</div><div><b>${h(name)}</b><small>$(identity)</small></div></div>
<div class="tools">${c.bilingual ? '<button class="ib" type="button" id="lang" aria-label="Bahasa">EN</button>' : ''}<button class="ib" type="button" id="theme" aria-label="Tema">${ICON.sun}</button></div>
</header>`;
}

function footer(ctx: RenderContext) {
  const c = ctx.config;
  const year = new Date().getFullYear();
  return `<footer class="foot">${c.footer ? `<p>${h(c.footer)}</p>` : `<p>&copy; ${year} <b>${h(brandName(ctx))}</b></p>`}<p>Powered by MIKROTAL</p></footer>`;
}

/** Skrip bersama: bahasa, tema, toast. Ditulis tanpa "$(" agar aman dari template RouterOS. */
function commonJs(ctx: RenderContext) {
  const c = ctx.config;
  return `var T=${js(I18N)},L='id',D=document;
function g(i){return D.getElementById(i)}
function t(k){return (T[L]&&T[L][k])||T.id[k]||k}
function st(k,v){try{if(v===undefined)return localStorage.getItem('mt-'+k);localStorage.setItem('mt-'+k,v)}catch(e){}}
function i18n(){var n=D.querySelectorAll('[data-t]');for(var i=0;i<n.length;i++){n[i].textContent=t(n[i].getAttribute('data-t'))}var p=D.querySelectorAll('[data-tp]');for(i=0;i<p.length;i++){p[i].setAttribute('placeholder',t(p[i].getAttribute('data-tp')))}var b=g('lang');if(b)b.textContent=L==='id'?'EN':'ID';D.documentElement.lang=L}
function toast(m){var e=g('toast');if(!e)return;e.textContent=m;e.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(function(){e.hidden=true},3800)}
(function(){var bl=${c.bilingual ? 'true' : 'false'};var sl=st('lang');if(bl&&(sl==='en'||sl==='id'))L=sl;else if(bl&&navigator.language&&navigator.language.slice(0,2)!=='id'&&navigator.language.slice(0,2)!=='ms')L='en';
var r=D.documentElement,th=st('theme');if(th==='dark'||th==='light'){r.className=r.className.replace(/t-[a-z]+/,'t-'+th)}
var tb=g('theme');if(tb)tb.onclick=function(){var dark=r.className.indexOf('t-dark')>-1||(r.className.indexOf('t-auto')>-1&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);var n=dark?'light':'dark';r.className=r.className.replace(/t-[a-z]+/,'t-'+n);st('theme',n)};
var lb=g('lang');if(lb)lb.onclick=function(){L=L==='id'?'en':'id';st('lang',L);i18n();if(window.onLang)onLang()};
i18n()})();
function fmtDur(s){s=Math.max(0,Math.floor(s));var d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=s%60;function p(n){return(n<10?'0':'')+n}return(d?d+(L==='id'?' hari ':'d '):'')+p(h)+':'+p(m)+':'+p(x)}
`;
}

// ---------------------------------------------------------------- login.html

function loginPage(ctx: RenderContext) {
  const c = ctx.config;
  const name = brandName(ctx);
  const wa = waNumber(c.whatsapp || ctx.brandPhone);
  const hidden = new Set(c.hiddenProfiles);
  const prices = c.showPrices ? ctx.prices.filter((p) => p.price > 0 && !hidden.has(p.profile)) : [];
  const base = ctx.baseUrl.replace(/\/+$/, '');
  const waLink = (msg: string) => `https://wa.me/${wa}?text=${encodeURIComponent(msg)}`;

  const ann =
    c.announcement.enabled && c.announcement.text.trim()
      ? `<div class="ann fade">${ICON.bolt}${c.announcement.style === 'marquee' ? `<div class="mq"><span>${h(c.announcement.text)}</span></div>` : `<div>${h(c.announcement.text)}</div>`}</div>`
      : '';

  const promos = c.promos.length
    ? `<div class="promos" id="promos">${c.promos
        .map((p) => `<div class="promo">${p.badge ? `<span class="bd">${h(p.badge)}</span>` : ''}<b>${h(p.title)}</b>${p.text ? `<p>${h(p.text)}</p>` : ''}</div>`)
        .join('')}</div>${c.promos.length > 1 ? `<div class="dots" id="dots">${c.promos.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>` : ''}`
    : '';

  const showVoucher = c.loginMode !== 'member';
  const showMember = c.loginMode !== 'voucher';
  const tabs =
    c.loginMode === 'both'
      ? `<div class="tabs" role="tablist"><button type="button" class="on" id="tv" data-t="tabVoucher">Voucher</button><button type="button" id="tm" data-t="tabMember">Member</button></div>`
      : '';

  const priceHtml = prices.length
    ? `<section class="sec" id="harga"><h3 data-t="prices">Pilihan paket</h3><p class="sub" data-t="pricesSub">Harga voucher hotspot yang tersedia.</p><div class="prices">${prices
        .map((p) => {
          const items = [
            p.validity ? `<li>${ICON.clock}<span>${h(durationText(p.validity))}</span></li>` : '',
            p.speed ? `<li>${ICON.bolt}<span>${h(p.speed)}</span></li>` : '',
            p.timeLimit ? `<li>${ICON.wifi}<span>${h(durationText(p.timeLimit))} pemakaian</span></li>` : '',
            p.dataLimit ? `<li>${ICON.data}<span>Kuota ${h(bytesText(p.dataLimit))}</span></li>` : `<li>${ICON.data}<span>Tanpa batas kuota</span></li>`,
          ].join('');
          const color = /^#[0-9a-fA-F]{6}$/.test(p.color) ? ` style="--pc:${p.color}"` : '';
          const buy = wa ? `<a class="btn" href="${h(waLink(c.waMessage.replace(/\{paket\}/g, p.profile)))}" target="_blank" rel="noopener">${ICON.wa}<span data-t="buy">Beli via WhatsApp</span></a>` : '';
          return `<div class="price"${color}><span class="nm">${h(p.profile)}</span><span class="pr">${h(money(p.price, ctx.currency))}</span><ul>${items}</ul>${buy}</div>`;
        })
        .join('')}</div></section>`
    : '';

  const faq = c.faq.length
    ? `<div><h3 data-t="faq">Pertanyaan umum</h3>${c.faq.map((f) => `<details><summary>${h(f.q)}</summary><p>${h(f.a)}</p></details>`).join('')}</div>`
    : '';
  const ruleLines = c.rules
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rules = ruleLines.length ? `<div><h3 data-t="rules">Ketentuan pemakaian</h3><ol class="rules">${ruleLines.map((l) => `<li>${h(l)}</li>`).join('')}</ol></div>` : '';
  const infoSec = faq || rules ? `<section class="sec cols">${faq}${rules}</section>` : '';

  const handle = (s: string) => s.trim().replace(/^@/, '');
  const socials = [
    wa ? `<a class="ct wa" href="${h(waLink('Halo ' + name))}" target="_blank" rel="noopener">${ICON.wa}WhatsApp</a>` : '',
    c.phone ? `<a class="ct" href="tel:${h(c.phone.replace(/[^0-9+]/g, ''))}">${ICON.phone}${h(c.phone)}</a>` : '',
    c.instagram ? `<a class="ct" href="https://instagram.com/${h(handle(c.instagram))}" target="_blank" rel="noopener">${ICON.ig}@${h(handle(c.instagram))}</a>` : '',
    c.tiktok ? `<a class="ct" href="https://www.tiktok.com/@${h(handle(c.tiktok))}" target="_blank" rel="noopener">${ICON.tt}@${h(handle(c.tiktok))}</a>` : '',
    c.facebook ? `<a class="ct" href="${h(/^https?:\/\//.test(c.facebook) ? c.facebook : 'https://facebook.com/' + handle(c.facebook))}" target="_blank" rel="noopener">${ICON.fb}Facebook</a>` : '',
    c.website ? `<a class="ct" href="${h(/^https?:\/\//.test(c.website) ? c.website : 'http://' + c.website)}" target="_blank" rel="noopener">${ICON.globe}${h(c.website.replace(/^https?:\/\//, ''))}</a>` : '',
    c.address ? `<span class="ct">${ICON.pin}${h(c.address)}</span>` : '',
  ].join('');
  const contact = socials ? `<section class="sec"><h3 data-t="contact">Hubungi kami</h3><div class="contact">${socials}</div></section>` : '';

  const links = [
    c.cekVoucher && base ? `<a class="lk" href="${h(base)}/cek">${ICON.search}<span data-t="cek">Cek sisa voucher</span></a>` : '',
    c.pppoeTopup && base ? `<a class="lk" href="${h(base)}/isi">${ICON.home}<span data-t="topup">Isi ulang internet rumah</span></a>` : '',
  ].join('');

  const body = `<div class="wrap">
${header(ctx)}
${ann}
<main class="main">
<section class="hero fade">
<p class="hello" id="hello">Selamat datang</p>
<h1><span class="grad">${h(name)}</span></h1>
<p class="tag">${h(c.tagline)}</p>
<div class="feats"><span class="feat">${ICON.bolt}<span data-t="f1">Cepat</span></span><span class="feat">${ICON.wifi}<span data-t="f2">Stabil</span></span><span class="feat">${ICON.shield}<span data-t="f3">Aman</span></span></div>
${promos}
</section>
<section class="card fade" id="login">
<h2 data-t="loginTitle">Masuk ke internet</h2>
<p class="sub" data-t="loginSub">Masukkan kode voucher Anda untuk mulai berselancar.</p>
${tabs}
<form id="f" name="login" action="$(link-login-only)" method="post" autocomplete="off" novalidate>
<input type="hidden" name="dst" value="$(link-orig)">
<input type="hidden" name="popup" value="true">
<input type="hidden" name="username" id="hu">
<input type="hidden" name="password" id="hp">
${showVoucher ? `<div class="fld" id="pv"><label for="code" data-t="code">Kode voucher</label><div class="inp"><input id="code" type="text" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="40" value="$(username)" placeholder="Ketik kode voucher" data-tp="codePh"></div></div>` : ''}
${showMember ? `<div id="pm"${showVoucher ? ' hidden' : ''}><div class="fld"><label for="mu" data-t="user">Username</label><div class="inp"><input id="mu" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="64" value="$(username)"></div></div><div class="fld"><label for="mp" data-t="pass">Password</label><div class="inp"><input id="mp" type="password" maxlength="64"><button type="button" class="eye" id="eye" aria-label="Lihat password">${ICON.eye}</button></div></div></div>` : ''}
$(if error)<div class="err" id="err">${ICON.alert}<span id="errt">$(error)</span></div>$(endif)
<noscript><div class="err" data-t="noscript">Aktifkan JavaScript di browser Anda untuk login.</div></noscript>
<button class="btn" id="go" type="submit"><span data-t="go">Masuk sekarang</span></button>
</form>
<div class="row">${c.qrScan ? `<button type="button" class="btn ghost" id="qr" hidden>${ICON.qr}<span data-t="scan">Pindai QR voucher</span></button>` : ''}${c.trial ? `$(if trial == 'yes')<a class="btn ghost" href="$(link-login-only)?dst=$(link-orig-esc)&amp;username=T-$(mac-esc)">${ICON.gift}<span data-t="trial">Coba gratis</span></a>$(endif)` : ''}</div>
${links ? `<div class="links">${links}</div>` : ''}
</section>
</main>
${priceHtml}
${infoSec}
${contact}
${footer(ctx)}
</div>
${c.qrScan ? `<div class="scan" id="scan" hidden><div class="sbox"><video id="vid" playsinline muted></video><p data-t="scanHint">Arahkan kamera ke QR pada voucher</p><button type="button" class="btn ghost" id="sclose" data-t="close">Tutup</button></div></div>` : ''}`;

  const script = `var CHAP_ID='',CHAP_CH='';
</script>
$(if chap-id)<script>CHAP_ID='$(chap-id)';CHAP_CH='$(chap-challenge)';</script>$(endif)
<script>
${MD5_JS}
(function(){
var mode=${js(c.loginMode === 'member' ? 'member' : 'voucher')},f=g('f'),busy=false;
var h=new Date().getHours(),he=g('hello');function hello(){if(he)he.textContent=t('hello'+(h<11?0:h<15?1:h<18?2:3))}hello();window.onLang=function(){hello();tr()};
function tr(){var e=g('errt');if(!e)return;var m=(e.getAttribute('data-o')||e.textContent);e.setAttribute('data-o',m);var s=m.toLowerCase(),id=null,en=null;
if(s.indexOf('invalid username or password')>-1||s.indexOf('invalid password')>-1){id='Kode voucher atau password salah.';en='Wrong voucher code or password.'}
else if(s.indexOf('uptime limit')>-1){id='Masa pakai voucher ini sudah habis.';en='This voucher has run out of time.'}
else if(s.indexOf('traffic limit')>-1||s.indexOf('bytes limit')>-1){id='Kuota voucher ini sudah habis.';en='This voucher has run out of quota.'}
else if(s.indexOf('no more sessions')>-1||s.indexOf('already logged')>-1){id='Voucher sedang dipakai di perangkat lain.';en='This voucher is in use on another device.'}
else if(s.indexOf('disabled')>-1){id='Voucher ini sudah tidak aktif.';en='This voucher is no longer active.'}
else if(s.indexOf('expired')>-1){id='Voucher ini sudah kedaluwarsa.';en='This voucher has expired.'}
if(id)e.textContent=L==='id'?id:en}tr();
var tv=g('tv'),tm=g('tm');function sw(m){mode=m;if(tv){tv.className=m==='voucher'?'on':'';tm.className=m==='member'?'on':''}var pv=g('pv'),pm=g('pm');if(pv)pv.hidden=m!=='voucher';if(pm)pm.hidden=m!=='member';var x=g(m==='voucher'?'code':'mu');if(x&&!('ontouchstart' in window))x.focus()}
if(tv){tv.onclick=function(){sw('voucher')};tm.onclick=function(){sw('member')}}
var eye=g('eye');if(eye)eye.onclick=function(){var p=g('mp');p.type=p.type==='password'?'text':'password'};
var code=g('code');if(code)code.oninput=function(){var p=code.selectionStart;code.value=code.value.replace(/\\s+/g,'');try{code.setSelectionRange(p,p)}catch(e){}};
function login(u,p){if(busy)return false;if(window.MIKROTAL_PREVIEW){toast(t('preview'));return false}busy=true;g('hu').value=u;g('hp').value=CHAP_ID?hexMD5(CHAP_ID+p+CHAP_CH):p;var b=g('go');b.disabled=true;b.innerHTML='<span class="spin"></span><span>'+t('going')+'</span>';st('last',u);f.submit();return false}
f.onsubmit=function(e){if(e&&e.preventDefault)e.preventDefault();if(mode==='voucher'){var c=(code&&code.value||'').trim();if(!c){toast(t('emptyCode'));code.focus();return false}return login(c,c)}var u=(g('mu').value||'').trim(),p=g('mp').value||'';if(!u||!p){toast(t('emptyUser'));return false}return login(u,p)};
function fromText(s){s=(s||'').trim();var u=null,p=null;var q=s.indexOf('?');if(q>-1){var ps=s.slice(q+1).split('&');for(var i=0;i<ps.length;i++){var kv=ps[i].split('=');var k=decodeURIComponent(kv[0]||''),v=decodeURIComponent((kv[1]||'').replace(/\\+/g,' '));if(k==='username'||k==='user'||k==='code')u=v;if(k==='password'||k==='pass')p=v}}else if(/^[A-Za-z0-9._@-]{3,40}$/.test(s)){u=s}return u?{u:u,p:p===null?u:p}:null}
var qp=fromText(location.search||'');var hasErr=!!g('err');
if(qp&&!hasErr){var key='mt-auto-'+qp.u,done=false;try{done=sessionStorage.getItem(key)}catch(e){}if(!done){try{sessionStorage.setItem(key,'1')}catch(e){}if(qp.p!==qp.u&&tm)sw('member');if(mode==='voucher'&&code)code.value=qp.u;else if(g('mu')){g('mu').value=qp.u;g('mp').value=qp.p}setTimeout(function(){login(qp.u,qp.p)},300)}}
else if(code&&!code.value){var last=st('last');if(last&&hasErr)code.value=last}
var pr=g('promos'),dots=g('dots');if(pr&&dots){var di=dots.children;pr.onscroll=function(){var w=pr.firstElementChild.offsetWidth+12,k=Math.round(pr.scrollLeft/w);for(var i=0;i<di.length;i++)di[i].className=i===k?'on':''};setInterval(function(){if(pr.matches&&pr.matches(':hover'))return;var w=pr.firstElementChild.offsetWidth+12,max=pr.scrollWidth-pr.clientWidth;pr.scrollTo({left:pr.scrollLeft+w>max+4?0:pr.scrollLeft+w,behavior:'smooth'})},5000)}
var qb=g('qr'),sc=g('scan'),vid=g('vid'),stream=null,timer=null;
function stop(){if(timer)clearInterval(timer);timer=null;if(stream){stream.getTracks().forEach(function(x){x.stop()})}stream=null;if(sc)sc.hidden=true}
if(qb&&window.BarcodeDetector&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){qb.hidden=false;qb.onclick=function(){var det;try{det=new BarcodeDetector({formats:['qr_code']})}catch(e){toast(t('camErr'));return}
navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(function(s){stream=s;vid.srcObject=s;vid.play();sc.hidden=false;timer=setInterval(function(){det.detect(vid).then(function(r){if(!r||!r.length)return;var x=fromText(r[0].rawValue);if(!x)return;stop();if(x.p!==x.u&&tm)sw('member');if(mode==='voucher'&&code)code.value=x.u;else if(g('mu')){g('mu').value=x.u;g('mp').value=x.p}login(x.u,x.p)}).catch(function(){})},350)}).catch(function(){toast(t('camErr'))})};g('sclose').onclick=stop}
})();`;
  return shell(ctx, { title: `${name} - Login Hotspot`, body, script });
}

// --------------------------------------------------------------- status.html

function statusPage(ctx: RenderContext) {
  const c = ctx.config;
  const target = c.redirectUrl ? h(c.redirectUrl) : '$(link-orig)';
  const body = `<div class="wrap center">
${header(ctx)}
<section class="card fade">
<div class="badge ok">${ICON.wifi}</div>
<h2 data-t="connected">Anda terhubung</h2>
<p class="sub"><b>$(username)</b></p>
$(if login-by == 'trial')<span class="pill">${ICON.gift}<span data-t="trialMode">Mode trial</span></span>$(endif)
$(if session-time-left)<div class="big"><small data-t="left">Sisa waktu</small><b id="left" data-s="$(session-time-left-secs)">$(session-time-left)</b><div class="bar"><i id="lb" style="width:100%"></i></div></div>$(endif)
${
  c.showUsage
    ? `<div class="kv">
<div><small data-t="down">Unduhan</small><b>$(bytes-out-nice)</b></div>
<div><small data-t="up">Unggahan</small><b>$(bytes-in-nice)</b></div>
<div><small data-t="uptime">Lama terhubung</small><b id="up" data-s="$(uptime-secs)">$(uptime)</b></div>
$(if remain-bytes-total)<div><small data-t="quota">Sisa kuota</small><b>$(remain-bytes-total-nice)</b></div>$(else)<div><small data-t="ip">Alamat IP</small><b>$(ip)</b></div>$(endif)
<div><small data-t="mac">MAC</small><b>$(mac)</b></div>
$(if remain-bytes-total)<div><small data-t="ip">Alamat IP</small><b>$(ip)</b></div>$(endif)
</div>`
    : ''
}
<form action="$(link-logout)" name="logout" method="post"><input type="hidden" name="erase-cookie" value="on"><button class="btn danger" type="submit">${ICON.out}<span data-t="logout">Keluar</span></button></form>
$(if link-orig)<a class="btn ghost" href="${target}" style="margin-top:10px"><span data-t="goNow">Lanjut sekarang</span></a>$(endif)
</section>
${footer(ctx)}
</div>`;
  const script = `(function(){var l=g('left'),u=g('up'),lb=g('lb');var ls=parseInt(l&&l.getAttribute('data-s'),10),us=parseInt(u&&u.getAttribute('data-s'),10),total=(ls||0)+(us||0);
function tick(){if(l&&ls>=0){l.textContent=fmtDur(ls);if(lb&&total>0)lb.style.width=Math.max(0,ls/total*100)+'%';if(ls>0)ls--}if(u&&us>=0){u.textContent=fmtDur(us);us++}}
if(ls>=0||us>=0){tick();setInterval(tick,1000)}})();`;
  const head = `$(if refresh-timeout)<meta http-equiv="refresh" content="$(refresh-timeout-secs)">$(endif)`;
  return shell(ctx, { title: `${brandName(ctx)} - Status`, head, body, script });
}

// --------------------------------------------------------------- alogin.html

function aloginPage(ctx: RenderContext) {
  const c = ctx.config;
  const target = c.redirectUrl ? js(c.redirectUrl) : "'$(link-redirect)'";
  const body = `<div class="wrap center">
${header(ctx)}
<section class="card fade">
<div class="badge ok">${ICON.check}</div>
<h2 data-t="okTitle">Login berhasil</h2>
<p class="sub"><b>$(username)</b> &middot; <span data-t="okSub">Selamat berselancar!</span></p>
${c.redirectDelay > 0 ? `<div class="big"><small data-t="redirectIn">Mengalihkan dalam</small><b><span id="cd">${c.redirectDelay}</span> <span data-t="seconds" style="font-size:16px">detik</span></b><div class="bar"><i id="cb" style="width:100%"></i></div></div>` : ''}
<a class="btn" id="next" href="$(link-redirect)"><span data-t="goNow">Lanjut sekarang</span></a>
<a class="btn ghost" href="$(link-status)" style="margin-top:10px"><span data-t="seeStatus">Lihat status</span></a>
</section>
${footer(ctx)}
</div>`;
  const script = `(function(){var to=${target};var n=g('next');if(to&&n)n.href=to;var s=${c.redirectDelay},total=s,cd=g('cd'),cb=g('cb');function go(){if(window.MIKROTAL_PREVIEW)return;if(to)location.href=to}
if(s<=0){go();return}var it=setInterval(function(){s--;if(cd)cd.textContent=s;if(cb)cb.style.width=Math.max(0,s/total*100)+'%';if(s<=0){clearInterval(it);go()}},1000)})();`;
  return shell(ctx, { title: `${brandName(ctx)} - Login berhasil`, body, script });
}

// --------------------------------------------------------------- logout.html

function logoutPage(ctx: RenderContext) {
  const body = `<div class="wrap center">
${header(ctx)}
<section class="card fade">
<div class="badge">${ICON.out}</div>
<h2 data-t="byeTitle">Anda telah keluar</h2>
<p class="sub" data-t="byeSub">Terima kasih telah menggunakan layanan kami.</p>
<div class="kv">
<div><small data-t="user">Username</small><b>$(username)</b></div>
<div><small data-t="uptime">Lama terhubung</small><b>$(uptime)</b></div>
<div><small data-t="down">Unduhan</small><b>$(bytes-out-nice)</b></div>
<div><small data-t="up">Unggahan</small><b>$(bytes-in-nice)</b></div>
</div>
<a class="btn" href="$(link-login)"><span data-t="loginAgain">Login kembali</span></a>
</section>
${footer(ctx)}
</div>`;
  return shell(ctx, { title: `${brandName(ctx)} - Keluar`, body });
}

// ---------------------------------------------------------------- error.html

function errorPage(ctx: RenderContext) {
  const body = `<div class="wrap center">
${header(ctx)}
<section class="card fade">
<div class="badge bad">${ICON.alert}</div>
<h2 data-t="errTitle">Terjadi kendala</h2>
<p class="sub">$(error)</p>
<a class="btn" href="$(link-login)"><span data-t="back">Kembali ke login</span></a>
</section>
${footer(ctx)}
</div>`;
  return shell(ctx, { title: `${brandName(ctx)} - Kendala`, body });
}

const RENDERERS: Record<PortalPage, (ctx: RenderContext) => string> = {
  'login.html': loginPage,
  'alogin.html': aloginPage,
  'status.html': statusPage,
  'logout.html': logoutPage,
  'error.html': errorPage,
};

export function renderPage(page: PortalPage, ctx: RenderContext) {
  return RENDERERS[page](ctx);
}

/** Semua file yang akan dipasang ke router (halaman + gambar latar bila ada). */
export function renderPortalFiles(ctx: RenderContext): { name: string; data: Buffer; type: string }[] {
  const files = PORTAL_PAGES.map((p) => ({ name: p as string, data: Buffer.from(renderPage(p, { ...ctx, inlineAssets: false }), 'utf8'), type: 'text/html; charset=utf-8' }));
  const bg = ctx.config.background.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (bg) files.push({ name: BG_FILE, data: Buffer.from(bg[2], 'base64'), type: bg[1] });
  return files;
}

/** Variabel contoh untuk pratinjau di MIKROTAL. */
export function previewVars(page: PortalPage, state: 'normal' | 'error' | 'trial' = 'normal'): Record<string, string> {
  const base: Record<string, string> = {
    identity: 'MikroTik-Hotspot',
    'link-login-only': '#',
    'link-login': '#',
    'link-logout': '#',
    'link-status': '#',
    'link-orig': 'http://example.com/',
    'link-orig-esc': 'http%3A%2F%2Fexample.com%2F',
    'link-redirect': 'http://example.com/',
    'mac-esc': '02%3A1A%3A2B%3A3C%3A4D%3A5E',
    mac: '02:1A:2B:3C:4D:5E',
    ip: '10.5.50.37',
    trial: 'yes',
    username: page === 'login.html' ? '' : 'K7XP2Q',
    uptime: '1h12m40s',
    'uptime-secs': '4360',
    'session-time-left': '22h47m20s',
    'session-time-left-secs': '82040',
    'bytes-in-nice': '48.6 MiB',
    'bytes-out-nice': '1.2 GiB',
    'remain-bytes-total': '',
    'refresh-timeout': '',
    'login-by': state === 'trial' ? 'trial' : 'http-chap',
  };
  if (state === 'error') base.error = page === 'error.html' ? 'hotspot service is not available' : 'invalid username or password';
  else if (page === 'error.html') base.error = 'hotspot service is not available';
  return base;
}
