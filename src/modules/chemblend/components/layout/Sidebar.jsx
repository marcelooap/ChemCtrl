import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, BarChart3, Package, ClipboardList, BookOpen, Plus, Factory, ListOrdered,
  Shield, FlaskConical, FileCheck, Award, Box, Cylinder, ArrowRightLeft,
  Users, Building2, Warehouse, ClipboardCheck,
} from 'lucide-react';
import { canAccessRoute, getUserClient } from '@chemblend/lib/permissions';
import { getSidebarNavSpec } from '@chemblend/lib/rbac/permissionCatalog';
import ModuleSidebar from '@shared/components/layout/ModuleSidebar';

const ICONS = {
  LayoutDashboard,
  BarChart3,
  Package,
  ClipboardList,
  BookOpen,
  Plus,
  Factory,
  ListOrdered,
  Shield,
  FlaskConical,
  FileCheck,
  Award,
  Box,
  Cylinder,
  ArrowRightLeft,
  Users,
  Building2,
  Warehouse,
  ClipboardCheck,
};

function resolveIcon(name) {
  return ICONS[name] || LayoutDashboard;
}

export default function Sidebar({ collapsed, setCollapsed, user }) {
  const { t } = useTranslation();
  const navSpec = useMemo(() => getSidebarNavSpec(), []);

  const isExterno = user?.tipo === 'externo';

  const items = useMemo(() => {
    const mapped = navSpec.map((item) => {
      if (item.children) {
        return {
          ...item,
          icon: resolveIcon(item.icon),
          children: item.children.map((child) => ({
            ...child,
            icon: resolveIcon(child.icon),
          })),
        };
      }
      return {
        ...item,
        icon: resolveIcon(item.icon),
      };
    });

    if (isExterno) {
      return mapped.filter(
        (i) =>
          i.path === '/chemblend/tela-clientes' ||
          (i.children && i.children.some((c) => c.path === '/chemblend/tela-clientes'))
      );
    }
    return mapped;
  }, [isExterno, navSpec]);

  const resolveLabel = (item) => {
    let label = t(item.labelKey);
    if (isExterno && item.path === '/chemblend/tela-clientes') {
      const clientName = getUserClient(user)?.trim();
      if (clientName) label = clientName;
    }
    return label;
  };

  return (
    <ModuleSidebar
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      logoSrc="/icons/chemblend-logo.png"
      logoAlt="ChemBlend"
      moduleName={t('sidebar.moduleName')}
      moduleSubtitle={t('sidebar.appSubtitle')}
      items={items}
      canAccessPath={(path) => canAccessRoute(user, path)}
      resolveLabel={resolveLabel}
      showModulesLink
    />
  );
}
