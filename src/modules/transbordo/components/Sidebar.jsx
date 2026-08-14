import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  BarChart3,
  ClipboardList,
  PackagePlus,
  Send,
  Truck,
  Container,
  Filter,
  Boxes,
  PackageSearch,
  Cylinder,
} from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { canAccessRoute } from '@industrializacao/lib/permissions';
import { APP_MODULE_IDS, getSidebarNavSpec } from '@industrializacao/lib/rbac/permissionCatalog';
import ModuleSidebar from '@shared/components/layout/ModuleSidebar';
import { useSaidaNovas } from '@transbordo/context/SaidaNovasContext';
import { SAIDA_PATH_TRANSBORDO } from '@transbordo/lib/saidaNovas';

const ICONS = {
  LayoutDashboard,
  BarChart3,
  ClipboardList,
  PackagePlus,
  Send,
  Truck,
  Container,
  Filter,
  Boxes,
  PackageSearch,
  Cylinder,
};

function resolveIcon(name) {
  return ICONS[name] || LayoutDashboard;
}

export default function Sidebar({ collapsed, setCollapsed }) {
  const { t } = useTranslation();
  const { user } = useInternalAuth();
  const { count } = useSaidaNovas();
  const navSpec = useMemo(() => getSidebarNavSpec(APP_MODULE_IDS.TRANSBORDO), []);

  const items = useMemo(() => navSpec.map((item) => {
    if (item.children) {
      return {
        ...item,
        label: t(item.labelKey),
        icon: resolveIcon(item.icon),
        children: item.children.map((child) => ({
          ...child,
          label: t(child.labelKey),
          icon: resolveIcon(child.icon),
          badgeCount: child.path === SAIDA_PATH_TRANSBORDO ? count : 0,
        })),
      };
    }
    return {
      ...item,
      label: t(item.labelKey),
      icon: resolveIcon(item.icon),
      end: item.path === '/chemflow',
      badgeCount: item.path === SAIDA_PATH_TRANSBORDO ? count : 0,
    };
  }), [navSpec, t, count]);

  return (
    <ModuleSidebar
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      logoSrc="/icons/chemctrl-logo.svg"
      logoAlt="ChemCtrl"
      moduleName={t('sidebar.moduleName')}
      moduleSubtitle={t('sidebar.chemflowSubtitle')}
      items={items}
      canAccessPath={(path) => canAccessRoute(user, path)}
      showModulesLink
    />
  );
}
