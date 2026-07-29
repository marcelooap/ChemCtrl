import AppShell from '@shared/components/layout/AppShell';
import PlatformSidebar from '@/components/layout/PlatformSidebar';

/**
 * Shell da plataforma ChemCtrl (hub pós-login): sidebar + topbar + Outlet.
 */
export default function PlatformLayout() {
  return (
    <AppShell
      sidebar={<PlatformSidebar />}
      contentClassName="overflow-y-auto"
    />
  );
}
