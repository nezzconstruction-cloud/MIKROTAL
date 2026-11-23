import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Warna harus format #RRGGBB');
const text = (max: number) => z.string().max(max).default('');
const image = (maxKb: number) =>
  z
    .string()
    .max(maxKb * 1370, `Gambar terlalu besar (maks ${maxKb} KB)`)
    .regex(/^(data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+)?$/, 'Gambar harus PNG, JPG, WEBP, GIF, atau SVG')
    .default('');

export const PRESETS = ['aurora', 'glass', 'minimal', 'neon', 'sunset'] as const;

export const portalConfigSchema = z.object({
  preset: z.enum(PRESETS).default('aurora'),
  theme: z.enum(['dark', 'light', 'auto']).default('dark'),
  color1: hex.default('#06b6d4'),
  color2: hex.default('#6366f1'),
  name: text(40),
  tagline: text(80).default('Internet cepat, stabil, dan terjangkau'),
  logo: image(100),
  background: image(300),

  loginMode: z.enum(['voucher', 'member', 'both']).default('both'),
  trial: z.boolean().default(false),
  qrScan: z.boolean().default(true),
  redirectUrl: z
    .string()
    .max(200)
    .regex(/^(https?:\/\/\S+)?$/, 'URL harus diawali http:// atau https://')
    .default(''),
  redirectDelay: z.number().int().min(0).max(30).default(4),

  announcement: z
    .object({ enabled: z.boolean().default(false), text: text(300), style: z.enum(['marquee', 'banner']).default('marquee') })
    .default({ enabled: false, text: '', style: 'marquee' }),
  promos: z
    .array(z.object({ badge: text(20), title: z.string().min(1).max(50), text: text(160) }))
    .max(6)
    .default([]),
  showPrices: z.boolean().default(true),
  hiddenProfiles: z.array(z.string().max(64)).max(100).default([]),
  faq: z
    .array(z.object({ q: z.string().min(1).max(120), a: z.string().min(1).max(500) }))
    .max(10)
    .default([]),
  rules: text(1500),

  whatsapp: text(20),
  waMessage: text(200).default('Halo, saya mau beli voucher {paket}'),
  phone: text(30),
  address: text(200),
  instagram: text(60),
  facebook: text(100),
  tiktok: text(60),
  website: text(100),

  cekVoucher: z.boolean().default(true),
  pppoeTopup: z.boolean().default(false),
  bilingual: z.boolean().default(true),
  showUsage: z.boolean().default(true),
  footer: text(120),
});

export type PortalConfig = z.infer<typeof portalConfigSchema>;

export function defaultPortalConfig(): PortalConfig {
  return portalConfigSchema.parse({
    promos: [
      { badge: 'Baru', title: 'Voucher harian makin hemat', text: 'Internet seharian penuh tanpa batas kuota.' },
      { badge: 'Tips', title: 'Satu voucher, satu perangkat', text: 'Simpan kode voucher Anda untuk login kembali.' },
    ],
    faq: [
      { q: 'Bagaimana cara membeli voucher?', a: 'Hubungi kami lewat WhatsApp atau beli langsung di warung/reseller terdekat.' },
      { q: 'Voucher saya tidak bisa dipakai, kenapa?', a: 'Pastikan kode diketik benar tanpa spasi. Satu voucher hanya bisa dipakai di satu perangkat sekaligus.' },
      { q: 'Kapan masa aktif voucher mulai dihitung?', a: 'Sejak pertama kali voucher dipakai untuk login.' },
    ],
    rules: 'Dilarang mengakses konten ilegal.\nDilarang menyebarkan kode voucher.\nKecepatan dibagi untuk semua pengguna di jam sibuk.',
  });
}

export interface PriceItem {
  profile: string;
  price: number;
  validity: string;
  timeLimit: string;
  dataLimit: number;
  speed: string;
  color: string;
}
