import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, BarChart3, Package, ClipboardList, BookOpen, Plus, Factory, ListOrdered,
  Shield, FlaskConical, FileCheck, Award, Box, Cylinder, ArrowRightLeft, Bell,
  Users, ChevronDown,   ChevronRight, LogOut, Building2, Warehouse, ClipboardCheck, Lock, PanelLeftClose, PanelLeft
} from 'lucide-react';
import { canAccessRoute, getRoleLabel } from '@/lib/permissions';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { getInstalledVersion } from '@/pwa/version';

const navItems = [
  { label: 'Home', icon: LayoutDashboard, path: '/' },
  { label: 'Dashboard', icon: BarChart3, path: '/dashboard' },
  { label: 'Receitas', icon: BookOpen, path: '/receitas' },
  { label: 'Pedidos', icon: ClipboardList, path: '/pedidos' },
  { label: 'Estoque de MP', icon: Package, path: '/estoque' },
  { label: 'Inventário', icon: ClipboardCheck, path: '/inventario' },
  { label: 'Nova Produção', icon: Plus, path: '/nova-producao' },
  { label: 'Produções', icon: ListOrdered, path: '/producoes' },
  { label: 'Ordens de Produção', icon: Factory, path: '/ordens' },
  {
    label: 'Controle de Qualidade', icon: Shield, path: null,
    children: [
      { label: 'Ensaios', icon: FlaskConical, path: '/qualidade/ensaios' },
      { label: 'Pendente de Análise', icon: FileCheck, path: '/qualidade/producoes' },
      { label: 'Cert. de Análise (COA)', icon: Award, path: '/qualidade/coa' },
    ]
  },
  { label: 'Vasilhames', icon: Box, path: '/vasilhames' },
  { label: 'Tankagem', icon: Cylinder, path: '/tankagem' },
  { label: 'Transbordo', icon: ArrowRightLeft, path: '/transbordo' },
  { label: 'Usuários', icon: Users, path: '/usuarios' },
  { label: 'Notificações', icon: Bell, path: '/notificacoes' },
  { label: 'Tela Clientes', icon: Building2, path: '/tela-clientes' },
  { label: 'Estoque Cliente', icon: Warehouse, path: '/estoque-cliente' },
];

export default function Sidebar({ collapsed, setCollapsed, user }) {
  const location = useLocation();
  const [expandedGroups, setExpandedGroups] = useState({});
  const { logout } = useInternalAuth();

  const toggleGroup = (label) => {
    setExpandedGroups(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const isExterno = user?.tipo === 'externo';
  const installedVersion = getInstalledVersion();

  // Externo: Tela Clientes e Notificações visíveis na sidebar
  const visibleItems = isExterno
    ? navItems.filter(i => i.path === '/tela-clientes' || i.path === '/notificacoes')
    : navItems;

  const renderItem = (item) => {
    const accessible = canAccessRoute(user, item.path);

    if (!accessible) {
      return (
        <div key={item.path} title="Sem acesso para seu nível"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 cursor-not-allowed select-none"
          style={{ opacity: 0.25 }}>
          <item.icon className="w-4 h-4 shrink-0 text-white/50" />
          {!collapsed && <span className="truncate flex-1 text-white/50">{item.label}</span>}
          {!collapsed && <Lock className="w-3 h-3 shrink-0 text-white/30" />}
        </div>
      );
    }

    return (
      <Link key={item.path} to={item.path}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${isActive(item.path) ? 'text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
        style={isActive(item.path) ? { background: '#2575D1' } : {}}>
        <item.icon className="w-4 h-4 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  return (
    <aside className={`fixed left-0 top-0 h-screen z-40 flex flex-col transition-all duration-300 ${collapsed ? 'w-16' : 'w-64'}`}
      style={{ background: 'hsl(230, 25%, 12%)' }}>
      
      {/* Logo */}
      <button onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-3 px-4 h-16 border-b border-white/10 shrink-0 hover:bg-white/5 transition-colors w-full">
        <img src="https://media.base44.com/images/public/6a3bc68b6dcf809125758419/36b0a109a_image.png"
          alt="ChemCtrl" className="w-8 h-8 rounded-lg shrink-0" />
        {!collapsed && (
          <div className="overflow-hidden text-left">
            <p className="text-white font-bold text-sm leading-tight">ChemCtrl</p>
            <p className="text-white/50 text-[10px]">Controle de Produção</p>
          </div>
        )}
      </button>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {visibleItems.map((item) => {
          if (item.children) {
            const isGroupActive = item.children.some(c => isActive(c.path));
            const isExpanded = expandedGroups[item.label];
            const hasAccessibleChild = item.children.some(c => canAccessRoute(user, c.path));

            if (isExterno) return null;

            if (!hasAccessibleChild) {
              return (
                <div key={item.label} title="Sem acesso para seu nível"
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 cursor-not-allowed select-none"
                  style={{ opacity: 0.25 }}>
                  <item.icon className="w-4 h-4 shrink-0 text-white/50" />
                  {!collapsed && <span className="truncate flex-1 text-white/50">{item.label}</span>}
                  {!collapsed && <Lock className="w-3 h-3 shrink-0 text-white/30" />}
                </div>
              );
            }

            return (
              <div key={item.label} className="mb-0.5">
                <button onClick={() => toggleGroup(item.label)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isGroupActive ? 'text-white bg-white/10' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>
                  <item.icon className="w-4 h-4 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </>
                  )}
                </button>
                {!collapsed && isExpanded && (
                  <div className="ml-4 pl-3 border-l border-white/10">
                    {item.children.map(child => {
                      const childAccessible = canAccessRoute(user, child.path);
                      if (!childAccessible) {
                        return (
                          <div key={child.path} title="Sem acesso para seu nível"
                            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs cursor-not-allowed select-none"
                            style={{ opacity: 0.25 }}>
                            <child.icon className="w-3.5 h-3.5 shrink-0 text-white/50" />
                            <span className="truncate text-white/50">{child.label}</span>
                            <Lock className="w-2.5 h-2.5 shrink-0 text-white/30" />
                          </div>
                        );
                      }
                      return (
                        <Link key={child.path} to={child.path}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${isActive(child.path) ? 'text-white bg-white/10' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
                          <child.icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{child.label}</span>
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

      {/* User & Toggle */}
      <div className="border-t border-white/10 p-3 shrink-0">
        <div className="flex items-center gap-2 mb-2 px-1">
          <button onClick={() => setCollapsed(!collapsed)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 hover:opacity-80 transition-opacity" style={{ background: '#2575D1' }}
            title={collapsed ? 'Expandir' : 'Recolher'}>
            {collapsed
              ? <PanelLeft className="w-3.5 h-3.5" />
              : (user.nome || user.full_name || 'U').charAt(0).toUpperCase()}
          </button>
          {!collapsed && user && (
            <div className="overflow-hidden flex-1">
              <p className="text-white text-xs font-medium truncate">{user.nome || user.full_name || 'Usuário'}</p>
              <p className="text-white/40 text-[10px] truncate">{getRoleLabel(user)}</p>
            </div>
          )}
          {!collapsed && <span className="text-white/30 text-[10px] shrink-0">Ver. {installedVersion}</span>}
        </div>
        {!collapsed && (
          <button onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-md text-white/50 hover:text-red-400 hover:bg-white/5 text-xs transition-colors">
            <LogOut className="w-4 h-4" />
            <span>Sair</span>
          </button>
        )}
      </div>
    </aside>
  );
}
