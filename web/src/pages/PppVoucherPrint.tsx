import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Printer, Wifi } from 'lucide-react';
import clsx from 'clsx';
import { get } from '../lib/api';
import { durationLabel, formatMoney } from '../lib/format';
import { groupCode } from '../lib/pppoe';
import { Button, ErrorBox, Field, Input, Loading, Select, Toggle } from '../components/ui';

interface PrintData {
  vouchers: { id: number; code: string; package_name: string; price: number; validity: string }[];
  brand: { name: string; tagline: string; phone: string; currency: string };
  topupUrl: string;
}

const PREF_KEY = 'mikrotal.print.pppoe';

export default function PppVoucherPrint() {
  const [params] = useSearchParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['print-pppoe', params.toString()],
    queryFn: () => get<PrintData>('/api/pppoe/vouchers/print', { batchId: params.get('batchId'), ids: params.get('ids'), onlyUnused: params.get('onlyUnused') }),
  });
  const [prefs, setPrefs] = useState(() => {
    const def = { template: 'card' as 'card' | 'thermal', qr: true, price: true, columns: 3, title: '', footer: '', color: '#7c3aed' };
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

  const topupUrl = data?.topupUrl || `${location.origin}/isi`;
  const [qrs, setQrs] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!data || !prefs.qr) return;
    let cancelled = false;
    (async () => {
      const out: Record<number, string> = {};
      for (const v of data.vouchers) out[v.id] = await QRCode.toDataURL(`${topupUrl}?code=${encodeURIComponent(v.code)}`, { margin: 0, width: 160, errorCorrectionLevel: 'M' });
      if (!cancelled) setQrs(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [data, prefs.qr, topupUrl]);

  if (isLoading) return <Loading text="Menyiapkan voucher..." />;
  if (error || !data) return <ErrorBox error={error} />;

  const title = prefs.title || data.brand.name;
  const shortUrl = topupUrl.replace(/^https?:\/\//, '');

  return (
    <div className="min-h-full bg-white text-slate-900">
      <style>{`
        @page { size: ${prefs.template === 'thermal' ? '58mm auto' : 'A4'}; margin: ${prefs.template === 'thermal' ? '2mm' : '8mm'}; }
        @media print { html, body, #root { background: #fff !important; } }
      `}</style>
      <div className="no-print sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-4 py-3 text-slate-900 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-3">
          <div className="mr-auto">
            <p className="font-bold">Cetak {data.vouchers.length} voucher PPPoE</p>
            <p className="text-xs text-slate-500">Atur tampilan lalu klik Cetak (atau Ctrl+P). Pilih "Save as PDF" untuk menyimpan.</p>
          </div>
          <Field label="Template">
            <Select value={prefs.template} onChange={(e) => set('template', e.target.value)} className="bg-white">
              <option value="card">Kartu (A4)</option>
              <option value="thermal">Struk thermal 58mm</option>
            </Select>
          </Field>
          {prefs.template === 'card' && (
            <Field label="Kolom">
              <Select value={prefs.columns} onChange={(e) => set('columns', Number(e.target.value))} className="w-20 bg-white">
                {[2, 3, 4, 5].map((n) => (
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
            <Toggle checked={prefs.qr} onChange={(v) => set('qr', v)} label="QR isi ulang" />
            <Toggle checked={prefs.price} onChange={(v) => set('price', v)} label="Harga" />
          </div>
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
            Cetak
          </Button>
        </div>
      </div>

      <div className={clsx('mx-auto p-4 print:p-0', prefs.template === 'thermal' ? 'max-w-[58mm]' : 'max-w-[210mm]')}>
        {!data.vouchers.length ? (
          <p className="py-10 text-center text-sm text-slate-500">Tidak ada voucher yang belum dipakai untuk dicetak.</p>
        ) : prefs.template === 'thermal' ? (
          data.vouchers.map((v) => (
            <div key={v.id} className="break-inside-avoid border-b border-dashed border-slate-400 py-3 text-center" style={{ fontFamily: 'ui-monospace, monospace' }}>
              <p className="text-sm font-bold uppercase">{title}</p>
              <p className="text-[10px]">
                Isi ulang internet • {v.package_name} • {durationLabel(v.validity)}
              </p>
              {prefs.qr && qrs[v.id] && <img src={qrs[v.id]} alt="" className="mx-auto my-2 size-24" />}
              <p className="text-[10px]">Kode voucher</p>
              <p className="text-xl font-bold tracking-widest">{groupCode(v.code)}</p>
              {prefs.price && <p className="mt-1 text-sm font-bold">{formatMoney(v.price, data.brand.currency)}</p>}
              <p className="text-[9px]">Isi di: {shortUrl}</p>
              {prefs.footer && <p className="text-[9px]">{prefs.footer}</p>}
            </div>
          ))
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${prefs.columns}, minmax(0, 1fr))` }}>
            {data.vouchers.map((v) => (
              <div key={v.id} className="break-inside-avoid overflow-hidden rounded-lg border border-slate-300" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
                <div className="flex items-center justify-between gap-2 px-2 py-1 text-white" style={{ background: prefs.color }}>
                  <span className="flex min-w-0 items-center gap-1 truncate text-[10px] font-bold uppercase">
                    <Wifi className="size-3 shrink-0" /> {title}
                  </span>
                  <span className="shrink-0 text-[10px] font-semibold">Isi ulang PPPoE</span>
                </div>
                <div className="flex items-center gap-2 p-2">
                  {prefs.qr && qrs[v.id] && <img src={qrs[v.id]} alt="" className="size-14 shrink-0" />}
                  <div className="min-w-0 flex-1 text-center">
                    <p className="truncate text-[9px] font-semibold text-slate-600">{v.package_name}</p>
                    <p className="font-mono text-[15px] font-extrabold leading-tight tracking-wider">{groupCode(v.code)}</p>
                    <p className="text-[8px] uppercase text-slate-500">Kode voucher</p>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 px-2 py-1 text-[9px] text-slate-600">
                  <span>Tambah {durationLabel(v.validity)}</span>
                  {prefs.price && <span className="font-bold text-slate-900">{formatMoney(v.price, data.brand.currency)}</span>}
                </div>
                <p className="truncate bg-slate-50 px-2 py-0.5 text-center text-[8px] text-slate-500">{prefs.footer || `Isi di ${shortUrl}`}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
