import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Printer, Wifi } from 'lucide-react';
import clsx from 'clsx';
import { get } from '../lib/api';
import { durationLabel, formatBytes, formatMoney } from '../lib/format';
import { Button, ErrorBox, Field, Input, Loading, Select, Toggle } from '../components/ui';

interface PrintData {
  vouchers: { id: number; code: string; password: string; profile: string; price: number; validity: string; time_limit: string; data_limit: number; router_id: number }[];
  routers: { id: number; name: string; identity: string; hotspot_dns: string }[];
  metas: { router_id: number; profile: string; color: string }[];
  brand: { name: string; tagline: string; phone: string; currency: string };
  loginUrl: string;
}

type Template = 'card' | 'compact' | 'thermal';

const PREF_KEY = 'mikrotal.print';

export default function VoucherPrint() {
  const [params] = useSearchParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['print', params.toString()],
    queryFn: () => get<PrintData>('/api/vouchers/print', { batchId: params.get('batchId'), ids: params.get('ids'), onlyUnused: params.get('onlyUnused') }),
  });
  const [prefs, setPrefs] = useState(() => {
    const def = { template: 'card' as Template, qr: true, price: true, columns: 4, title: '', footer: '', color: '#0891b2' };
    try {
      return { ...def, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') };
    } catch {
      return def;
    }
  });
  const set = (k: keyof typeof prefs, v: any) => setPrefs((p: typeof prefs) => ({ ...p, [k]: v }));
  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch {
      /* abaikan */
    }
  }, [prefs]);

  // Halaman cetak selalu bertema terang
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    root.classList.remove('dark');
    return () => {
      if (wasDark) root.classList.add('dark');
    };
  }, []);

  const [qrs, setQrs] = useState<Record<number, string>>({});
  const loginUrlFor = useMemo(() => {
    return (v: PrintData['vouchers'][number]) => {
      const r = data?.routers.find((x) => x.id === v.router_id);
      const base = r?.hotspot_dns ? `http://${r.hotspot_dns}/login` : data?.loginUrl || 'http://hotspot.lan/login';
      return `${base}?username=${encodeURIComponent(v.code)}&password=${encodeURIComponent(v.password)}`;
    };
  }, [data]);

  useEffect(() => {
    if (!data || !prefs.qr || prefs.template === 'compact') return;
    let cancelled = false;
    (async () => {
      const out: Record<number, string> = {};
      for (const v of data.vouchers) {
        out[v.id] = await QRCode.toDataURL(loginUrlFor(v), { margin: 0, width: 160, errorCorrectionLevel: 'M' });
      }
      if (!cancelled) setQrs(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [data, prefs.qr, prefs.template, loginUrlFor]);

  if (isLoading) return <Loading text="Menyiapkan voucher..." />;
  if (error || !data) return <ErrorBox error={error} />;

  const title = prefs.title || data.brand.name;
  const color = (v: PrintData['vouchers'][number]) => data.metas.find((m) => m.router_id === v.router_id && m.profile === v.profile)?.color || prefs.color;
  const dns = data.routers[0]?.hotspot_dns;

  return (
    <div className="min-h-full bg-white text-slate-900">
      <style>{`
        @page { size: ${prefs.template === 'thermal' ? '58mm auto' : 'A4'}; margin: ${prefs.template === 'thermal' ? '2mm' : '8mm'}; }
        @media print { html, body, #root { background: #fff !important; } }
      `}</style>
      <div className="no-print sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-4 py-3 text-slate-900 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-3">
          <div className="mr-auto">
            <p className="font-bold">Cetak {data.vouchers.length} voucher</p>
            <p className="text-xs text-slate-500">Atur tampilan lalu klik Cetak (atau Ctrl+P). Pilih "Save as PDF" untuk menyimpan.</p>
          </div>
          <Field label="Template">
            <Select value={prefs.template} onChange={(e) => set('template', e.target.value)} className="bg-white">
              <option value="card">Kartu (A4)</option>
              <option value="compact">Ringkas tanpa QR (A4, hemat kertas)</option>
              <option value="thermal">Struk thermal 58mm</option>
            </Select>
          </Field>
          {prefs.template !== 'thermal' && (
            <Field label="Kolom">
              <Select value={prefs.columns} onChange={(e) => set('columns', Number(e.target.value))} className="w-20 bg-white">
                {[3, 4, 5, 6, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Judul">
            <Input value={prefs.title} onChange={(e) => set('title', e.target.value)} placeholder={data.brand.name} className="w-40 bg-white" />
          </Field>
          <Field label="Catatan bawah">
            <Input value={prefs.footer} onChange={(e) => set('footer', e.target.value)} placeholder={data.brand.phone ? `CS: ${data.brand.phone}` : 'mis. WA 08xx'} className="w-44 bg-white" />
          </Field>
          <Field label="Warna">
            <Input type="color" value={prefs.color} onChange={(e) => set('color', e.target.value)} className="h-[38px] w-14 bg-white p-1" />
          </Field>
          <div className="flex flex-col gap-2 pb-1">
            <Toggle checked={prefs.qr} onChange={(v) => set('qr', v)} label="QR login" />
            <Toggle checked={prefs.price} onChange={(v) => set('price', v)} label="Harga" />
          </div>
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
            Cetak
          </Button>
        </div>
      </div>

      <div className={clsx('mx-auto p-4 print:p-0', prefs.template === 'thermal' ? 'max-w-[58mm]' : 'max-w-[210mm]')}>
        {prefs.template === 'thermal' ? (
          <div className="space-y-0">
            {data.vouchers.map((v) => (
              <div key={v.id} className="break-inside-avoid border-b border-dashed border-slate-400 py-3 text-center" style={{ fontFamily: 'ui-monospace, monospace' }}>
                <p className="text-sm font-bold uppercase">{title}</p>
                <p className="text-[10px]">{v.profile} • {durationLabel(v.validity)}</p>
                {prefs.qr && qrs[v.id] && <img src={qrs[v.id]} alt="" className="mx-auto my-2 size-24" />}
                <p className="text-[10px]">Kode voucher</p>
                <p className="text-xl font-bold tracking-widest">{v.code}</p>
                {v.password !== v.code && <p className="text-xs">Pass: {v.password}</p>}
                {prefs.price && <p className="mt-1 text-sm font-bold">{formatMoney(v.price, data.brand.currency)}</p>}
                {dns && <p className="text-[9px]">Login: {dns}</p>}
                {prefs.footer && <p className="text-[9px]">{prefs.footer}</p>}
              </div>
            ))}
          </div>
        ) : prefs.template === 'compact' ? (
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${prefs.columns}, minmax(0, 1fr))` }}>
            {data.vouchers.map((v) => (
              <div key={v.id} className="break-inside-avoid rounded border border-slate-300 px-2 py-1.5 text-center" style={{ borderTop: `3px solid ${color(v)}` }}>
                <p className="truncate text-[8px] font-semibold uppercase text-slate-500">
                  {title} • {v.profile}
                </p>
                <p className="font-mono text-base font-bold tracking-wider">{v.code}</p>
                {v.password !== v.code && <p className="font-mono text-[9px]">pass {v.password}</p>}
                {prefs.price && <p className="text-[9px] font-semibold">{formatMoney(v.price, data.brand.currency)}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${prefs.columns}, minmax(0, 1fr))` }}>
            {data.vouchers.map((v) => (
              <div key={v.id} className="break-inside-avoid overflow-hidden rounded-lg border border-slate-300" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
                <div className="flex items-center justify-between px-2 py-1 text-white" style={{ background: color(v) }}>
                  <span className="flex items-center gap-1 truncate text-[10px] font-bold uppercase">
                    <Wifi className="size-3" /> {title}
                  </span>
                  <span className="text-[10px] font-semibold">{v.profile}</span>
                </div>
                <div className="flex items-center gap-2 p-2">
                  {prefs.qr && qrs[v.id] && <img src={qrs[v.id]} alt="" className="size-14 shrink-0" />}
                  <div className="min-w-0 flex-1 text-center">
                    <p className="text-[8px] uppercase text-slate-500">{v.password !== v.code ? 'Username' : 'Kode voucher'}</p>
                    <p className="font-mono text-[15px] font-extrabold leading-tight tracking-wider">{v.code}</p>
                    {v.password !== v.code && (
                      <>
                        <p className="text-[8px] uppercase text-slate-500">Password</p>
                        <p className="font-mono text-xs font-bold">{v.password}</p>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 px-2 py-1 text-[9px] text-slate-600">
                  <span>
                    {durationLabel(v.validity)}
                    {v.time_limit && ` • ${durationLabel(v.time_limit)}`}
                    {v.data_limit > 0 && ` • ${formatBytes(v.data_limit, 0)}`}
                  </span>
                  {prefs.price && <span className="font-bold text-slate-900">{formatMoney(v.price, data.brand.currency)}</span>}
                </div>
                {(prefs.footer || dns) && <p className="truncate bg-slate-50 px-2 py-0.5 text-center text-[8px] text-slate-500">{prefs.footer || `Login di ${dns}`}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
