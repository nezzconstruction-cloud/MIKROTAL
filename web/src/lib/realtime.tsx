import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getToken } from './api';
import { useAuth } from './auth';

export interface Snapshot {
  routerId: number;
  online: boolean;
  ts: number;
  error?: string;
  identity?: string;
  version?: string;
  board?: string;
  uptime?: string;
  uptimeSeconds?: number;
  cpu?: number;
  cpuCount?: number;
  memUsed?: number;
  memTotal?: number;
  hddUsed?: number;
  hddTotal?: number;
  hotspotActive?: number;
  pppActive?: number;
  dhcpLeases?: number;
  wan?: string;
  rx?: number;
  tx?: number;
  temperature?: number;
  voltage?: number;
  interfacesDown?: string[];
}

export interface TrafficEvent {
  routerId: number;
  ts: number;
  interfaces: { name: string; rx: number; tx: number; rxPps: number; txPps: number }[];
}

type Handler = (data: any) => void;

interface RealtimeState {
  connected: boolean;
  snapshots: Record<number, Snapshot>;
  on: (type: string, fn: Handler) => () => void;
  send: (msg: unknown) => void;
}

const Ctx = createContext<RealtimeState | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<number, Snapshot>>({});
  const handlers = useRef(new Map<string, Set<Handler>>());
  const wsRef = useRef<WebSocket | null>(null);
  const pending = useRef<unknown[]>([]);

  const emit = (type: string, data: unknown) => handlers.current.get(type)?.forEach((fn) => fn(data));

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const token = getToken();
      if (!token || stopped) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        for (const m of pending.current) ws.send(JSON.stringify(m));
        pending.current = [];
        emit('open', null);
      };
      ws.onmessage = (ev) => {
        let msg: { type: string; data: any };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'status') {
          setSnapshots((s) => ({ ...s, [msg.data.routerId]: msg.data }));
        } else if (msg.type === 'alert') {
          void qc.invalidateQueries({ queryKey: ['alerts'] });
        } else if (msg.type === 'vouchers') {
          void qc.invalidateQueries({ queryKey: ['vouchers'] });
          void qc.invalidateQueries({ queryKey: ['batches'] });
        } else if (msg.type === 'customers') {
          for (const key of ['customers', 'customer', 'topology', 'pppoe-summary']) void qc.invalidateQueries({ queryKey: [key] });
        } else if (msg.type === 'ppp-vouchers') {
          for (const key of ['ppp-vouchers', 'ppp-batches', 'pppoe-summary']) void qc.invalidateQueries({ queryKey: [key] });
        }
        emit(msg.type, msg.data);
      };
      ws.onclose = (ev) => {
        setConnected(false);
        wsRef.current = null;
        if (stopped || ev.code === 4401) return;
        retry++;
        timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(retry, 4)));
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [user, qc]);

  const on = useCallback((type: string, fn: Handler) => {
    let set = handlers.current.get(type);
    if (!set) {
      set = new Set();
      handlers.current.set(type, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }, []);

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else pending.current.push(msg);
  }, []);

  return <Ctx.Provider value={{ connected, snapshots, on, send }}>{children}</Ctx.Provider>;
}

export function useRealtime() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRealtime di luar RealtimeProvider');
  return ctx;
}

export function useRealtimeEvent(type: string, fn: Handler) {
  const { on } = useRealtime();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => on(type, (d) => ref.current(d)), [on, type]);
}

/** Berlangganan trafik realtime beberapa interface; mengembalikan riwayat titik per interface. */
export function useLiveTraffic(routerId: number | undefined, interfaces: string[], maxPoints = 60) {
  const { send, on } = useRealtime();
  const [series, setSeries] = useState<Record<string, { ts: number; rx: number; tx: number }[]>>({});
  const key = interfaces.join(',');

  useEffect(() => {
    setSeries({});
    if (!routerId || !interfaces.length) return;
    const subscribe = () => send({ type: 'traffic.subscribe', routerId, interfaces });
    subscribe();
    const offOpen = on('open', subscribe);
    const offTraffic = on('traffic', (t: TrafficEvent) => {
      if (t.routerId !== routerId) return;
      setSeries((prev) => {
        const next = { ...prev };
        for (const i of t.interfaces) {
          const arr = (next[i.name] ?? []).concat({ ts: t.ts, rx: i.rx, tx: i.tx });
          next[i.name] = arr.length > maxPoints ? arr.slice(arr.length - maxPoints) : arr;
        }
        return next;
      });
    });
    return () => {
      offOpen();
      offTraffic();
      send({ type: 'traffic.unsubscribe' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerId, key, send, on, maxPoints]);

  return series;
}
