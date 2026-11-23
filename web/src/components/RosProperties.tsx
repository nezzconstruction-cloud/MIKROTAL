import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Input, Select, Textarea } from './ui';

/** Properti yang hanya berupa status/penghitung dari router: ditampilkan, tidak dikirim balik. */
export const READONLY_KEYS = new Set([
  '.id', '.nextid', 'dynamic', 'running', 'invalid', 'inactive', 'active', 'builtin', 'default', 'slave', 'bytes', 'packets', 'actual-mtu', 'actual-interface',
  'last-link-up-time', 'last-link-down-time', 'link-downs', 'rx-byte', 'tx-byte', 'rx-packet', 'tx-packet', 'rx-drop', 'tx-drop', 'tx-queue-drop', 'rx-error', 'tx-error',
  'fp-rx-byte', 'fp-tx-byte', 'fp-rx-packet', 'fp-tx-packet', 'last-logged-in', 'next-run', 'run-count', 'last-started', 'creation-time', 'uptime', 'expires-after',
  'dropped', 'queued-bytes', 'queued-packets', 'rate', 'packet-rate', 'total-bytes', 'total-packets', 'total-dropped', 'total-queued-bytes', 'total-queued-packets',
  'total-rate', 'total-packet-rate', 'borrows', 'lends', 'pcq-queues', 'used', 'status', 'last-seen', 'factory-name', 'host-name', 'active-address', 'active-mac-address',
  'active-client-id', 'active-server', 'radius', 'blocked', 'gateway-status', 'immediate-gw', 'distance-dynamic', 'contents',
]);

export function isLong(v: string) {
  return v.length > 70 || v.includes('\n');
}

/** Satu kolom properti RouterOS: true/false jadi pilihan ya/tidak, teks panjang jadi area teks. */
export function PropInput({ name, value, original, onChange }: { name: string; value: string; original?: string; onChange: (v: string) => void }) {
  const ref = original ?? value;
  if (ref === 'true' || ref === 'false' || ref === 'yes' || ref === 'no') {
    return (
      <Select value={value === 'yes' ? 'true' : value === 'no' ? 'false' : value} onChange={(e) => onChange(e.target.value)}>
        <option value="true">yes</option>
        <option value="false">no</option>
      </Select>
    );
  }
  if (isLong(ref) || /^(on-|source$|script$|comment$)/.test(name)) {
    return <Textarea rows={isLong(ref) ? 5 : 2} className="font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <Input className="font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" />;
}

/** Baris properti tambahan (nama = nilai) untuk menambah item atau properti yang belum ada. */
export function ExtraProps({ rows, onChange, suggestions }: { rows: { k: string; v: string }[]; onChange: (r: { k: string; v: string }[]) => void; suggestions: string[] }) {
  const listId = useMemo(() => `ros-keys-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2">
          <Input className="w-2/5 font-mono text-xs" list={listId} placeholder="nama-properti" value={r.k} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, k: e.target.value.trim() } : x)))} />
          <Input className="flex-1 font-mono text-xs" placeholder="nilai" value={r.v} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
          <button type="button" className="mt-2 text-subtle hover:text-rose-500" title="Hapus baris" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <X className="size-4" />
          </button>
        </div>
      ))}
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <Button type="button" size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => onChange([...rows, { k: '', v: '' }])}>
        Tambah properti
      </Button>
    </div>
  );
}

/** Editor semua properti sebuah item. Mengembalikan hanya properti yang berubah lewat onChange. */
export function useAllProps(initial: Record<string, string> | null, exclude: Set<string> = new Set()) {
  const keys = useMemo(() => Object.keys(initial ?? {}).filter((k) => !READONLY_KEYS.has(k) && !exclude.has(k)).sort(), [initial, exclude]);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, initial?.[k] ?? ''])));
  const [extra, setExtra] = useState<{ k: string; v: string }[]>([]);
  const changed = () => {
    const out: Record<string, string> = {};
    for (const k of keys) if ((vals[k] ?? '') !== (initial?.[k] ?? '')) out[k] = vals[k];
    for (const e of extra) if (e.k) out[e.k] = e.v;
    return out;
  };
  return { keys, vals, setVals, extra, setExtra, changed };
}
