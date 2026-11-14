import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Router as RouterIcon, WifiOff } from 'lucide-react';
import { useRouters, type RouterInfo } from '../lib/router-context';
import { useRealtime } from '../lib/realtime';
import { Button, Card, EmptyState, Loading } from './ui';

/** Pastikan ada router aktif sebelum menampilkan halaman yang butuh koneksi router. */
export function RequireRouter({ children }: { children: (routerId: number, router: RouterInfo) => ReactNode }) {
  const { routers, router, loading } = useRouters();
  const { snapshots } = useRealtime();
  if (loading) return <Loading />;
  if (!routers.length || !router) {
    return (
      <Card>
        <EmptyState
          icon={<RouterIcon className="size-6" />}
          title="Belum ada router"
          description="Tambahkan router MikroTik terlebih dahulu untuk mulai memantau dan mengelola jaringan."
          action={
            <Link to="/routers">
              <Button>Tambah router</Button>
            </Link>
          }
        />
      </Card>
    );
  }
  const snap = snapshots[router.id] ?? router.snapshot;
  return (
    <>
      {snap && !snap.online && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-rose-500" />
          <div>
            <p className="font-medium text-rose-600 dark:text-rose-400">{router.name} sedang offline</p>
            <p className="text-xs text-muted">{snap.error ?? 'Router tidak merespons.'} Data mungkin gagal dimuat.</p>
          </div>
        </div>
      )}
      {children(router.id, router)}
    </>
  );
}
