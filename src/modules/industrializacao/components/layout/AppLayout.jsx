import React, { useEffect } from 'react';
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
          sidebar={<Sidebar />}
          topBarProps={{
            userMenuExtras: user.tipo === 'externo' ? null : <SystemManualMenu />,
            getRoleLabel,
          }}
          outletContext={{ user, isReadOnly: isReadOnly(user, location.pathname) }}
          requireAuth={false}
          contentClassName="overflow-y-auto"
        />
      </ValidacaoNovasProvider>
    </SaidaNovasProvider>
  );
}
