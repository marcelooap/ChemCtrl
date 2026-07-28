import React, { useState, useEffect } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import Sidebar from './Sidebar';
import WelcomeModal from '@chemblend/components/WelcomeModal';
import { canAccessRoute, isReadOnly, getRoleLabel } from '@chemblend/lib/permissions';
import AppShell from '@shared/components/layout/AppShell';
import { SystemManualMenu } from '@chemblend/components/user/SystemManualMenu';

export default function AppLayout() {
  const { user } = useInternalAuth();
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

  if (location.pathname !== '/chemblend/acesso-negado' && !canAccessRoute(user, location.pathname)) {
    return <Navigate to="/chemblend/acesso-negado" replace state={{ from: location.pathname }} />;
  }

  return (
    <>
      <AppShell
        sidebar={<Sidebar />}
        topBarProps={{
          userMenuExtras: <SystemManualMenu />,
          getRoleLabel,
        }}
        outletContext={{ user, isReadOnly: isReadOnly(user, location.pathname) }}
        requireAuth={false}
        contentClassName="overflow-hidden"
      />
      {showWelcome && <WelcomeModal user={user} onClose={() => setShowWelcome(false)} />}
    </>
  );
}
