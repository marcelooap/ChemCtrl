import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, BarChart3, Package, ClipboardList, BookOpen, Plus, Factory, ListOrdered,
  Shield, FlaskConical, FileCheck, Award, Box, Cylinder, ArrowRightLeft, Bell,
  Users, ChevronDown, ChevronRight, Building2, Warehouse, ClipboardCheck,
} from 'lucide-react';
import { canAccessRoute, getUserClient } from '@/lib/permissions';
import { getSidebarNavSpec } from '@/lib/rbac/permissionCatalog';
import { SidebarFooter } from '@/components/user/SidebarFooter';
import { cn } from '@/lib/utils';

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
  Bell,
  Users,
  Building2,
  Warehouse,
  ClipboardCheck,
};

const labelClass = (collapsed) =>
  cn(
    'truncate transition-all duration-300 overflow-hidden whitespace-nowrap',
    collapsed ? 'max-w-0 opacity-0' : 'max-w-[12rem] opacity-100'
  );

function resolveIcon(name) {
  return ICONS[name] || LayoutDashboard;
}

export default function Sidebar({ collapsed, setCollapsed, user }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navItems = useMemo(() => getSidebarNavSpec(), []);

  const [expandedGroups, setExpandedGroups] = useState(() => {
    const initial = {};
    for (const item of getSidebarNavSpec()) {
      if (item.groupId && item.children?.some((c) => {
        const path = c.path;
        if (!path) return false;
        if (typeof window === 'undefined') return false;
        const pathname = window.location.pathname;
        if (path === '/') return pathname === '/';
        return pathname === path || pathname.startsWith(`${path}/`);
      })) {
        initial[item.groupId] = true;
      }
    }
    return initial;
  });

  const toggleGroup = (groupId) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const isExterno = user?.tipo === 'externo';

  const visibleItems = useMemo(() => {
    if (isExterno) {
      return navItems.filter((i) => i.path === '/tela-clientes' || (i.children && i.children.some((c) => c.path === '/tela-clientes')));
    }
    return navItems;
  }, [isExterno, navItems]);

  const renderItem = (item) => {
    if (!canAccessRoute(user, item.path)) return null;

    const Icon = resolveIcon(item.icon);
    let label = t(item.labelKey);
    if (isExterno && item.path === '/tela-clientes') {
      const clientName = getUserClient(user)?.trim();
      if (clientName) label = clientName;
    }

    return (
      <Link
        key={item.path}
        to={item.path}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${isActive(item.path) ? 'text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
        style={isActive(item.path) ? { background: '#2575D1' } : {}}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className={labelClass(collapsed)}>{label}</span>
      </Link>
    );
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-screen z-40 flex flex-col transition-all duration-300 ${collapsed ? 'w-16' : 'w-64'}`}
      style={{ background: 'hsl(230, 25%, 12%)' }}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-3 px-4 h-16 border-b border-white/10 shrink-0 hover:bg-white/5 transition-colors w-full"
      >
        <img
          src="https://media.base44.com/images/public/6a3bc68b6dcf809125758419/36b0a109a_image.png"
          alt="ChemCtrl"
          className="w-8 h-8 rounded-lg shrink-0"
        />
        <div className={cn('overflow-hidden text-left transition-all duration-300', collapsed ? 'max-w-0 opacity-0' : 'max-w-[10rem] opacity-100')}>
          <p className="text-white font-bold text-sm leading-tight whitespace-nowrap">{t('common.appName')}</p>
          <p className="text-white/50 text-[10px] whitespace-nowrap">{t('sidebar.appSubtitle')}</p>
        </div>
      </button>

      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {visibleItems.map((item) => {
          if (item.children) {
            const accessibleChildren = item.children.filter((c) => canAccessRoute(user, c.path));
            if (!accessibleChildren.length) return null;

            const isGroupActive = accessibleChildren.some((c) => isActive(c.path));
            const isExpanded = expandedGroups[item.groupId];
            const groupLabel = t(item.labelKey);
            const GroupIcon = resolveIcon(item.icon);

            return (
              <div key={item.groupId} className="mb-0.5">
                <button
                  onClick={() => toggleGroup(item.groupId)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isGroupActive ? 'text-white bg-white/10' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
                >
                  <GroupIcon className="w-4 h-4 shrink-0" />
                  <span className={cn(labelClass(collapsed), 'flex-1 text-left')}>{groupLabel}</span>
                  <ChevronDown className={cn('w-3 h-3 shrink-0 transition-opacity duration-300', collapsed || !isExpanded ? 'hidden' : 'block')} />
                  <ChevronRight className={cn('w-3 h-3 shrink-0 transition-opacity duration-300', collapsed || isExpanded ? 'hidden' : 'block')} />
                </button>
                {!collapsed && isExpanded && (
                  <div className="ml-4 pl-3 border-l border-white/10">
                    {accessibleChildren.map((child) => {
                      const ChildIcon = resolveIcon(child.icon);
                      return (
                        <Link
                          key={child.path}
                          to={child.path}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${isActive(child.path) ? 'text-white bg-white/10' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
                        >
                          <ChildIcon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{t(child.labelKey)}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          return renderItem(item);
        })}
      </nav>

      <SidebarFooter
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />
    </aside>
  );
}
