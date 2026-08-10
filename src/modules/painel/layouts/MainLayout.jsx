import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Home, LayoutDashboard, Briefcase, Truck } from 'lucide-react';
import AppShell from '@shared/components/layout/AppShell';
import ModuleSidebar from '@shared/components/layout/ModuleSidebar';
import { ModulesSwitcher } from '@painel/components/ModulesSwitcher';

/**
 * Layout do Painel — reutiliza AppShell + ModuleSidebar compartilhados.
 * O gate de acesso (AdminRoute) fica em App.jsx, não neste layout,
 * para permitir troca futura por permissões específicas sem reescrever o módulo.
 */
export default function MainLayout() {
  const { t } = useTranslation();

  const items = useMemo(
    () => [
      { path: '/painel/home', label: t('painel.nav.home'), icon: Home, end: true },
      { path: '/painel/dashboard', label: t('painel.nav.dashboard'), icon: LayoutDashboard },
      { path: '/painel/comercial', label: t('painel.nav.comercial'), icon: Briefcase },
      { path: '/painel/logistica', label: t('painel.nav.logistica'), icon: Truck },
    ],
    [t]
  );

  return (
    <AppShell
      sidebar={({ collapsed, setCollapsed }) => (
        <ModuleSidebar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          logoSrc="/icons/chemctrl-logo.svg"
          logoAlt="ChemCtrl"
          moduleName={t('sidebar.moduleName')}
          moduleSubtitle={t('painel.subtitle')}
          items={items}
          showModulesLink
        />
      )}
      topBarProps={{
        topBarActions: <ModulesSwitcher />,
      }}
    />
  );
}
