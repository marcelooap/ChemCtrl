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
import PlaceholderPage from '@/pages/PlaceholderPage';
import PlatformLayout from '@/layouts/PlatformLayout';

// ChemCtrl — app principal (industrialização)
import ChemCtrlRoutes from '@industrializacao/routes';
import ConsultaPublica from '@industrializacao/pages/ConsultaPublica';

// Módulo ChemFlow (lazy; apenas administradores)
const ChemFlowRoutes = lazy(() => import('@chemflow/routes'));

/** Bookmarks antigos `/chemblend/*` → rotas do ChemCtrl na raiz. */
function LegacyChemblendPrefixRedirect() {
  const { pathname, search, hash } = useLocation();
  const stripped = pathname.replace(/^\/chemblend/, '') || '/';
  const next = stripped.startsWith('/') ? stripped : `/${stripped}`;
  return <Navigate to={`${next}${search}${hash}`} replace />;
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
      {/* Público: consulta por token */}
      <Route path="/consulta/:token" element={<ConsultaPublica />} />

      {/* Público: Login — se já autenticado, vai para a rota padrão do ChemCtrl */}
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<Login />} />
      </Route>

      {/* Protegido: exige sessão válida */}
      <Route element={<ProtectedRoute />}>
        {/* Módulo ChemFlow — somente admin */}
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

        <Route path="/apps" element={<Navigate to="/chemflow" replace />} />
        <Route path="/selecionar-modulo" element={<Navigate to="/chemflow" replace />} />
        <Route path="/chemblend/*" element={<LegacyChemblendPrefixRedirect />} />

        {/* Placeholders da plataforma (sem conflito com o app principal) */}
        <Route element={<PlatformLayout />}>
          <Route path="comercial/fichado" element={<PlaceholderPage title="Fichado" />} />
          <Route path="comercial/solicitar-saida" element={<PlaceholderPage title="Solicitar saída" />} />
          <Route path="comercial/composicao-carga" element={<PlaceholderPage title="Composição de carga" />} />
          <Route path="faturamento" element={<PlaceholderPage title="Faturamento" />} />
          <Route path="usuarios/permissoes" element={<PlaceholderPage title="Controle de permissão" />} />
        </Route>

        {/* ChemCtrl — app principal na raiz */}
        <Route path="/*" element={<ChemCtrlRoutes />} />
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
