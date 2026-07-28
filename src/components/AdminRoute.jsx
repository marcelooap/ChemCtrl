import { Navigate, Outlet } from 'react-router-dom';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { isAdminUser } from '@chemblend/lib/permissions';

/**
 * Gate para rotas restritas a administradores (ex.: ChemFlow em desenvolvimento).
 * Não-admin → redireciona ao hub de módulos.
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
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
