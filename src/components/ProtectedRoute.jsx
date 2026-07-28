import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useInternalAuth } from '@/lib/InternalAuthContext';

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
 * Gate de rotas autenticadas da plataforma.
 * Sem sessão válida → Login. Com sessão → renderiza as rotas filhas (Outlet).
 */
export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement }) {
  const { user, loading } = useInternalAuth();
  const location = useLocation();

  if (loading) {
    return fallback;
  }

  if (!user) {
    return (
      unauthenticatedElement ?? (
        <Navigate to="/login" replace state={{ from: location.pathname }} />
      )
    );
  }

  return <Outlet />;
}
