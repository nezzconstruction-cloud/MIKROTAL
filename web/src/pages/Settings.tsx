import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Bell, Building2, Cable, Gauge, Save, Send, Settings as SettingsIcon, ShieldAlert, Ticket } from 'lucide-react';
import { get, post, put } from '../lib/api';
import { useRouters } from '../lib/router-context';
import { Button, Card, CardHeader, Field, Input, Loading, PageHeader, Select, Toggle, useAction, useFeedback } from '../components/ui';

type S = any;

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => get<S>('/api/settings') });
  const [s, setS] = useState<S | null>(null);
  const { run, busy } = useAction();
  const tg = useAction();
  const iso = useAction();
  const { router } = useRouters();
  const { confirm, toast } = useFeedback();
  useEffect(() => {
    if (data) setS(structuredClone(data));
  }, [data]);
  if (isLoading || !s) return <Loading />;

  const set = (path: string, value: unknown) =>
    setS((cur: S) => {
      const next = structuredClone(cur);
      const keys = path.split('.');
      let o = next;
      for (const k of keys.slice(0, -1)) o = o[k];
      o[keys[keys.length - 1]] = value;
      return next;
    });
  const num = (path: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(path, Number(e.target.value));

  const save = () =>
    run(async () => {
      const r = await put('/api/settings', s);
      qc.setQueryData(['settings'], r);
      return true;
    }, 'Pengaturan disimpan');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pengaturan"
        subtitle="Identitas usaha, pemantauan, notifikasi, voucher, PPPoE & isolir, dan backup otomatis"
        icon={<SettingsIcon className="size-5" />}
        actions={
          <Button icon={<Save className="size-4" />} loading={busy} onClick={save}>
            Simpan semua
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Identitas usaha" icon={<Building2 className="size-4" />} subtitle="Tampil di voucher, halaman login & notifikasi" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Nama usaha / hotspot">
              <Input value={s.brand.name} onChange={(e) => set('brand.name', e.target.value)} />
            </Field>
            <Field label="Slogan">
              <Input value={s.brand.tagline} onChange={(e) => set('brand.tagline', e.target.value)} />
            </Field>
            <Field label="No. telepon / WA">
              <Input value={s.brand.phone} onChange={(e) => set('brand.phone', e.target.value)} />
            </Field>
            <Field label="Mata uang">
              <Select value={s.brand.currency} onChange={(e) => set('brand.currency', e.target.value)}>
                <option value="IDR">IDR (Rupiah)</option>
                <option value="MYR">MYR</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
            <Field label="Zona waktu laporan">
              <Select value={s.brand.timezoneOffset} onChange={(e) => set('brand.timezoneOffset', Number(e.target.value))}>
                <option value={420}>WIB (UTC+7)</option>
                <option value={480}>WITA (UTC+8)</option>
                <option value={540}>WIT (UTC+9)</option>
                <option value={0}>UTC</option>
              </Select>
            </Field>
            <Field label="Alamat">
              <Input value={s.brand.address} onChange={(e) => set('brand.address', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Notifikasi & ambang batas" icon={<Bell className="size-4" />} subtitle="Alert di aplikasi dan Telegram" />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="CPU ≥ (%)">
                <Input type="number" value={s.alerts.cpu} onChange={num('alerts.cpu')} />
              </Field>
              <Field label="Memori ≥ (%)">
                <Input type="number" value={s.alerts.memory} onChange={num('alerts.memory')} />
              </Field>
              <Field label="Suhu ≥ (°C)">
                <Input type="number" value={s.alerts.temperature} onChange={num('alerts.temperature')} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-6">
              <Toggle checked={s.alerts.offline} onChange={(v) => set('alerts.offline', v)} label="Router offline/online" />
              <Toggle checked={s.alerts.interfaceDown} onChange={(v) => set('alerts.interfaceDown', v)} label="Interface WAN down" />
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <Toggle checked={s.alerts.telegram.enabled} onChange={(v) => set('alerts.telegram.enabled', v)} label="Kirim ke Telegram" />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Bot token" hint="Buat bot lewat @BotFather">
                  <Input value={s.alerts.telegram.botToken} onChange={(e) => set('alerts.telegram.botToken', e.target.value)} placeholder="123456:ABC..." autoComplete="off" />
                </Field>
                <Field label="Chat ID" hint="ID grup/pribadi (cek via @userinfobot)">
                  <Input value={s.alerts.telegram.chatId} onChange={(e) => set('alerts.telegram.chatId', e.target.value)} placeholder="-100123456789" />
                </Field>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                icon={<Send className="size-3.5" />}
                loading={tg.busy}
                onClick={() => tg.run(() => post('/api/settings/telegram/test', { botToken: s.alerts.telegram.botToken, chatId: s.alerts.telegram.chatId }), 'Pesan uji terkirim ke Telegram')}
              >
                Kirim pesan uji
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Voucher hotspot" icon={<Ticket className="size-4" />} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Sinkronisasi status (detik)" hint="Seberapa sering status voucher dicek ke router">
              <Input type="number" min={15} value={s.voucher.syncSeconds} onChange={num('voucher.syncSeconds')} />
            </Field>
            <Field label="URL login hotspot (QR)" hint="Dipakai jika router tidak punya DNS name">
              <Input value={s.voucher.loginUrl} onChange={(e) => set('voucher.loginUrl', e.target.value)} />
            </Field>
            <Field label="Jenis karakter default">
              <Select value={s.voucher.defaultCharset} onChange={(e) => set('voucher.defaultCharset', e.target.value)}>
                <option value="alnum-upper">Huruf besar + angka</option>
                <option value="numeric">Angka</option>
                <option value="upper">Huruf besar</option>
                <option value="lower">Huruf kecil</option>
                <option value="alnum-lower">Huruf kecil + angka</option>
                <option value="alnum-mixed">Campuran</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Panjang default">
                <Input type="number" min={3} max={16} value={s.voucher.defaultLength} onChange={num('voucher.defaultLength')} />
              </Field>
              <Field label="Prefix default">
                <Input value={s.voucher.defaultPrefix} onChange={(e) => set('voucher.defaultPrefix', e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Toggle checked={s.voucher.autoRemoveExpired} onChange={(v) => set('voucher.autoRemoveExpired', v)} label="Hapus otomatis voucher kedaluwarsa dari router (jika mati: dinonaktifkan)" />
            </div>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="PPPoE & isolir" icon={<Cable className="size-4" />} subtitle="Pelanggan yang masa aktifnya habis dipindah ke profil isolir, bukan diputus" />
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Nama profil isolir" hint="Dibuat otomatis di router bila belum ada">
              <Input value={s.pppoe.isolirProfile} onChange={(e) => set('pppoe.isolirProfile', e.target.value)} />
            </Field>
            <Field label="Nama pool isolir">
              <Input value={s.pppoe.isolirPool} onChange={(e) => set('pppoe.isolirPool', e.target.value)} />
            </Field>
            <Field label="Rentang IP isolir">
              <Input value={s.pppoe.isolirPoolRange} onChange={(e) => set('pppoe.isolirPoolRange', e.target.value)} />
            </Field>
            <Field label="Gateway isolir">
              <Input value={s.pppoe.isolirGateway} onChange={(e) => set('pppoe.isolirGateway', e.target.value)} />
            </Field>
            <Field label="IP server MIKROTAL" hint="Tujuan pengalihan halaman isolir. Kosong = tanpa pengalihan" className="lg:col-span-2">
              <Input value={s.pppoe.portalAddress} onChange={(e) => set('pppoe.portalAddress', e.target.value)} placeholder="mis. 192.168.88.10" />
            </Field>
            <Field label="Port web MIKROTAL">
              <Input type="number" min={1} max={65535} value={s.pppoe.portalPort} onChange={num('pppoe.portalPort')} />
            </Field>
            <Field label="Pengingat hampir habis (hari)">
              <Input type="number" min={0} max={30} value={s.pppoe.remindDays} onChange={num('pppoe.remindDays')} />
            </Field>
            <Field label="Karakter voucher PPPoE">
              <Select value={s.pppoe.voucherCharset} onChange={(e) => set('pppoe.voucherCharset', e.target.value)}>
                <option value="numeric">Angka saja</option>
                <option value="alnum-upper">Huruf besar + angka</option>
              </Select>
            </Field>
            <Field label="Panjang kode">
              <Input type="number" min={6} max={16} value={s.pppoe.voucherLength} onChange={num('pppoe.voucherLength')} />
            </Field>
            <Field label="Prefix kode">
              <Input value={s.pppoe.voucherPrefix} onChange={(e) => set('pppoe.voucherPrefix', e.target.value)} />
            </Field>
            <Field label="URL halaman isi ulang (QR)" hint="Kosong = alamat aplikasi ini + /isi">
              <Input value={s.pppoe.topupUrl} onChange={(e) => set('pppoe.topupUrl', e.target.value)} placeholder="http://192.168.88.10/isi" />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <Toggle checked={s.pppoe.odpDownAlert} onChange={(v) => set('pppoe.odpDownAlert', v)} label="Kirim notifikasi bila semua pelanggan di satu ODP offline bersamaan" />
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4 sm:col-span-2 lg:col-span-4">
              <Button
                variant="secondary"
                icon={<ShieldAlert className="size-4" />}
                loading={iso.busy}
                disabled={!router}
                onClick={async () => {
                  if (!router) return;
                  if (
                    !(await confirm({
                      title: `Pasang aturan isolir di ${router.name}?`,
                      message:
                        'Simpan pengaturan terlebih dahulu. Aplikasi akan menambah pool dan profil isolir, lalu aturan firewall di urutan teratas: pelanggan terisolir hanya boleh DNS dan halaman isi ulang, akses web lain dialihkan ke halaman isolir. Aturan yang sudah ada tidak digandakan.',
                      confirmText: 'Pasang',
                    }))
                  )
                    return;
                  const r = await iso.run(() => post<{ done: string[]; portal: boolean }>('/api/pppoe/isolir/setup', { routerId: router.id }));
                  if (r) toast(r.portal ? 'success' : 'warning', r.done.length ? `${r.done.length} perubahan dipasang` : 'Sudah terpasang, tidak ada perubahan', r.portal ? r.done.join(', ') : `${r.done.join(', ')}${r.done.length ? '. ' : ''}IP server MIKROTAL belum diisi, jadi pengalihan halaman isolir belum dipasang.`);
                }}
              >
                Pasang aturan isolir di router aktif
              </Button>
              <p className="text-xs text-muted">Halaman isolir untuk pelanggan: <span className="font-mono">/isolir</span> • halaman isi ulang: <span className="font-mono">/isi</span></p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Pemantauan & backup" icon={<Gauge className="size-4" />} />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Interval polling (detik)">
                <Input type="number" min={3} value={s.monitor.pollSeconds} onChange={num('monitor.pollSeconds')} />
              </Field>
              <Field label="Simpan riwayat tiap (detik)">
                <Input type="number" min={10} value={s.monitor.metricsEverySeconds} onChange={num('monitor.metricsEverySeconds')} />
              </Field>
              <Field label="Simpan riwayat (hari)">
                <Input type="number" min={1} value={s.monitor.retentionDays} onChange={num('monitor.retentionDays')} />
              </Field>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <div className="flex flex-wrap items-center gap-4">
                <Archive className="size-4 text-brand" />
                <Toggle checked={s.backup.enabled} onChange={(v) => set('backup.enabled', v)} label="Backup otomatis harian semua router" />
                <Field label="Jam">
                  <Select value={s.backup.hour} onChange={(e) => set('backup.hour', Number(e.target.value))} className="w-24">
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <p className="mt-2 text-xs text-muted">File .backup dan .rsc disimpan di penyimpanan masing-masing router.</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
