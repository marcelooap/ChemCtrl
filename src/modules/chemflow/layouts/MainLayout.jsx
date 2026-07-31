import AppShell from '@shared/components/layout/AppShell';
import Sidebar from '@chemflow/components/Sidebar';
import { BackToChemCtrlButton } from '@chemflow/components/user/BackToChemCtrlButton';
import {
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';

export default function MainLayout() {
  const banner = !isChemFlowConfigured ? (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="font-medium">ChemFlow sem conexão com o banco</p>
      <p className="mt-1 opacity-90">{CHEMFLOW_CONFIG_ERROR}</p>
    </div>
  ) : null;

  return (
    <AppShell
      sidebar={<Sidebar />}
      banner={banner}
      topBarProps={{
        topBarActions: <BackToChemCtrlButton />,
      }}
    />
  );
}
