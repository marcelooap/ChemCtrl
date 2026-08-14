import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, BarChart3, Package, ClipboardList, BookOpen, Plus, Factory, ListOrdered,
  Shield, FlaskConical, FileCheck, Award, Box, Cylinder, ArrowRightLeft, Truck,
  Users, Building2, Warehouse, ClipboardCheck, CalendarDays,
} from 'lucide-react';
import { canAccessRoute, getUserClient } from '@industrializacao/lib/permissions';
import { getSidebarNavSpec } from '@industrializacao/lib/rbac/permissionCatalog';
import ModuleSidebar from '@shared/components/layout/ModuleSidebar';
import { useSaidaNovas } from '@transbordo/context/SaidaNovasContext';
import { SAIDA_PATH_INDUSTRIALIZACAO } from '@transbordo/lib/saidaNovas';

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
  Truck,
  Users,
  Building2,
  Warehouse,
  ClipboardCheck,
  CalendarDays,
};

function resolveIcon(name) {
  return ICONS[name] || LayoutDashboard;
}

export default function Sidebar({ collapsed, setCollapsed, user }) {
  const { t } = useTranslation();
  const { count } = useSaidaNovas();
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
            badgeCount: child.path === SAIDA_PATH_INDUSTRIALIZACAO ? count : 0,
          })),
        };
      }
      return {
        ...item,
        icon: resolveIcon(item.icon),
        badgeCount: item.path === SAIDA_PATH_INDUSTRIALIZACAO ? count : 0,
      };
    });

    if (isExterno) {
      return mapped.filter(
        (i) =>
          i.path === '/tela-clientes' ||
          (i.children && i.children.some((c) => c.path === '/tela-clientes'))
      );
    }
    return mapped;
  }, [isExterno, navSpec, count]);

  const resolveLabel = (item) => {
    let label = t(item.labelKey);
    if (isExterno && item.path === '/tela-clientes') {
      const clientName = getUserClient(user)?.trim();
      if (clientName) label = clientName;
    }
    return label;
  };

  return (
    <ModuleSidebar
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      logoSrc="/icons/chemctrl-logo.svg"
      logoAlt="ChemCtrl"
      moduleName={t('sidebar.moduleName')}
      moduleSubtitle={t('sidebar.appSubtitle')}
      items={items}
      canAccessPath={(path) => canAccessRoute(user, path)}
      resolveLabel={resolveLabel}
      showModulesLink={!isExterno}
    />
  );
}
