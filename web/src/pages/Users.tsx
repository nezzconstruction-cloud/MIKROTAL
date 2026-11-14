import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, UserCog } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { ROLE_LABEL, useAuth, type Role } from '../lib/auth';
import { formatDate } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Toggle, useAction, useFeedback } from '../components/ui';

interface AppUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  reseller_id: number | null;
  reseller_name: string | null;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
}

const ROLE_DESC: Record<Role, string> = {
  superadmin: 'Akses penuh termasuk pengguna & pengaturan',
  admin: 'Kelola router, konfigurasi, voucher, reseller, laporan',
  operator: 'Monitoring, hotspot, buat & cetak voucher (tanpa ubah konfigurasi)',
  reseller: 'Hanya membuat voucher dari saldo sendiri',
};
const ROLE_TONE: Record<Role, 'violet' | 'cyan' | 'green' | 'orange'> = { superadmin: 'violet', admin: 'cyan', operator: 'green', reseller: 'orange' };

function UserForm({ initial, onClose }: { initial: AppUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { run, busy } = useAction();
  const resellers = useQuery({ queryKey: ['resellers'], queryFn: () => get<any[]>('/api/resellers') });
  const [f, setF] = useState({ username: initial?.username ?? '', name: initial?.name ?? '', role: (initial?.role ?? 'operator') as Role, reseller_id: initial?.reseller_id ?? null, active: initial?.active ?? true, password: '' });
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const body: Record<string, unknown> = { username: f.username, name: f.name, role: f.role, reseller_id: f.role === 'reseller' ? f.reseller_id : null, active: f.active };
    if (f.password) body.password = f.password;
    if (initial) await patch(`/api/users/${initial.id}`, body);
    else await post('/api/users', body);
    await qc.invalidateQueries({ queryKey: ['users'] });
    return true;
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? `Ubah ${initial.username}` : 'Pengguna baru'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={async () => (await run(save, 'Pengguna disimpan')) && onClose()}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Username" required>
          <Input value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Nama lengkap">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={initial ? 'Password baru' : 'Password'} required={!initial} hint={initial ? 'Kosongkan jika tidak diganti' : 'Minimal 6 karakter'}>
          <Input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Peran">
          <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-muted sm:col-span-2">{ROLE_DESC[f.role]}</p>
        {f.role === 'reseller' && (
          <Field label="Terhubung ke reseller" required className="sm:col-span-2">
            <Select value={f.reseller_id ?? ''} onChange={(e) => set('reseller_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— pilih reseller —</option>
              {(resellers.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Toggle checked={f.active} onChange={(v) => set('active', v)} label="Akun aktif" />
      </div>
    </Modal>
  );
}

export default function Users() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run } = useAction();
  const [editing, setEditing] = useState<AppUser | null | undefined>(undefined);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['users'], queryFn: () => get<AppUser[]>('/api/users') });
  return (
    <div>
      <PageHeader
        title="Pengguna Aplikasi"
        subtitle="Akun yang bisa login ke MIKROTAL beserta hak aksesnya"
        icon={<UserCog className="size-5" />}
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
            Pengguna baru
          </Button>
        }
      />
      <Card className="overflow-hidden">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={() => refetch()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Pengguna</th>
                  <th>Peran</th>
                  <th>Status</th>
                  <th>Login terakhir</th>
                  <th>Dibuat</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((u) => (
                  <tr key={u.id} className={!u.active ? 'row-disabled' : ''}>
                    <td>
                      <p className="font-semibold">{u.username}</p>
                      <p className="text-xs text-muted">{u.name}</p>
                    </td>
                    <td>
                      <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                      {u.reseller_name && <p className="mt-0.5 text-[11px] text-subtle">{u.reseller_name}</p>}
                    </td>
                    <td>{u.active ? <Badge tone="green" dot>aktif</Badge> : <Badge>nonaktif</Badge>}</td>
                    <td className="text-xs">{formatDate(u.last_login_at)}</td>
                    <td className="text-xs">{formatDate(u.created_at, false)}</td>
                    <td className="whitespace-nowrap text-right">
                      <IconButton title="Ubah" onClick={() => setEditing(u)}>
                        <Pencil className="size-4" />
                      </IconButton>
                      {u.id !== user?.id && (
                        <IconButton
                          title="Hapus"
                          tone="danger"
                          onClick={async () => {
                            if (!(await confirm({ title: `Hapus ${u.username}?`, danger: true, confirmText: 'Hapus' }))) return;
                            await run(() => del(`/api/users/${u.id}`), 'Pengguna dihapus');
                            void qc.invalidateQueries({ queryKey: ['users'] });
                          }}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
          <Card key={r} className="p-4">
            <Badge tone={ROLE_TONE[r]}>{ROLE_LABEL[r]}</Badge>
            <p className="mt-2 text-xs text-muted">{ROLE_DESC[r]}</p>
          </Card>
        ))}
      </div>
      {editing !== undefined && <UserForm initial={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
