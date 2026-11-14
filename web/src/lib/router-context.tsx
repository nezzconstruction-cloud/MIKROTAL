import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import { useAuth } from './auth';
import type { Snapshot } from './realtime';

export interface RouterInfo {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  use_tls: boolean;
  simulate: boolean;
  location: string;
  wan_interface: string;
  hotspot_dns: string;
  notes: string;
  enabled: boolean;
  status: string;
  status_message: string;
  identity: string;
  version: string;
  board: string;
  last_seen_at: string | null;
  has_password: boolean;
  snapshot: Snapshot | null;
}

interface RouterCtx {
  routers: RouterInfo[];
  routerId: number | undefined;
  router: RouterInfo | undefined;
  setRouterId: (id: number) => void;
  loading: boolean;
}

const Ctx = createContext<RouterCtx | null>(null);
const KEY = 'mikrotal.router';

export function RouterProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data: routers = [], isLoading } = useQuery({
    queryKey: ['routers'],
    queryFn: () => get<RouterInfo[]>('/api/routers'),
    enabled: !!user,
    refetchInterval: 30000,
  });
  const [routerId, setId] = useState<number | undefined>(() => {
    try {
      const v = Number(localStorage.getItem(KEY));
      return v > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  });

  useEffect(() => {
    if (!routers.length) return;
    if (!routerId || !routers.some((r) => r.id === routerId)) setId(routers[0].id);
  }, [routers, routerId]);

  const value = useMemo<RouterCtx>(
    () => ({
      routers,
      routerId,
      router: routers.find((r) => r.id === routerId),
      setRouterId: (id: number) => {
        setId(id);
        try {
          localStorage.setItem(KEY, String(id));
        } catch {
          /* abaikan */
        }
      },
      loading: isLoading,
    }),
    [routers, routerId, isLoading],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRouters() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRouters di luar RouterProvider');
  return ctx;
}
