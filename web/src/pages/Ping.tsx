import { useState } from 'react';
import { Radar } from 'lucide-react';
import { post } from '../lib/api';
import { Button, Card, Field, Input, PageHeader, Select, useAction } from '../components/ui';
import { RequireRouter } from '../components/RequireRouter';

function PingBody({ routerId }: { routerId: number }) {
  const [address, setAddress] = useState('8.8.8.8');
  const [count, setCount] = useState(4);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const { run, busy } = useAction();
  const times = rows.map((r) => parseInt(r.time ?? '', 10)).filter((n) => !Number.isNaN(n));
  const received = rows.filter((r) => r.time).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Ping dari Router" subtitle="Uji koneksi dari router ke alamat tujuan (cek internet, gateway, perangkat)" icon={<Radar className="size-5" />} />
      <Card className="p-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setRows([]);
            const r = await run(() => post<Record<string, string>[]>(`/api/routers/${routerId}/ping`, { address, count }));
            if (r) setRows(r);
          }}
        >
          <Field label="Alamat tujuan" className="min-w-60 flex-1">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="8.8.8.8 atau google.com" />
          </Field>
          <Field label="Jumlah">
            <Select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[4, 10, 20].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" loading={busy}>
            Ping
          </Button>
          <div className="flex flex-wrap gap-1.5">
            {['8.8.8.8', '1.1.1.1', 'google.com', '192.168.1.1'].map((a) => (
              <button type="button" key={a} onClick={() => setAddress(a)} className="rounded-lg border border-line px-2 py-1 font-mono text-xs text-muted hover:border-brand">
                {a}
              </button>
            ))}
          </div>
        </form>
      </Card>
      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-2 gap-4 border-b border-line p-5 text-center sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted">Terkirim / diterima</p>
              <p className="text-xl font-bold">
                {rows.length} / {received}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Packet loss</p>
              <p className="text-xl font-bold">{Math.round(((rows.length - received) / rows.length) * 100)}%</p>
            </div>
            <div>
              <p className="text-xs text-muted">Min / rata-rata</p>
              <p className="text-xl font-bold">
                {times.length ? Math.min(...times) : '-'} / {times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : '-'} ms
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Maks</p>
              <p className="text-xl font-bold">{times.length ? Math.max(...times) : '-'} ms</p>
            </div>
          </div>
          <div className="p-4 font-mono text-xs">
            {rows.map((r, i) => (
              <p key={i} className="py-0.5">
                {r.time ? (
                  <>
                    balasan dari <b>{r.host}</b>: seq={r.seq} ttl={r.ttl} waktu=<span className="text-emerald-500">{r.time}</span>
                  </>
                ) : (
                  <span className="text-rose-500">seq={r.seq} timeout {r.status ?? ''}</span>
                )}
              </p>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default function Ping() {
  return <RequireRouter>{(id) => <PingBody key={id} routerId={id} />}</RequireRouter>;
}
