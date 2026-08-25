import { Navigate, useLocation } from 'react-router-dom';
import AppShell from '@shared/components/layout/AppShell';
import Sidebar from '@transbordo/components/Sidebar';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { canAccessRoute } from '@industrializacao/lib/permissions';
import {
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';
import { SaidaNovasProvider } from '@transbordo/context/SaidaNovasContext';
import { ValidacaoNovasProvider } from '@transbordo/context/ValidacaoNovasContext';

export default function MainLayout() {
  const { user } = useInternalAuth();
  const location = useLocation();

  if (user && !canAccessRoute(user, location.pathname)) {
    return <Navigate to="/chemflow/acesso-negado" replace state={{ from: location.pathname }} />;
  }

  const banner = !isChemFlowConfigured ? (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="font-medium">Transbordo sem conexão com o banco</p>
      <p className="mt-1 opacity-90">{CHEMFLOW_CONFIG_ERROR}</p>
    </div>
  ) : null;

  return (
    <SaidaNovasProvider>
      <ValidacaoNovasProvider>
        <AppShell
          sidebar={({ collapsed, setCollapsed }) => (
            <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
          )}
          banner={banner}
          contentClassName="overflow-hidden"
          topBarProps={{}}
        />
      </ValidacaoNovasProvider>
    </SaidaNovasProvider>
  );
}
