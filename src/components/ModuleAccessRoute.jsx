import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import {
  canAccessModule,
  resolveModuleDeniedRedirect,
} from '@/lib/modules/access';
import { MODULE_IDS } from '@/lib/modules/catalog';

const DefaultFallback = () => {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-border border-t-[#2575D1] rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{t('common.loadingApp')}</p>
      </div>
    </div>
  );
};

/**
 * Gate de rota por módulo de aplicativo.
 * Painel NÃO usa este gate (permanece em AdminRoute).
 *
 * @param {{ moduleId: string, fallback?: React.ReactNode }} props
 */
export default function ModuleAccessRoute({ moduleId, fallback = <DefaultFallback /> }) {
  const { user, loading } = useInternalAuth();
  const location = useLocation();

  if (loading) return fallback;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  // Portal do cliente e tela de acesso negado vivem sob o shell da Industrialização
  if (moduleId === MODULE_IDS.INDUSTRIALIZACAO) {
    if (user.tipo === 'externo') return <Outlet />;
    if (location.pathname === '/acesso-negado' || location.pathname.startsWith('/acesso-negado/')) {
      return <Outlet />;
    }
  }

  if (!canAccessModule(user, moduleId)) {
    return <Navigate to={resolveModuleDeniedRedirect(user, moduleId)} replace />;
  }

  return <Outlet />;
}
