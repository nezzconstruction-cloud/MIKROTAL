const TOKEN_KEY = 'mikrotal.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* abaikan */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Isi respons error dari server (mis. langkah yang sudah dijalankan). */
    public data?: any,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(query?: Query) {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/** MIKROTAL Cloud: langganan habis/dihentikan (HTTP 402) → arahkan ke halaman Langganan. */
let onSubscriptionInactive: (() => void) | undefined;
export function setSubscriptionInactiveHandler(fn: (() => void) | undefined) {
  onSubscriptionInactive = fn;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${path}${qs(opts.query)}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Tidak dapat terhubung ke server MIKROTAL');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    if (res.status === 402 && typeof data === 'object' && (data as any)?.code === 'SUBSCRIPTION_INACTIVE') onSubscriptionInactive?.();
    const message = typeof data === 'object' && data && 'error' in data ? String((data as any).error) : `Permintaan gagal (${res.status})`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

export const get = <T = any>(path: string, query?: Query) => api<T>(path, { query });
export const post = <T = any>(path: string, body?: unknown, query?: Query) => api<T>(path, { method: 'POST', body: body ?? {}, query });
export const patch = <T = any>(path: string, body?: unknown, query?: Query) => api<T>(path, { method: 'PATCH', body: body ?? {}, query });
export const put = <T = any>(path: string, body?: unknown, query?: Query) => api<T>(path, { method: 'PUT', body: body ?? {}, query });
export const del = <T = any>(path: string, query?: Query) => api<T>(path, { method: 'DELETE', query });

/** Unduh file (CSV) dengan token. */
export async function download(path: string, query: Query, filename: string) {
  const token = getToken();
  const res = await fetch(`${path}${qs(query)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'Gagal mengunduh file');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Path API untuk menu RouterOS generik. */
export const res = {
  list: (routerId: number, path: string) => get<Record<string, string>[]>(`/api/routers/${routerId}/res`, { path }),
  add: (routerId: number, path: string, body: Record<string, unknown>) => post<{ id: string }>(`/api/routers/${routerId}/res`, body, { path }),
  set: (routerId: number, path: string, id: string, body: Record<string, unknown>) => patch(`/api/routers/${routerId}/res/${encodeURIComponent(id)}`, body, { path }),
  remove: (routerId: number, path: string, id: string) => del(`/api/routers/${routerId}/res/${encodeURIComponent(id)}`, { path }),
  action: (routerId: number, path: string, id: string, action: string) => post(`/api/routers/${routerId}/res/${encodeURIComponent(id)}/${action}`, {}, { path }),
  bulk: (routerId: number, path: string, action: 'remove' | 'enable' | 'disable', ids: string[]) => post(`/api/routers/${routerId}/res-bulk`, { action, ids }, { path }),
};
