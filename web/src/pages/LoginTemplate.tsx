import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, LayoutTemplate } from 'lucide-react';
import { get } from '../lib/api';
import { useRouters } from '../lib/router-context';
import { durationLabel, formatMoney } from '../lib/format';
import { Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea, Toggle } from '../components/ui';

interface Opts {
  name: string;
  tagline: string;
  color1: string;
  color2: string;
  theme: 'dark' | 'light';
  voucherMode: boolean;
  showPrices: boolean;
  whatsapp: string;
  notice: string;
  trial: boolean;
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildLoginHtml(o: Opts, prices: { name: string; price: string; desc: string }[]) {
  const dark = o.theme === 'dark';
  const bg = dark ? '#070b14' : '#f1f5f9';
  const card = dark ? 'rgba(15,23,42,.85)' : '#ffffff';
  const fg = dark ? '#e2e8f0' : '#0f172a';
  const muted = dark ? '#94a3b8' : '#64748b';
  const line = dark ? 'rgba(148,163,184,.18)' : '#e2e8f0';
  const priceHtml =
    o.showPrices && prices.length
      ? `<div class="prices">${prices.map((p) => `<div class="price"><b>${esc(p.name)}</b><span>${esc(p.price)}</span><small>${esc(p.desc)}</small></div>`).join('')}</div>`
      : '';
  const wa = o.whatsapp.replace(/[^0-9]/g, '').replace(/^0/, '62');
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="pragma" content="no-cache">
<meta http-equiv="expires" content="-1">
<title>${esc(o.name)} - Login Hotspot</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:${bg};color:${fg};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
background-image:radial-gradient(600px 300px at 0% 0%,${o.color1}33,transparent 60%),radial-gradient(600px 300px at 100% 100%,${o.color2}33,transparent 60%)}
.wrap{width:100%;max-width:380px}
.card{background:${card};border:1px solid ${line};border-radius:22px;padding:28px 24px;box-shadow:0 20px 60px rgba(0,0,0,.25);backdrop-filter:blur(10px)}
.logo{width:56px;height:56px;border-radius:16px;margin:0 auto 14px;background:linear-gradient(135deg,${o.color1},${o.color2});display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:24px}
h1{text-align:center;font-size:22px;font-weight:800;letter-spacing:-.02em}
.tag{text-align:center;color:${muted};font-size:13px;margin-top:4px}
form{margin-top:22px}
input{width:100%;padding:14px 16px;border-radius:12px;border:1px solid ${line};background:${dark ? 'rgba(2,6,23,.5)' : '#f8fafc'};color:${fg};font-size:16px;margin-bottom:10px;outline:none;text-align:center;letter-spacing:.08em}
input:focus{border-color:${o.color1};box-shadow:0 0 0 3px ${o.color1}33}
button{width:100%;padding:14px;border:0;border-radius:12px;font-size:15px;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(135deg,${o.color1},${o.color2})}
.alt{display:block;text-align:center;margin-top:12px;font-size:13px;color:${o.color1};text-decoration:none}
.err{background:#f43f5e1a;color:#f43f5e;border:1px solid #f43f5e44;padding:10px;border-radius:10px;font-size:13px;text-align:center;margin-top:14px}
.notice{color:${muted};font-size:12px;text-align:center;margin-top:16px;line-height:1.5}
.prices{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:18px}
.price{border:1px solid ${line};border-radius:12px;padding:10px;text-align:center}
.price b{display:block;font-size:13px}.price span{display:block;font-size:16px;font-weight:800;color:${o.color1};margin-top:2px}.price small{color:${muted};font-size:11px}
.wa{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:14px;padding:11px;border-radius:12px;background:#22c55e1a;color:#22c55e;text-decoration:none;font-weight:600;font-size:13px}
.foot{text-align:center;color:${muted};font-size:11px;margin-top:16px}
</style>
</head>
<body>
$(if chap-id)
<form name="sendin" action="$(link-login-only)" method="post" style="display:none">
<input type="hidden" name="username"><input type="hidden" name="password">
<input type="hidden" name="dst" value="$(link-orig)"><input type="hidden" name="popup" value="true">
</form>
<script src="/md5.js"></script>
<script>
function doLogin(){
${o.voucherMode ? '  document.login.password.value = document.login.username.value;\n' : ''}  document.sendin.username.value = document.login.username.value;
  document.sendin.password.value = hexMD5('$(chap-id)' + document.login.password.value + '$(chap-challenge)');
  document.sendin.submit();
  return false;
}
</script>
$(endif)
<div class="wrap">
<div class="card">
<div class="logo">${esc(o.name.slice(0, 1).toUpperCase())}</div>
<h1>${esc(o.name)}</h1>
<p class="tag">${esc(o.tagline)}</p>
<form name="login" action="$(link-login-only)" method="post" $(if chap-id)onSubmit="return doLogin()"$(endif)>
<input type="hidden" name="dst" value="$(link-orig)">
<input type="hidden" name="popup" value="true">
<input name="username" type="text" value="$(username)" placeholder="${o.voucherMode ? 'Masukkan kode voucher' : 'Username'}" autocomplete="off" autocapitalize="off" required>
${o.voucherMode ? '<input name="password" type="hidden">' : '<input name="password" type="password" placeholder="Password" required>'}
<button type="submit">Masuk Internet</button>
</form>
${o.trial ? '$(if trial == \'yes\')<a class="alt" href="$(link-login-only)?dst=$(link-orig-esc)&amp;username=T-$(mac-esc)">Coba gratis (trial)</a>$(endif)' : ''}
$(if error)<div class="err">$(error)</div>$(endif)
${priceHtml}
${wa ? `<a class="wa" href="https://wa.me/${wa}?text=Halo%2C%20saya%20mau%20beli%20voucher" target="_blank">Beli voucher via WhatsApp</a>` : ''}
${o.notice ? `<p class="notice">${esc(o.notice)}</p>` : ''}
</div>
<p class="foot">Powered by MIKROTAL • $(identity)</p>
</div>
${o.voucherMode ? '<script>document.login.onsubmit=document.login.onsubmit||function(){document.login.password.value=document.login.username.value;return true;};</script>' : ''}
</body>
</html>`;
}

function preview(html: string) {
  return html
    .replace(/\$\(if chap-id\)[\s\S]*?\$\(endif\)/g, '')
    .replace(/\$\(if error\)[\s\S]*?\$\(endif\)/g, '')
    .replace(/\$\(if trial == 'yes'\)([\s\S]*?)\$\(endif\)/g, '$1')
    .replace(/\$\(if chap-id\)|\$\(endif\)/g, '')
    .replace(/\$\(identity\)/g, 'MikroTik')
    .replace(/\$\([a-z-]+\)/g, '');
}

export default function LoginTemplate() {
  const { routerId } = useRouters();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get('/api/settings') });
  const profiles = useQuery({ queryKey: ['hs-profiles', routerId], queryFn: () => get<any[]>(`/api/routers/${routerId}/hotspot/profiles`), enabled: !!routerId });
  const [o, setO] = useState<Opts>({
    name: '',
    tagline: 'Internet cepat, murah & stabil',
    color1: '#06b6d4',
    color2: '#6366f1',
    theme: 'dark',
    voucherMode: true,
    showPrices: true,
    whatsapp: '',
    notice: 'Satu voucher hanya untuk satu perangkat. Simpan kode voucher Anda.',
    trial: false,
  });
  const set = <K extends keyof Opts>(k: K, v: Opts[K]) => setO((x) => ({ ...x, [k]: v }));
  const name = o.name || settings.data?.brand?.name || 'MIKROTAL';
  const prices = useMemo(
    () =>
      (profiles.data ?? [])
        .filter((p) => p.name !== 'default' && p.meta?.price > 0)
        .map((p) => ({ name: p.name, price: formatMoney(p.meta.price), desc: durationLabel(p.meta.validity) })),
    [profiles.data],
  );
  const html = useMemo(() => buildLoginHtml({ ...o, name, whatsapp: o.whatsapp || settings.data?.brand?.phone || '' }, prices), [o, name, prices, settings.data]);

  const downloadFile = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'login.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div>
      <PageHeader
        title="Template Halaman Login Hotspot"
        subtitle="Buat halaman login captive portal yang modern, lengkap dengan daftar harga & tombol WhatsApp"
        icon={<LayoutTemplate className="size-5" />}
        actions={
          <Button icon={<Download className="size-4" />} onClick={downloadFile}>
            Unduh login.html
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader title="Pengaturan" />
          <div className="space-y-4 p-5">
            <Field label="Nama hotspot">
              <Input value={o.name} onChange={(e) => set('name', e.target.value)} placeholder={settings.data?.brand?.name ?? 'MIKROTAL'} />
            </Field>
            <Field label="Slogan">
              <Input value={o.tagline} onChange={(e) => set('tagline', e.target.value)} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Warna 1">
                <Input type="color" className="h-[38px] p-1" value={o.color1} onChange={(e) => set('color1', e.target.value)} />
              </Field>
              <Field label="Warna 2">
                <Input type="color" className="h-[38px] p-1" value={o.color2} onChange={(e) => set('color2', e.target.value)} />
              </Field>
              <Field label="Tema">
                <Select value={o.theme} onChange={(e) => set('theme', e.target.value as Opts['theme'])}>
                  <option value="dark">Gelap</option>
                  <option value="light">Terang</option>
                </Select>
              </Field>
            </div>
            <Field label="No. WhatsApp penjualan" hint="Kosong = pakai nomor di Pengaturan">
              <Input value={o.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="0812xxxx" />
            </Field>
            <Field label="Pengumuman">
              <Textarea rows={3} className="font-sans text-sm" value={o.notice} onChange={(e) => set('notice', e.target.value)} />
            </Field>
            <div className="space-y-3">
              <Toggle checked={o.voucherMode} onChange={(v) => set('voucherMode', v)} label="Mode voucher (cukup 1 kolom kode)" />
              <Toggle checked={o.showPrices} onChange={(v) => set('showPrices', v)} label={`Tampilkan daftar harga (${prices.length} paket)`} />
              <Toggle checked={o.trial} onChange={(v) => set('trial', v)} label="Tombol trial (jika trial aktif di router)" />
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-4 text-xs text-muted">
              <p className="mb-1 font-semibold text-fg">Cara pasang</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Unduh login.html.</li>
                <li>Buka Winbox › Files, masuk folder hotspot (mis. flash/hotspot).</li>
                <li>Seret file untuk menimpa login.html lama (backup dulu yang lama).</li>
                <li>Pastikan file md5.js tetap ada di folder yang sama (untuk login CHAP).</li>
              </ol>
            </div>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Pratinjau" subtitle="Tampilan di HP pelanggan" />
          <div className="flex justify-center bg-surface-2 p-6">
            <div className="overflow-hidden rounded-[2rem] border-8 border-slate-800 shadow-2xl">
              <iframe title="Pratinjau login" srcDoc={preview(html)} className="h-[680px] w-[360px] bg-white" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
