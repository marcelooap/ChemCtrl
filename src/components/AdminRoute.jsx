import { Navigate, Outlet } from 'react-router-dom';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { isAdminUser } from '@industrializacao/lib/permissions';
import { resolvePostLoginRoute } from '@/lib/modules/access';

/**
 * Gate para rotas restritas a administradores (Painel).
 * Não-admin → redireciona para seleção / módulo permitido.
 */
export default function AdminRoute() {
  const { user, loading } = useInternalAuth();

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdminUser(user)) {
    return <Navigate to={resolvePostLoginRoute(user)} replace />;
  }

  return <Outlet />;
}
