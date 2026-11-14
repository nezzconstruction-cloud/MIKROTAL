import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { durationLabel, formatMoney } from '../lib/format';
import type { PppPackage } from '../lib/pppoe';
import { RequireRouter } from '../components/RequireRouter';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Toggle, useAction, useFeedback } from '../components/ui';

function PackageModal({ routerId, pkg, onClose }: { routerId: number; pkg?: PppPackage; onClose: () => void }) {
  const { run, busy } = useAction();
  const qc = useQueryClient();
  const { data: profiles = [] } = useQuery({ queryKey: ['ppp-profiles', routerId], queryFn: () => get<{ name: string; rate_limit: string }[]>('/api/pppoe/profiles', { routerId }) });
  const [f, setF] = useState({
    name: pkg?.name ?? '',
    profile: pkg?.profile ?? '',
    price: String(pkg?.price ?? ''),
    resellerPrice: String(pkg?.reseller_price ?? ''),
    validity: pkg?.validity ?? '30d',
    active: pkg ? !!pkg.active : true,
  });
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    const body = { routerId, name: f.name, profile: f.profile, price: Number(f.price || 0), resellerPrice: Number(f.resellerPrice || 0), validity: f.validity, active: f.active };
    const r = await run(() => (pkg ? put(`/api/pppoe/packages/${pkg.id}`, body) : post('/api/pppoe/packages', body)), 'Paket disimpan');
    if (r) {
      void qc.invalidateQueries({ queryKey: ['ppp-packages'] });
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={pkg ? `Ubah paket ${pkg.name}` : 'Paket PPPoE baru'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={save}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nama paket" required className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Rumahan 10 Mbps" autoFocus />
        </Field>
        <Field label="Profil PPP di router" required hint="Kecepatan diatur di profil ini (menu PPP Profile)" className="sm:col-span-2">
          <Select value={f.profile} onChange={(e) => set('profile', e.target.value)}>
            <option value="">— pilih profil —</option>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.rate_limit ? ` (${p.rate_limit})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Harga jual">
          <Input type="number" min={0} value={f.price} onChange={(e) => set('price', e.target.value)} placeholder="150000" />
        </Field>
        <Field label="Harga reseller" hint="0 = pakai diskon reseller">
          <Input type="number" min={0} value={f.resellerPrice} onChange={(e) => set('resellerPrice', e.target.value)} placeholder="135000" />
        </Field>
        <Field label="Masa aktif per voucher" required hint="Contoh: 30d, 7d, 1d">
          <Input value={f.validity} onChange={(e) => set('validity', e.target.value)} />
        </Field>
        <div className="flex items-end pb-2">
          <Toggle checked={f.active} onChange={(v) => set('active', v)} label="Paket dijual" />
        </div>
      </div>
    </Modal>
  );
}

function Inner({ routerId }: { routerId: number }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run } = useAction();
  const [editing, setEditing] = useState<PppPackage | 'new' | null>(null);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['ppp-packages', routerId], queryFn: () => get<PppPackage[]>('/api/pppoe/packages', { routerId }) });
  const write = can('customer.write');

  const remove = async (p: PppPackage) => {
    if (!(await confirm({ title: `Hapus paket ${p.name}?`, message: `${p.customers} pelanggan memakai paket ini. Mereka tetap tersambung dengan profil yang sama, tetapi tidak lagi terhubung ke paket.`, danger: true, confirmText: 'Hapus' }))) return;
    await run(() => del(`/api/pppoe/packages/${p.id}`), 'Paket dihapus');
    void qc.invalidateQueries({ queryKey: ['ppp-packages'] });
  };

  return (
    <div>
      <PageHeader
        title="Paket PPPoE"
        subtitle="Paket menentukan profil kecepatan, harga, dan masa aktif setiap voucher isi ulang"
        icon={<Package className="size-5" />}
        actions={
          write && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Paket baru
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={() => refetch()} />
        ) : !data.length ? (
          <EmptyState icon={<Package className="size-6" />} title="Belum ada paket" description="Buat paket terlebih dahulu, lalu daftarkan pelanggan dan buat voucher isi ulangnya." action={write && <Button onClick={() => setEditing('new')}>Paket baru</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Paket</th>
                  <th>Profil PPP</th>
                  <th>Masa aktif</th>
                  <th>Harga jual</th>
                  <th>Harga reseller</th>
                  <th>Pelanggan</th>
                  <th>Status</th>
                  {write && <th className="text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td className="font-semibold">{p.name}</td>
                    <td>
                      <Badge tone="violet">{p.profile}</Badge>
                    </td>
                    <td>{durationLabel(p.validity)}</td>
                    <td className="tabular-nums">{formatMoney(p.price)}</td>
                    <td className="tabular-nums">{p.reseller_price > 0 ? formatMoney(p.reseller_price) : <span className="text-subtle">diskon reseller</span>}</td>
                    <td className="tabular-nums">{p.customers}</td>
                    <td>
                      <Badge tone={p.active ? 'green' : 'gray'} dot>
                        {p.active ? 'Dijual' : 'Tidak dijual'}
                      </Badge>
                    </td>
                    {write && (
                      <td className="whitespace-nowrap text-right">
                        <IconButton title="Ubah" onClick={() => setEditing(p)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton title="Hapus" tone="danger" onClick={() => remove(p)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <PackageModal routerId={routerId} pkg={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export default function PppPackages() {
  return <RequireRouter>{(routerId) => <Inner key={routerId} routerId={routerId} />}</RequireRouter>;
}
