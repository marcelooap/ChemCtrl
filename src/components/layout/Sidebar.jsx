import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, BarChart3, Package, ClipboardList, BookOpen, Plus, Factory, ListOrdered,
  Shield, FlaskConical, FileCheck, Award, Box, Cylinder, ArrowRightLeft, Bell,
  Users, ChevronDown, ChevronRight, Building2, Warehouse, ClipboardCheck, Lock
} from 'lucide-react';
import { canAccessRoute } from '@/lib/permissions';
import { SidebarFooter } from '@/components/user/SidebarFooter';
import { cn } from '@/lib/utils';

const labelClass = (collapsed) =>
  cn(
    'truncate transition-all duration-300 overflow-hidden whitespace-nowrap',
    collapsed ? 'max-w-0 opacity-0' : 'max-w-[12rem] opacity-100'
  );

const navItems = [
  { labelKey: 'sidebar.home', icon: LayoutDashboard, path: '/' },
  { labelKey: 'sidebar.dashboard', icon: BarChart3, path: '/dashboard' },
  { labelKey: 'sidebar.recipes', icon: BookOpen, path: '/receitas' },
  { labelKey: 'sidebar.orders', icon: ClipboardList, path: '/pedidos' },
  { labelKey: 'sidebar.rawMaterialStock', icon: Package, path: '/estoque' },
  { labelKey: 'sidebar.inventory', icon: ClipboardCheck, path: '/inventario' },
  { labelKey: 'sidebar.newProduction', icon: Plus, path: '/nova-producao' },
  { labelKey: 'sidebar.productions', icon: ListOrdered, path: '/producoes' },
  { labelKey: 'sidebar.productionOrders', icon: Factory, path: '/ordens' },
  {
    labelKey: 'sidebar.qualityControl', icon: Shield, path: null, groupId: 'qualityControl',
    children: [
      { labelKey: 'sidebar.tests', icon: FlaskConical, path: '/qualidade/ensaios' },
      { labelKey: 'sidebar.pendingAnalysis', icon: FileCheck, path: '/qualidade/producoes' },
      { labelKey: 'sidebar.coa', icon: Award, path: '/qualidade/coa' },
    ]
  },
  { labelKey: 'sidebar.containers', icon: Box, path: '/vasilhames' },
  { labelKey: 'sidebar.tankage', icon: Cylinder, path: '/tankagem' },
  { labelKey: 'sidebar.transfer', icon: ArrowRightLeft, path: '/transbordo' },
  { labelKey: 'sidebar.users', icon: Users, path: '/usuarios' },
  { labelKey: 'sidebar.notifications', icon: Bell, path: '/notificacoes' },
  { labelKey: 'sidebar.clientScreen', icon: Building2, path: '/tela-clientes' },
  { labelKey: 'sidebar.clientStock', icon: Warehouse, path: '/estoque-cliente' },
];

export default function Sidebar({ collapsed, setCollapsed, user }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [expandedGroups, setExpandedGroups] = useState({});

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const isExterno = user?.tipo === 'externo';
  const lockedTitle = t('sidebar.lockedTooltip');

  const visibleItems = isExterno
    ? navItems.filter(i => i.path === '/tela-clientes' || i.path === '/notificacoes')
    : navItems;

  const renderItem = (item) => {
    const accessible = canAccessRoute(user, item.path);
    const label = t(item.labelKey);

    if (!accessible) {
      return (
        <div key={item.path} title={lockedTitle}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 cursor-not-allowed select-none"
          style={{ opacity: 0.25 }}>
          <item.icon className="w-4 h-4 shrink-0 text-white/50" />
          <span className={cn(labelClass(collapsed), 'flex-1 text-white/50')}>{label}</span>
          <Lock className={cn('w-3 h-3 shrink-0 text-white/30 transition-opacity duration-300', collapsed ? 'opacity-0 w-0' : 'opacity-100')} />
        </div>
      );
    }

    return (
      <Link key={item.path} to={item.path}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${isActive(item.path) ? 'text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
        style={isActive(item.path) ? { background: '#2575D1' } : {}}>
        <item.icon className="w-4 h-4 shrink-0" />
        <span className={labelClass(collapsed)}>{label}</span>
      </Link>
    );
  };

  return (
    <aside className={`fixed left-0 top-0 h-screen z-40 flex flex-col transition-all duration-300 ${collapsed ? 'w-16' : 'w-64'}`}
      style={{ background: 'hsl(230, 25%, 12%)' }}>
      <button onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-3 px-4 h-16 border-b border-white/10 shrink-0 hover:bg-white/5 transition-colors w-full">
        <img src="https://media.base44.com/images/public/6a3bc68b6dcf809125758419/36b0a109a_image.png"
          alt="ChemCtrl" className="w-8 h-8 rounded-lg shrink-0" />
        <div className={cn('overflow-hidden text-left transition-all duration-300', collapsed ? 'max-w-0 opacity-0' : 'max-w-[10rem] opacity-100')}>
          <p className="text-white font-bold text-sm leading-tight whitespace-nowrap">{t('common.appName')}</p>
          <p className="text-white/50 text-[10px] whitespace-nowrap">{t('sidebar.appSubtitle')}</p>
        </div>
      </button>

      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {visibleItems.map((item) => {
          if (item.children) {
            const isGroupActive = item.children.some(c => isActive(c.path));
            const isExpanded = expandedGroups[item.groupId];
            const hasAccessibleChild = item.children.some(c => canAccessRoute(user, c.path));
            const groupLabel = t(item.labelKey);

            if (isExterno) return null;

            if (!hasAccessibleChild) {
              return (
                <div key={item.groupId} title={lockedTitle}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 cursor-not-allowed select-none"
                  style={{ opacity: 0.25 }}>
                  <item.icon className="w-4 h-4 shrink-0 text-white/50" />
                  <span className={cn(labelClass(collapsed), 'flex-1 text-white/50')}>{groupLabel}</span>
                  <Lock className={cn('w-3 h-3 shrink-0 text-white/30 transition-opacity duration-300', collapsed ? 'opacity-0 w-0' : 'opacity-100')} />
                </div>
              );
            }

            return (
              <div key={item.groupId} className="mb-0.5">
                <button onClick={() => toggleGroup(item.groupId)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isGroupActive ? 'text-white bg-white/10' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span className={cn(labelClass(collapsed), 'flex-1 text-left')}>{groupLabel}</span>
                  <ChevronDown className={cn('w-3 h-3 shrink-0 transition-opacity duration-300', collapsed || !isExpanded ? 'hidden' : 'block')} />
                  <ChevronRight className={cn('w-3 h-3 shrink-0 transition-opacity duration-300', collapsed || isExpanded ? 'hidden' : 'block')} />
                </button>
                {!collapsed && isExpanded && (
                  <div className="ml-4 pl-3 border-l border-white/10">
                    {item.children.map(child => {
                      const childAccessible = canAccessRoute(user, child.path);
                      const childLabel = t(child.labelKey);
                      if (!childAccessible) {
                        return (
                          <div key={child.path} title={lockedTitle}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs cursor-not-allowed select-none"
                            style={{ opacity: 0.25 }}>
                            <child.icon className="w-3.5 h-3.5 shrink-0 text-white/50" />
                            <span className="truncate text-white/50">{childLabel}</span>
                            <Lock className="w-2.5 h-2.5 shrink-0 text-white/30" />
                          </div>
                        );
                      }
                      return (
                        <Link key={child.path} to={child.path}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${isActive(child.path) ? 'text-white bg-white/10' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
                          <child.icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{childLabel}</span>
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
