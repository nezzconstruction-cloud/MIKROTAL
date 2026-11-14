export interface Customer {
  id: number;
  router_id: number;
  name: string;
  phone: string;
  address: string;
  username: string;
  password: string;
  package_id: number | null;
  package_name: string | null;
  package_price: number | null;
  profile: string;
  odp_id: number | null;
  odp_port: number | null;
  lat: number | null;
  lng: number | null;
  odp_name: string | null;
  odc_name: string | null;
  status: 'active' | 'isolated' | 'disabled';
  expires_at: string | null;
  online: number;
  on_router: number;
  ip: string;
  mac: string;
  uptime_seconds: number;
  last_seen_at: string | null;
  note: string;
  router_name?: string;
  created_at: string;
}

export interface PppPackage {
  id: number;
  router_id: number;
  name: string;
  profile: string;
  price: number;
  reseller_price: number;
  validity: string;
  active: number;
  customers: number;
}

export interface TopoCustomer {
  id: number;
  name: string;
  username: string;
  status: Customer['status'];
  online: number;
  on_router: number;
  odp_id: number | null;
  odp_port: number | null;
  lat: number | null;
  lng: number | null;
  expires_at: string | null;
  last_seen_at: string | null;
  package_name: string | null;
}

export interface TopoOdp {
  id: number;
  odc_id: number | null;
  odc_port: number | null;
  name: string;
  location: string;
  ports: number;
  lat: number | null;
  lng: number | null;
  note: string;
  customers: TopoCustomer[];
  used: number;
  online: number;
  down: boolean;
}

export interface TopoOdc {
  id: number;
  name: string;
  location: string;
  ports: number;
  lat: number | null;
  lng: number | null;
  note: string;
  odps: TopoOdp[];
  used: number;
  customers: number;
  online: number;
}

export interface Topology {
  server: { id: number; name: string; location: string; lat: number | null; lng: number | null };
  odcs: TopoOdc[];
  looseOdps: TopoOdp[];
  unassigned: TopoCustomer[];
}

export const CUSTOMER_STATUS: Record<Customer['status'], { label: string; tone: 'green' | 'yellow' | 'gray' }> = {
  active: { label: 'Aktif', tone: 'green' },
  isolated: { label: 'Terisolir', tone: 'yellow' },
  disabled: { label: 'Nonaktif', tone: 'gray' },
};

/** Sisa hari masa aktif (dibulatkan ke atas); null = tanpa batas. */
export function daysLeft(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  return Math.ceil((Date.parse(expiresAt) - Date.now()) / 86400_000);
}

/** Kode voucher dikelompokkan per 4-5 karakter agar mudah dibaca: 12345 67890 */
export function groupCode(code: string) {
  const size = code.length % 4 === 0 ? 4 : code.length % 5 === 0 ? 5 : 4;
  return code.replace(new RegExp(`(.{${size}})(?=.)`, 'g'), '$1 ');
}

export interface DiagPoint {
  type: 'server' | 'odc' | 'odp' | 'customer';
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface Finding {
  key: string;
  kind: 'server' | 'feeder' | 'distribution' | 'drop' | 'ambiguous';
  severity: 'critical' | 'warning';
  confidence: 'tinggi' | 'sedang' | 'rendah';
  title: string;
  reason: string;
  steps: string[];
  from: DiagPoint;
  to: DiagPoint;
  distanceM: number | null;
  since: string | null;
  simultaneous: boolean | null;
  affected: { id: number; name: string; username: string; phone: string; odp: string; port: number | null; last_seen_at: string | null; lastLog?: string }[];
}

export interface Diagnosis {
  scannedAt: string;
  totals: { customers: number; online: number; offline: number; neverOnline: number; unassignedOffline: number };
  findings: Finding[];
  neverOnline: { id: number; name: string; username: string; odp: string }[];
  unassignedOffline: { id: number; name: string; username: string; last_seen_at: string | null }[];
  syncError?: string;
}

export const FINDING_KIND: Record<Finding['kind'], string> = {
  server: 'Sisi server',
  feeder: 'Kabel feeder',
  distribution: 'Kabel distribusi',
  drop: 'Kabel drop',
  ambiguous: 'Drop atau distribusi',
};

export function formatDistance(m: number | null | undefined) {
  if (m == null) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m} m`;
}

export function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function hasCoord<T extends { lat: number | null; lng: number | null }>(p: T): p is T & { lat: number; lng: number } {
  return p.lat != null && p.lng != null;
}

/** Baca koordinat dari teks "-6.2, 106.8" atau tautan Google Maps. */
export function parseCoord(text: string): { lat: number; lng: number } | null {
  const t = text.trim();
  const m =
    t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ??
    t.match(/[@=](-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ??
    t.match(/^(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.'));
  const lng = Number(m[2].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
