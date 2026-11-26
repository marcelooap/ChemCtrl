import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { PAINEL_HOME_ROUTE } from '@/lib/modules/access';
import {
  canOpenOrdemTransbordoRelatorio,
  resolveRelatorioDeniedPath,
} from '@painel/lib/ordemTransbordoRelatorioNav';

/**
 * Gate do preview de impressão da OT.
 * Aceita a tela do Painel (Operacional / Recebimento) ou a Validação
 * de origem (Transbordo / Industrialização). Sem isso, quem imprime
 * a partir da Validação caía em /painel/home.
 */
export default function OrdemTransbordoRelatorioRoute() {
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

  if (!canOpenOrdemTransbordoRelatorio(user, location)) {
    const fallback = resolveRelatorioDeniedPath(location) || PAINEL_HOME_ROUTE;
    return <Navigate to={fallback} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
