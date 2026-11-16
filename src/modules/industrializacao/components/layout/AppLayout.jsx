import React, { useEffect, useMemo } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import Sidebar from './Sidebar';
import { canAccessRoute, isReadOnly, getRoleLabel } from '@industrializacao/lib/permissions';
import AppShell from '@shared/components/layout/AppShell';
import { SystemManualMenu } from '@industrializacao/components/user/SystemManualMenu';
import { reconcileStuckEnvaseProductions } from '@industrializacao/lib/envaseCompletion';
import { createSupabaseEntities } from '@industrializacao/api/supabaseClient';
import { SaidaNovasProvider } from '@transbordo/context/SaidaNovasContext';
import { ValidacaoNovasProvider } from '@transbordo/context/ValidacaoNovasContext';

export default function AppLayout() {
  const { user } = useInternalAuth();
  const location = useLocation();
  useEffect(() => {
    if (!user) return;
    reconcileStuckEnvaseProductions(createSupabaseEntities());
  }, [user]);

  const readOnly = user ? isReadOnly(user, location.pathname) : false;
  const outletContext = useMemo(
    () => ({ user, isReadOnly: readOnly }),
    [user, readOnly]
  );
  const topBarProps = useMemo(
    () => ({
      userMenuExtras: user?.tipo === 'externo' ? null : <SystemManualMenu />,
      getRoleLabel,
    }),
    [user?.tipo]
  );

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (location.pathname !== '/acesso-negado' && !canAccessRoute(user, location.pathname)) {
    return <Navigate to="/acesso-negado" replace state={{ from: location.pathname }} />;
  }

  return (
    <SaidaNovasProvider onlyIndustrializacao>
      <ValidacaoNovasProvider onlyIndustrializacao>
        <AppShell
          sidebar={({ collapsed, setCollapsed }) => (
            <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} user={user} />
          )}
          topBarProps={topBarProps}
          outletContext={outletContext}
          requireAuth={false}
          contentClassName="overflow-y-auto"
        />
      </ValidacaoNovasProvider>
    </SaidaNovasProvider>
  );
}
