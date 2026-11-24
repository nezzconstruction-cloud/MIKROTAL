import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminAudit, AdminInvoices, AdminLayout, AdminLogin, AdminOverview, AdminPlans, AdminSettings, AdminTenants } from './Admin';
import { Landing } from './Landing';

/** Domain utama MIKROTAL Cloud: halaman depan & pendaftaran, serta panel admin platform. */
export function PlatformApp() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminOverview />} />
        <Route path="invoices" element={<AdminInvoices />} />
        <Route path="tenants" element={<AdminTenants />} />
        <Route path="plans" element={<AdminPlans />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="audit" element={<AdminAudit />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
