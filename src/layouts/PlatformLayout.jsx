import AppShell from '@shared/components/layout/AppShell';
import PlatformSidebar from '@/components/layout/PlatformSidebar';

/**
 * Shell da plataforma ChemCtrl (hub pós-login): sidebar + topbar + Outlet.
 */
export default function PlatformLayout() {
  return (
    <AppShell
      sidebar={({ collapsed, setCollapsed }) => (
        <PlatformSidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      )}
      contentClassName="overflow-y-auto"
    />
  );
}
