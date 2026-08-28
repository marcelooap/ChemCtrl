import React, { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { AppTopBar } from '@shared/components/layout/AppTopBar';

/**
 * Shared application chrome: fixed sidebar + topbar + scrollable main.
 * Modules pass their own Sidebar element; page content comes from <Outlet />.
 * Auto-recolhimento da sidebar (3s apos o mouse sair) fica em ModuleSidebar.
 */
export default function AppShell({
  sidebar,
  topBarProps,
  banner = null,
  outletContext,
  requireAuth = true,
  /** Tailwind overflow class for the page content area. */
  contentClassName = 'overflow-y-auto',
}) {
  const { user } = useInternalAuth();
  const [collapsed, setCollapsed] = useState(true);

  if (requireAuth && !user) {
    return <Navigate to="/login" replace />;
  }

  const sidebarProps = {
    collapsed,
    setCollapsed,
    user,
  };

  const sidebarNode =
    typeof sidebar === 'function'
      ? sidebar(sidebarProps)
      : React.isValidElement(sidebar)
        ? React.cloneElement(sidebar, sidebarProps)
        : null;

  return (
    <div className="h-screen overflow-hidden bg-background">
      {sidebarNode}
      <main
        className={`flex flex-col h-screen min-h-0 transition-[margin-left] duration-200 ease-out ${
          collapsed ? 'ml-16' : 'ml-64'
        }`}
      >
        <div className="flex flex-col flex-1 min-h-0 p-4 sm:p-6 w-full overflow-hidden">
          <AppTopBar {...(topBarProps || {})} />
          {banner}
          <div className={`flex-1 min-h-0 ${contentClassName}`}>
            <Outlet context={outletContext ?? { user }} />
          </div>
        </div>
      </main>
    </div>
  );
}