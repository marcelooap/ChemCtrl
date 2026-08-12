import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { canAccessRoute } from '@industrializacao/lib/permissions';
import { PAINEL_HOME_ROUTE } from '@/lib/modules/access';

/**
 * Gate de rota por permissão de tela (resource.view).
 * Usado no Painel para Dashboard / Comercial / Logística.
 */
export default function ScreenAccessRoute({ fallbackPath = PAINEL_HOME_ROUTE }) {
  const { user, loading } = useInternalAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!canAccessRoute(user, location.pathname)) {
    return <Navigate to={fallbackPath} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
