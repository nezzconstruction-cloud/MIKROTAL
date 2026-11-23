import { ApiError, qs } from '../lib/api';

/** Token admin platform disimpan terpisah dari token aplikasi pelanggan. */
const KEY = 'mikrotal.platform.token';

export function getAdminToken() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(t: string | null) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* abaikan */
  }
}

let onUnauthorized: (() => void) | undefined;
export const setPlatformUnauthorized = (fn: () => void) => (onUnauthorized = fn);

export async function papi<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
  const token = getAdminToken();
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api/platform${path}${qs(opts.query)}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server');
  }
  const data = (res.headers.get('content-type') ?? '').includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, typeof data === 'object' && data && 'error' in data ? String((data as any).error) : `Permintaan gagal (${res.status})`, data);
  }
  return data as T;
}

export const pget = <T = any>(path: string, query?: Record<string, string | number | undefined>) => papi<T>(path, { query });
export const ppost = <T = any>(path: string, body?: unknown) => papi<T>(path, { method: 'POST', body: body ?? {} });
export const pput = <T = any>(path: string, body?: unknown) => papi<T>(path, { method: 'PUT', body: body ?? {} });
export const ppatch = <T = any>(path: string, body?: unknown) => papi<T>(path, { method: 'PATCH', body: body ?? {} });

/** Ambil berkas (bukti transfer) dengan token admin, kembalikan object URL. */
export async function pblobUrl(path: string) {
  const res = await fetch(`/api/platform${path}`, { headers: { authorization: `Bearer ${getAdminToken() ?? ''}` } });
  if (!res.ok) throw new ApiError(res.status, 'Gagal memuat berkas');
  return URL.createObjectURL(await res.blob());
}
