import { useParams } from 'react-router-dom';
import { Lock, Settings2 } from 'lucide-react';
import { RESOURCE_MAP } from '../resources';
import { useAuth } from '../lib/auth';
import { Card, EmptyState, PageHeader } from '../components/ui';
import { ResourceTable } from '../components/ResourceTable';
import { RequireRouter } from '../components/RequireRouter';

export default function ResourcePage() {
  const { key = '' } = useParams();
  const { can } = useAuth();
  const def = RESOURCE_MAP[key];
  if (!def) {
    return (
      <Card>
        <EmptyState title="Menu tidak ditemukan" />
      </Card>
    );
  }
  if (!can(def.group === 'hotspot' ? 'hotspot.view' : 'config.view')) {
    return (
      <Card>
        <EmptyState icon={<Lock className="size-6" />} title="Akses ditolak" />
      </Card>
    );
  }
  return (
    <div>
      <PageHeader title={def.title} subtitle={def.description} icon={<Settings2 className="size-5" />} />
      <RequireRouter>{(routerId) => <ResourceTable key={`${routerId}-${def.key}`} def={def} routerId={routerId} />}</RequireRouter>
    </div>
  );
}
