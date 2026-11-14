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
  note: string;
  odps: TopoOdp[];
  used: number;
  customers: number;
  online: number;
}

export interface Topology {
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
