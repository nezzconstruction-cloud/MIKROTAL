import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Card, EmptyState, Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { RealtimeProvider } from './lib/realtime';
import { RouterProvider } from './lib/router-context';
import { LoginPage } from './pages/Login';
import { Lock } from 'lucide-react';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Routers = lazy(() => import('./pages/Routers'));
const Monitor = lazy(() => import('./pages/Monitor'));
const Traffic = lazy(() => import('./pages/Traffic'));
const Logs = lazy(() => import('./pages/Logs'));
const ResourcePage = lazy(() => import('./pages/ResourcePage'));
const HotspotActive = lazy(() => import('./pages/HotspotActive'));
const HotspotProfiles = lazy(() => import('./pages/HotspotProfiles'));
const VoucherGenerate = lazy(() => import('./pages/VoucherGenerate'));
const Vouchers = lazy(() => import('./pages/Vouchers'));
const Batches = lazy(() => import('./pages/Batches'));
const VoucherPrint = lazy(() => import('./pages/VoucherPrint'));
const LoginTemplate = lazy(() => import('./pages/LoginTemplate'));
const Resellers = lazy(() => import('./pages/Resellers'));
const MyBalance = lazy(() => import('./pages/MyBalance'));
const Reports = lazy(() => import('./pages/Reports'));
const SystemPage = lazy(() => import('./pages/System'));
const Ping = lazy(() => import('./pages/Ping'));
const TerminalPage = lazy(() => import('./pages/Terminal'));
const Users = lazy(() => import('./pages/Users'));
const Audit = lazy(() => import('./pages/Audit'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Account = lazy(() => import('./pages/Account'));
const PublicCheck = lazy(() => import('./pages/PublicCheck'));
const Customers = lazy(() => import('./pages/Customers'));
const PppPackages = lazy(() => import('./pages/PppPackages'));
const PppVouchers = lazy(() => import('./pages/PppVouchers'));
const PppVoucherPrint = lazy(() => import('./pages/PppVoucherPrint'));
const Topology = lazy(() => import('./pages/Topology'));
const Troubleshoot = lazy(() => import('./pages/Troubleshoot'));
const Isolir = lazy(() => import('./pages/Isolir'));

function Guard({ perm, children }: { perm?: string; children: ReactNode }) {
  const { can } = useAuth();
  if (perm && !can(perm)) {
    return (
      <Card>
        <EmptyState icon={<Lock className="size-6" />} title="Akses ditolak" description="Peran akun Anda tidak memiliki izin untuk membuka halaman ini." />
      </Card>
    );
  }
  return <>{children}</>;
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading text="Menyiapkan MIKROTAL..." />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <RealtimeProvider>
      <RouterProvider>{children}</RouterProvider>
    </RealtimeProvider>
  );
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/cek" element={<PublicCheck />} />
        <Route path="/isi" element={<Isolir />} />
        <Route path="/isolir" element={<Isolir />} />
        <Route
          path="/print-pppoe"
          element={
            <Protected>
              <PppVoucherPrint />
            </Protected>
          }
        />
        <Route
          path="/print"
          element={
            <Protected>
              <VoucherPrint />
            </Protected>
          }
        />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="routers" element={<Guard perm="router.view"><Routers /></Guard>} />
          <Route path="monitor" element={<Guard perm="router.view"><Monitor /></Guard>} />
          <Route path="traffic" element={<Guard perm="router.view"><Traffic /></Guard>} />
          <Route path="logs" element={<Guard perm="router.view"><Logs /></Guard>} />
          <Route path="res/:key" element={<ResourcePage />} />
          <Route path="hotspot/active" element={<Guard perm="hotspot.view"><HotspotActive /></Guard>} />
          <Route path="hotspot/profiles" element={<Guard perm="hotspot.view"><HotspotProfiles /></Guard>} />
          <Route path="vouchers/generate" element={<Guard perm="voucher.write"><VoucherGenerate /></Guard>} />
          <Route path="vouchers" element={<Guard perm="voucher.view"><Vouchers /></Guard>} />
          <Route path="vouchers/batches" element={<Guard perm="voucher.view"><Batches /></Guard>} />
          <Route path="vouchers/template" element={<Guard perm="hotspot.write"><LoginTemplate /></Guard>} />
          <Route path="customers" element={<Guard perm="customer.view"><Customers /></Guard>} />
          <Route path="pppoe/vouchers" element={<Guard perm="voucher.view"><PppVouchers /></Guard>} />
          <Route path="pppoe/packages" element={<Guard perm="customer.view"><PppPackages /></Guard>} />
          <Route path="troubleshoot" element={<Guard perm="customer.view"><Troubleshoot /></Guard>} />
          <Route path="topology" element={<Guard perm="customer.view"><Topology /></Guard>} />
          <Route path="resellers" element={<Guard perm="reseller.view"><Resellers /></Guard>} />
          <Route path="my-balance" element={<MyBalance />} />
          <Route path="reports" element={<Guard perm="report.view"><Reports /></Guard>} />
          <Route path="system" element={<Guard perm="config.view"><SystemPage /></Guard>} />
          <Route path="tools/ping" element={<Guard perm="config.view"><Ping /></Guard>} />
          <Route path="tools/terminal" element={<Guard perm="terminal"><TerminalPage /></Guard>} />
          <Route path="users" element={<Guard perm="users.manage"><Users /></Guard>} />
          <Route path="audit" element={<Guard perm="audit.view"><Audit /></Guard>} />
          <Route path="settings" element={<Guard perm="settings.manage"><SettingsPage /></Guard>} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
