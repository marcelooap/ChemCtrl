import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { getDefaultRoute } from '@industrializacao/lib/permissions';

const DefaultFallback = () => {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-border border-t-[#2575D1] rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-sm text-muted-foreground">{t('common.loadingApp')}</p>
      </div>
    </div>
  );
};

/**
 * Gate de rotas públicas (ex.: Login).
 * Se já houver sessão válida, redireciona para a rota padrão do ChemCtrl.
 */
export default function GuestRoute({ fallback = <DefaultFallback /> }) {
  const { user, loading } = useInternalAuth();

  if (loading) {
    return fallback;
  }

  if (user) {
    return <Navigate to={getDefaultRoute(user)} replace />;
  }

  return <Outlet />;
}
