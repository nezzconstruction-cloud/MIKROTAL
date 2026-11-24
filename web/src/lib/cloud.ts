import { useQuery } from '@tanstack/react-query';
import { ApiError, get } from './api';

export type Phase = 'trial' | 'active' | 'grace' | 'expired' | 'suspended' | 'deleted';

export interface CloudStatus {
  phase: Phase;
  canUse: boolean;
  trial: boolean;
  planCode: string;
  planName: string;
  maxRouters: number;
  periodEnd: string;
  graceEnd: string;
  daysLeft: number;
  reason: string;
}

export interface CloudPlan {
  code: string;
  name: string;
  price_monthly: number;
  max_routers: number;
  description: string;
}

export interface CloudSubscription {
  tenant: { slug: string; business_name: string; owner_name: string; email: string; phone: string; created_at: string };
  status: CloudStatus;
  usage: { routers: number };
  plans: CloudPlan[];
  months: number[];
  bankAccounts: { bank: string; number: string; holder: string }[];
  paymentNote: string;
  support: { whatsapp: string; email: string };
  brandName: string;
  publicUrl: string;
}

export const PHASE_LABEL: Record<Phase, string> = {
  trial: 'Uji coba',
  active: 'Aktif',
  grace: 'Masa tenggang',
  expired: 'Berhenti',
  suspended: 'Dihentikan admin',
  deleted: 'Dihapus',
};

export const PHASE_TONE: Record<Phase, 'green' | 'cyan' | 'yellow' | 'red' | 'gray'> = {
  trial: 'cyan',
  active: 'green',
  grace: 'yellow',
  expired: 'red',
  suspended: 'red',
  deleted: 'gray',
};

/**
 * Data langganan MIKROTAL Cloud. Di instalasi sendiri (self-hosted) endpoint tidak ada (404),
 * sehingga `data` bernilai null dan menu Langganan tidak ditampilkan.
 */
export function useCloud() {
  return useQuery({
    queryKey: ['cloud-subscription'],
    queryFn: async () => {
      try {
        return await get<CloudSubscription>('/api/cloud/subscription');
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
}

/** Salin teks ke clipboard; kembali false bila browser menolak. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
