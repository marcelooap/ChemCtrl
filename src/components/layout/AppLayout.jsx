import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import Sidebar from './Sidebar';
import { AppTopBar } from './AppTopBar';
import WelcomeModal from '@/components/WelcomeModal';
import { canAccessRoute, isReadOnly } from '@/lib/permissions';

export default function AppLayout() {
  const { user } = useInternalAuth();
  const [collapsed, setCollapsed] = useState(true);
  const location = useLocation();
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (user && sessionStorage.getItem('chemctrl_welcome') === '1') {
      sessionStorage.removeItem('chemctrl_welcome');
      setShowWelcome(true);
    }
  }, [user]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (location.pathname !== '/acesso-negado' && !canAccessRoute(user, location.pathname)) {
    return <Navigate to="/acesso-negado" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="h-screen overflow-hidden bg-background">
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} user={user} />
      <main className={`flex flex-col h-screen min-h-0 transition-all duration-300 ${collapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="flex flex-col flex-1 min-h-0 p-4 sm:p-6 w-full overflow-hidden">
          <AppTopBar />
          <div className="flex-1 min-h-0 overflow-hidden">
            <Outlet context={{ user, isReadOnly: isReadOnly(user, location.pathname) }} />
          </div>
        </div>
      </main>
      {showWelcome && <WelcomeModal user={user} onClose={() => setShowWelcome(false)} />}
    </div>
  );
}
