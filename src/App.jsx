import { Suspense, lazy } from 'react';
import { Toaster } from '@shared/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import ProtectedRoute from '@/components/ProtectedRoute';
import GuestRoute from '@/components/GuestRoute';
import AdminRoute from '@/components/AdminRoute';
import ModuleErrorBoundary from '@/components/ModuleErrorBoundary';
import { InternalAuthProvider, useInternalAuth } from '@/lib/InternalAuthContext';
import ScrollToTop from './components/ScrollToTop';
import { UpdateProvider } from '@/pwa/context/UpdateProvider';
import { UpdateModal } from '@/pwa/components/UpdateModal';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { TooltipProvider } from '@shared/components/ui/tooltip';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';

// Plataforma
import Login from '@/pages/Login';
import SystemSelector from '@/pages/SystemSelector';
import PlaceholderPage from '@/pages/PlaceholderPage';
import PlatformLayout from '@/layouts/PlatformLayout';

// Módulo ChemBlend (síncrono — comportamento idêntico ao app anterior)
import ChemBlendRoutes from '@chemblend/routes';
import ConsultaPublica from '@chemblend/pages/ConsultaPublica';

// Módulo ChemFlow (lazy: isola o cliente Supabase B do bootstrap da plataforma)
const ChemFlowRoutes = lazy(() => import('@chemflow/routes'));

/**
 * Paths antigos do ChemBlend (quando era o app raiz).
 * Redirecionam para o prefixo `/chemblend/*`.
 * Deep links sob `/chemblend/*` continuam válidos (F5 dentro do módulo).
 * Nota: /dashboard, /estoque e /usuarios passaram a ser rotas da plataforma ChemCtrl.
 */
const LEGACY_CHEMBLEND_PATHS = [
  '/estoque-cliente', '/tela-clientes', '/pedidos',
  '/receitas', '/nova-producao', '/ordens', '/producao/:id/checklist', '/producoes',
  '/qualidade/ensaios', '/qualidade/equipamentos', '/qualidade/producoes', '/qualidade/coa',
  '/vasilhames', '/tankagem', '/transbordo', '/inventario', '/inventario/:id',
  '/perfis', '/acesso-negado',
];

function LegacyChemblendRedirect() {
  const { pathname } = useLocation();
  return <Navigate to={`/chemblend${pathname}`} replace />;
}

function ModuleLoadingFallback() {
  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
    </div>
  );
}

/** Rotas desconhecidas: sem sessão → Login; com sessão → 404. */
function CatchAllRoute() {
  const { user, loading } = useInternalAuth();

  if (loading) {
    return <ModuleLoadingFallback />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <PageNotFound />;
}

const AuthenticatedApp = () => {
  return (
    <Routes>
      {/* Público: consulta por token (ChemBlend) */}
      <Route path="/consulta/:token" element={<ConsultaPublica />} />

      {/* Público: Login — se já autenticado, GuestRoute manda para o ChemBlend */}
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<Login />} />
      </Route>

      {/* Protegido: exige sessão válida da plataforma */}
      <Route element={<ProtectedRoute />}>
        {/* ChemCtrl — hub de módulos (admin). Não-admin em `/` é redirecionado no SystemSelector. */}
        <Route element={<PlatformLayout />}>
          <Route index element={<SystemSelector />} />
          <Route path="dashboard" element={<PlaceholderPage title="Dashboard" />} />
          <Route path="estoque" element={<PlaceholderPage title="Estoque" />} />
          <Route path="comercial/fichado" element={<PlaceholderPage title="Fichado" />} />
          <Route path="comercial/solicitar-saida" element={<PlaceholderPage title="Solicitar saída" />} />
          <Route path="comercial/composicao-carga" element={<PlaceholderPage title="Composição de carga" />} />
          <Route path="faturamento" element={<PlaceholderPage title="Faturamento" />} />
          <Route path="usuarios" element={<PlaceholderPage title="Usuários" />} />
          <Route path="usuarios/permissoes" element={<PlaceholderPage title="Controle de permissão" />} />
        </Route>

        <Route path="/apps" element={<Navigate to="/" replace />} />
        <Route path="/selecionar-modulo" element={<Navigate to="/" replace />} />

        <Route path="/chemblend/*" element={<ChemBlendRoutes />} />
        <Route element={<AdminRoute />}>
          <Route
            path="/chemflow/*"
            element={
              <ModuleErrorBoundary title="Não foi possível abrir o ChemFlow">
                <Suspense fallback={<ModuleLoadingFallback />}>
                  <ChemFlowRoutes />
                </Suspense>
              </ModuleErrorBoundary>
            }
          />
        </Route>

        {/* Bookmarks antigos → ChemBlend */}
        {LEGACY_CHEMBLEND_PATHS.map((path) => (
          <Route key={path} path={path} element={<LegacyChemblendRedirect />} />
        ))}
      </Route>

      <Route path="*" element={<CatchAllRoute />} />
    </Routes>
  );
};

function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <QueryClientProvider client={queryClientInstance}>
            <Router>
              <ScrollToTop />
              <UpdateProvider>
                <InternalAuthProvider>
                  <AuthenticatedApp />
                  <UpdateModal />
                </InternalAuthProvider>
              </UpdateProvider>
            </Router>
            <Toaster />
          </QueryClientProvider>
        </TooltipProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}

export default App;
