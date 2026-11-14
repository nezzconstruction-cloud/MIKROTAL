import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Clock, Globe, Power, Save, Server, Tag } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, CardHeader, Field, Input, KeyValue, Loading, PageHeader, Toggle, useAction, useFeedback } from '../components/ui';
import { RequireRouter } from '../components/RequireRouter';
import { ResourceTable } from '../components/ResourceTable';
import { RESOURCE_MAP } from '../resources';

function useSingle(routerId: number, path: string) {
  return useQuery({ queryKey: ['single', routerId, path], queryFn: () => get<Record<string, string>>(`/api/routers/${routerId}/single`, { path }) });
}

function SystemBody({ routerId }: { routerId: number }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run, busy } = useAction();
  const identity = useSingle(routerId, '/system/identity');
  const dns = useSingle(routerId, '/ip/dns');
  const clock = useSingle(routerId, '/system/clock');
  const ntp = useSingle(routerId, '/system/ntp/client');
  const rb = useSingle(routerId, '/system/routerboard');
  const writable = can('config.write');

  const [name, setName] = useState('');
  const [servers, setServers] = useState('');
  const [remote, setRemote] = useState(false);
  const [tz, setTz] = useState('');
  const [ntpServers, setNtpServers] = useState('');
  const [ntpOn, setNtpOn] = useState(false);
  useEffect(() => identity.data && setName(identity.data.name ?? ''), [identity.data]);
  useEffect(() => {
    if (dns.data) {
      setServers(dns.data.servers ?? '');
      setRemote(dns.data['allow-remote-requests'] === 'true');
    }
  }, [dns.data]);
  useEffect(() => clock.data && setTz(clock.data['time-zone-name'] ?? ''), [clock.data]);
  useEffect(() => {
    if (ntp.data) {
      setNtpServers(ntp.data.servers ?? ntp.data['server-dns-names'] ?? '');
      setNtpOn(ntp.data.enabled === 'true');
    }
  }, [ntp.data]);

  const saveSingle = (path: string, body: Record<string, unknown>, msg: string) =>
    run(async () => {
      await patch(`/api/routers/${routerId}/single`, body, { path });
      await qc.invalidateQueries({ queryKey: ['single', routerId] });
      void qc.invalidateQueries({ queryKey: ['routers'] });
      return true;
    }, msg);

  if (identity.isLoading) return <Loading />;

  return (
    <div className="space-y-5">
      <PageHeader title="Sistem & Backup" subtitle="Identitas, DNS, waktu, backup konfigurasi, dan reboot" icon={<Server className="size-5" />} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Identitas router" icon={<Tag className="size-4" />} />
          <div className="space-y-4 p-5">
            <Field label="System identity">
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!writable} />
            </Field>
            {writable && (
              <Button size="sm" icon={<Save className="size-4" />} loading={busy} onClick={() => saveSingle('/system/identity', { name }, 'Identity disimpan')}>
                Simpan
              </Button>
            )}
            {rb.data && (
              <div className="border-t border-line pt-4">
                <KeyValue
                  items={[
                    ['Model', rb.data.model ?? '—'],
                    ['Serial number', rb.data['serial-number'] ?? '—'],
                    ['Firmware', `${rb.data['current-firmware'] ?? '—'} (upgrade: ${rb.data['upgrade-firmware'] ?? '—'})`],
                  ]}
                />
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="DNS" icon={<Globe className="size-4" />} subtitle={dns.data ? `Cache ${dns.data['cache-used'] ?? '?'} / ${dns.data['cache-size'] ?? '?'}` : undefined} />
          <div className="space-y-4 p-5">
            <Field label="DNS servers" hint="Pisahkan dengan koma">
              <Input value={servers} onChange={(e) => setServers(e.target.value)} disabled={!writable} placeholder="8.8.8.8,1.1.1.1" />
            </Field>
            {dns.data?.['dynamic-servers'] && <p className="text-xs text-muted">DNS dinamis dari ISP: {dns.data['dynamic-servers']}</p>}
            <Toggle checked={remote} onChange={setRemote} disabled={!writable} label="Allow remote requests (router jadi DNS server klien)" />
            {writable && (
              <Button size="sm" icon={<Save className="size-4" />} loading={busy} onClick={() => saveSingle('/ip/dns', { servers, 'allow-remote-requests': remote }, 'DNS disimpan')}>
                Simpan
              </Button>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Waktu & NTP" icon={<Clock className="size-4" />} subtitle={clock.data ? `Sekarang ${clock.data.date ?? ''} ${clock.data.time ?? ''}` : undefined} />
          <div className="space-y-4 p-5">
            <Field label="Zona waktu">
              <Input value={tz} onChange={(e) => setTz(e.target.value)} disabled={!writable} placeholder="Asia/Jakarta" />
            </Field>
            {writable && (
              <Button size="sm" variant="secondary" loading={busy} onClick={() => saveSingle('/system/clock', { 'time-zone-name': tz }, 'Zona waktu disimpan')}>
                Simpan zona waktu
              </Button>
            )}
            <div className="border-t border-line pt-4">
              <Field label="NTP servers">
                <Input value={ntpServers} onChange={(e) => setNtpServers(e.target.value)} disabled={!writable} placeholder="id.pool.ntp.org" />
              </Field>
              <div className="mt-3 flex items-center justify-between">
                <Toggle checked={ntpOn} onChange={setNtpOn} disabled={!writable} label="NTP client aktif" />
                {writable && (
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => saveSingle('/system/ntp/client', { enabled: ntpOn, servers: ntpServers }, 'NTP disimpan')}>
                    Simpan NTP
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Backup & daya" icon={<Archive className="size-4" />} />
          <div className="space-y-4 p-5">
            <p className="text-sm text-muted">Buat file backup (.backup) dan export konfigurasi (.rsc) di penyimpanan router. Backup otomatis harian bisa diaktifkan di Pengaturan.</p>
            <div className="flex flex-wrap gap-2">
              {writable && (
                <Button
                  icon={<Archive className="size-4" />}
                  loading={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await post<{ name: string }>(`/api/routers/${routerId}/backup`);
                      void qc.invalidateQueries({ queryKey: ['res', routerId, '/file'] });
                      return r;
                    }, 'Backup dibuat di router')
                  }
                >
                  Backup sekarang
                </Button>
              )}
              {can('system.danger') && (
                <Button
                  variant="danger"
                  icon={<Power className="size-4" />}
                  onClick={async () => {
                    if (!(await confirm({ title: 'Reboot router?', message: 'Semua pengguna akan terputus selama router menyala ulang (±1-3 menit).', danger: true, confirmText: 'Reboot sekarang' }))) return;
                    await run(() => post(`/api/routers/${routerId}/reboot`), 'Perintah reboot dikirim');
                  }}
                >
                  Reboot
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>
      <div>
        <h2 className="mb-3 text-sm font-semibold">File di router</h2>
        <ResourceTable def={RESOURCE_MAP.files} routerId={routerId} />
      </div>
    </div>
  );
}

export default function SystemPage() {
  return <RequireRouter>{(id) => <SystemBody key={id} routerId={id} />}</RequireRouter>;
}
