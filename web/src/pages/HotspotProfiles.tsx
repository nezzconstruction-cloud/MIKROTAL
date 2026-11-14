import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Gauge, Layers, Pencil, Plus, Ticket, Trash2, Users } from 'lucide-react';
import { del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { durationLabel, formatBytes, formatMoney } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, useAction, useFeedback } from '../components/ui';
import { RequireRouter } from '../components/RequireRouter';

interface Profile {
  '.id': string;
  name: string;
  'rate-limit'?: string;
  'shared-users'?: string;
  'session-timeout'?: string;
  'idle-timeout'?: string;
  'keepalive-timeout'?: string;
  'address-pool'?: string;
  'parent-queue'?: string;
  'mac-cookie-timeout'?: string;
  meta: { price: number; reseller_price: number; validity: string; time_limit: string; data_limit: number; color: string };
  users: number;
  stock: number;
}

const PRESETS = [
  { name: '1JAM', rate: '2M/2M', price: 3000, validity: '1d', time: '1h' },
  { name: '3JAM', rate: '3M/3M', price: 5000, validity: '1d', time: '3h' },
  { name: '1HARI', rate: '5M/5M', price: 5000, validity: '1d', time: '' },
  { name: '7HARI', rate: '8M/8M', price: 25000, validity: '7d', time: '' },
  { name: '30HARI', rate: '10M/10M', price: 75000, validity: '30d', time: '' },
];

function ProfileForm({ routerId, initial, onClose }: { routerId: number; initial: Profile | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { run, busy } = useAction();
  const [f, setF] = useState(() => ({
    name: initial?.name ?? '',
    rate_limit: initial?.['rate-limit'] ?? '',
    shared_users: Number(initial?.['shared-users'] ?? 1),
    session_timeout: initial?.['session-timeout'] && initial['session-timeout'] !== '0s' ? initial['session-timeout'] : '',
    idle_timeout: initial?.['idle-timeout'] && initial['idle-timeout'] !== 'none' ? initial['idle-timeout'] : '',
    keepalive_timeout: initial?.['keepalive-timeout'] ?? '2m',
    address_pool: initial?.['address-pool'] && initial['address-pool'] !== 'none' ? initial['address-pool'] : '',
    parent_queue: initial?.['parent-queue'] && initial['parent-queue'] !== 'none' ? initial['parent-queue'] : '',
    mac_cookie_timeout: initial?.['mac-cookie-timeout'] ?? '',
    price: initial?.meta.price ?? 0,
    reseller_price: initial?.meta.reseller_price ?? 0,
    validity: initial?.meta.validity ?? '',
    time_limit: initial?.meta.time_limit ?? '',
    data_limit: initial?.meta.data_limit ? formatBytes(initial.meta.data_limit, 0).replace(' ', '').replace('B', '') : '',
    color: initial?.meta.color ?? '',
  }));
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const body = { ...f, shared_users: Number(f.shared_users), price: Number(f.price), reseller_price: Number(f.reseller_price) };
    if (initial) await put(`/api/routers/${routerId}/hotspot/profiles/${encodeURIComponent(initial.name)}`, body);
    else await post(`/api/routers/${routerId}/hotspot/profiles`, body);
    await qc.invalidateQueries({ queryKey: ['hs-profiles', routerId] });
    return true;
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={initial ? `Ubah profil ${initial.name}` : 'Profil hotspot baru'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={async () => (await run(save, 'Profil disimpan')) && onClose()}>
            Simpan
          </Button>
        </>
      }
    >
      {!initial && (
        <div className="mb-5">
          <p className="mb-2 text-xs font-medium text-muted">Template cepat</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => setF((x) => ({ ...x, name: p.name, rate_limit: p.rate, price: p.price, validity: p.validity, time_limit: p.time }))} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand hover:text-brand">
                {p.name} • {formatMoney(p.price)}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle">Penjualan (disimpan di MIKROTAL)</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Harga jual" hint="Harga ke pelanggan">
          <Input type="number" value={f.price} onChange={(e) => set('price', e.target.value)} />
        </Field>
        <Field label="Harga reseller" hint="0 = pakai diskon reseller">
          <Input type="number" value={f.reseller_price} onChange={(e) => set('reseller_price', e.target.value)} />
        </Field>
        <Field label="Masa aktif" hint="Sejak login pertama: 1d, 7d, 30d">
          <Input value={f.validity} onChange={(e) => set('validity', e.target.value)} placeholder="1d" />
        </Field>
        <Field label="Batas waktu pakai" hint="Total uptime: 1h, 3h (kosong = tanpa batas)">
          <Input value={f.time_limit} onChange={(e) => set('time_limit', e.target.value)} placeholder="3h" />
        </Field>
        <Field label="Batas kuota" hint="mis. 1G, 500M (kosong = unlimited)">
          <Input value={f.data_limit} onChange={(e) => set('data_limit', e.target.value)} placeholder="1G" />
        </Field>
        <Field label="Warna label voucher">
          <Input type="color" className="h-[38px] p-1" value={f.color || '#06b6d4'} onChange={(e) => set('color', e.target.value)} />
        </Field>
      </div>
      <p className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wider text-subtle">Pengaturan di router</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nama profil" required>
          <Input value={f.name} onChange={(e) => set('name', e.target.value.replace(/\s/g, ''))} placeholder="1HARI" />
        </Field>
        <Field label="Rate limit (U/D)" hint="mis. 5M/5M atau 2M/5M 4M/8M 1M/2M 8/8">
          <Input value={f.rate_limit} onChange={(e) => set('rate_limit', e.target.value)} placeholder="5M/5M" />
        </Field>
        <Field label="Shared users" hint="Jumlah perangkat per akun">
          <Input type="number" min={1} value={f.shared_users} onChange={(e) => set('shared_users', e.target.value)} />
        </Field>
        <Field label="Session timeout">
          <Input value={f.session_timeout} onChange={(e) => set('session_timeout', e.target.value)} placeholder="kosong = tanpa" />
        </Field>
        <Field label="Idle timeout">
          <Input value={f.idle_timeout} onChange={(e) => set('idle_timeout', e.target.value)} placeholder="kosong = none" />
        </Field>
        <Field label="Keepalive timeout">
          <Input value={f.keepalive_timeout} onChange={(e) => set('keepalive_timeout', e.target.value)} placeholder="2m" />
        </Field>
        <Field label="Address pool">
          <Input value={f.address_pool} onChange={(e) => set('address_pool', e.target.value)} placeholder="none" />
        </Field>
        <Field label="Parent queue">
          <Input value={f.parent_queue} onChange={(e) => set('parent_queue', e.target.value)} placeholder="none" />
        </Field>
        <Field label="MAC cookie timeout">
          <Input value={f.mac_cookie_timeout} onChange={(e) => set('mac_cookie_timeout', e.target.value)} placeholder="3d" />
        </Field>
      </div>
    </Modal>
  );
}

function ProfilesBody({ routerId }: { routerId: number }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run } = useAction();
  const [editing, setEditing] = useState<Profile | null | undefined>(undefined);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['hs-profiles', routerId], queryFn: () => get<Profile[]>(`/api/routers/${routerId}/hotspot/profiles`) });
  const writable = can('hotspot.write');

  const remove = async (p: Profile) => {
    if (!(await confirm({ title: `Hapus profil ${p.name}?`, message: p.users ? `Masih ada ${p.users} pengguna memakai profil ini. Mereka akan kembali ke profil default.` : 'Profil akan dihapus dari router.', danger: true, confirmText: 'Hapus' }))) return;
    await run(() => del(`/api/routers/${routerId}/hotspot/profiles/${encodeURIComponent(p.name)}`), 'Profil dihapus');
    void qc.invalidateQueries({ queryKey: ['hs-profiles', routerId] });
  };

  return (
    <div>
      <PageHeader
        title="Profil & Harga Hotspot"
        subtitle="Atur paket kecepatan, masa aktif, batas waktu/kuota, dan harga jual voucher"
        icon={<Layers className="size-5" />}
        actions={
          writable && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
              Profil baru
            </Button>
          )
        }
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : !data?.length ? (
        <Card>
          <EmptyState title="Belum ada profil" />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.map((p) => (
            <Card key={p['.id']} className="relative overflow-hidden p-5">
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: p.meta.color || 'linear-gradient(90deg,var(--brand),var(--brand-2))' }} />
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-lg font-bold">{p.name}</p>
                  <p className="text-2xl font-extrabold text-gradient">{p.meta.price ? formatMoney(p.meta.price) : 'Gratis/member'}</p>
                  {p.meta.reseller_price > 0 && <p className="text-xs text-muted">Reseller {formatMoney(p.meta.reseller_price)}</p>}
                </div>
                {writable && (
                  <div className="flex">
                    <IconButton title="Ubah" onClick={() => setEditing(p)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    {p.name !== 'default' && (
                      <IconButton title="Hapus" tone="danger" onClick={() => remove(p)}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <p className="flex items-center gap-2 text-muted">
                  <Gauge className="size-4 text-brand" /> Kecepatan <b className="ml-auto text-fg">{p['rate-limit'] || 'Unlimited'}</b>
                </p>
                <p className="flex items-center gap-2 text-muted">
                  <Clock className="size-4 text-brand" /> Masa aktif <b className="ml-auto text-fg">{durationLabel(p.meta.validity)}</b>
                </p>
                <p className="flex items-center gap-2 text-muted">
                  <Clock className="size-4 text-brand" /> Batas pakai <b className="ml-auto text-fg">{p.meta.time_limit ? durationLabel(p.meta.time_limit) : 'Tanpa batas'}</b>
                </p>
                {p.meta.data_limit > 0 && (
                  <p className="flex items-center gap-2 text-muted">
                    <Gauge className="size-4 text-brand" /> Kuota <b className="ml-auto text-fg">{formatBytes(p.meta.data_limit)}</b>
                  </p>
                )}
                <p className="flex items-center gap-2 text-muted">
                  <Users className="size-4 text-brand" /> Shared users <b className="ml-auto text-fg">{p['shared-users'] ?? 1}</b>
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                <div className="flex gap-1.5">
                  <Badge tone="cyan">{p.stock} stok</Badge>
                  <Badge>{p.users} user</Badge>
                </div>
                {can('voucher.write') && p.name !== 'default' && (
                  <Link to={`/vouchers/generate?profile=${encodeURIComponent(p.name)}`}>
                    <Button size="sm" variant="secondary" icon={<Ticket className="size-3.5" />}>
                      Buat voucher
                    </Button>
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing !== undefined && <ProfileForm routerId={routerId} initial={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

export default function HotspotProfiles() {
  return <RequireRouter>{(id) => <ProfilesBody key={id} routerId={id} />}</RequireRouter>;
}
