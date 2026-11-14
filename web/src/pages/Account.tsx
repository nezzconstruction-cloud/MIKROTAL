import { useState } from 'react';
import { KeyRound, UserCog } from 'lucide-react';
import { post } from '../lib/api';
import { ROLE_LABEL, useAuth } from '../lib/auth';
import { Badge, Button, Card, CardHeader, Field, Input, KeyValue, PageHeader, useAction } from '../components/ui';

export default function Account() {
  const { user } = useAuth();
  const { run, busy } = useAction();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  if (!user) return null;
  return (
    <div className="space-y-5">
      <PageHeader title="Akun saya" icon={<UserCog className="size-5" />} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profil" />
          <div className="p-5">
            <KeyValue
              items={[
                ['Username', user.username],
                ['Nama', user.name || '—'],
                ['Peran', <Badge tone="violet">{ROLE_LABEL[user.role]}</Badge>],
                ...(user.reseller_name ? ([['Reseller', user.reseller_name]] as [string, string][]) : []),
                ['Hak akses', `${user.permissions.length} izin`],
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Ganti password" icon={<KeyRound className="size-4" />} />
          <form
            className="space-y-4 p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (password !== confirm) {
                await run(() => Promise.reject(new Error('Konfirmasi password tidak sama')));
                return;
              }
              const ok = await run(() => post('/api/auth/password', { current, password }), 'Password berhasil diganti');
              if (ok) {
                setCurrent('');
                setPassword('');
                setConfirm('');
              }
            }}
          >
            <Field label="Password lama">
              <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label="Password baru" hint="Minimal 6 karakter">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Ulangi password baru">
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
            <Button type="submit" loading={busy} disabled={!current || !password}>
              Simpan password
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
