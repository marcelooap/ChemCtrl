import React, { useState, useEffect } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import Sidebar from './Sidebar';
import WelcomeModal from '@industrializacao/components/WelcomeModal';
import { canAccessRoute, isReadOnly, getRoleLabel } from '@industrializacao/lib/permissions';
import AppShell from '@shared/components/layout/AppShell';
import { SystemManualMenu } from '@industrializacao/components/user/SystemManualMenu';
import { reconcileStuckEnvaseProductions } from '@industrializacao/lib/envaseCompletion';
import { createSupabaseEntities } from '@industrializacao/api/supabaseClient';

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

  useEffect(() => {
    if (!user) return;
    reconcileStuckEnvaseProductions(createSupabaseEntities());
  }, [user]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (location.pathname !== '/acesso-negado' && !canAccessRoute(user, location.pathname)) {
    return <Navigate to="/acesso-negado" replace state={{ from: location.pathname }} />;
  }

  return (
    <>
      <AppShell
        sidebar={<Sidebar />}
        topBarProps={{
          userMenuExtras: user.tipo === 'externo' ? null : <SystemManualMenu />,
          getRoleLabel,
        }}
        outletContext={{ user, isReadOnly: isReadOnly(user, location.pathname) }}
        requireAuth={false}
        contentClassName="overflow-y-auto"
      />
      {showWelcome && <WelcomeModal user={user} onClose={() => setShowWelcome(false)} />}
    </>
  );
}
