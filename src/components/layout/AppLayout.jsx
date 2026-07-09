import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import Sidebar from './Sidebar';
import { AppTopBar } from './AppTopBar';
import WelcomeModal from '@/components/WelcomeModal';
import { canAccessRoute, getDefaultRoute, isReadOnly } from '@/lib/permissions';

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

  if (!canAccessRoute(user, location.pathname)) {
    return <Navigate to={getDefaultRoute(user)} replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} user={user} />
      <main className={`transition-all duration-300 ${collapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="p-4 sm:p-6 w-full">
          <AppTopBar />
          <Outlet context={{ user, isReadOnly: isReadOnly(user, location.pathname) }} />
        </div>
      </main>
      {showWelcome && <WelcomeModal user={user} onClose={() => setShowWelcome(false)} />}
    </div>
  );
}
