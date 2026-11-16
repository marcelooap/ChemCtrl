import { lazy, Suspense } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { PermissionProvider } from '@industrializacao/lib/rbac/PermissionProvider';
import MainLayout from '@transbordo/layouts/MainLayout';

const AcessoNegado = lazy(() => import('@industrializacao/pages/AcessoNegado'));
const Home = lazy(() => import('@transbordo/pages/Home'));
const Dashboard = lazy(() => import('@transbordo/pages/Dashboard'));
const Entrada = lazy(() => import('@transbordo/pages/Entrada'));
const Transbordo = lazy(() => import('@transbordo/pages/Transbordo'));
const Validacao = lazy(() => import('@transbordo/pages/Validacao'));
const Cadastro = lazy(() => import('@transbordo/pages/Cadastro'));
const Vasilhames = lazy(() => import('@transbordo/pages/Vasilhames'));
const Tankagem = lazy(() => import('@transbordo/pages/Tankagem'));
const Saida = lazy(() => import('@transbordo/pages/Saida'));
const SaidaForm = lazy(() => import('@transbordo/pages/SaidaForm'));
const SaidaView = lazy(() => import('@transbordo/pages/SaidaView'));
const Estoque = lazy(() => import('@transbordo/pages/Estoque'));
const EstoqueEnvio = lazy(() => import('@transbordo/pages/EstoqueEnvio'));
const Filtracao = lazy(() => import('@transbordo/pages/Filtracao'));

function PageFallback() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="h-7 w-7 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" />
    </div>
  );
}

/**
 * Rotas internas do ChemFlow, montadas em `/chemflow/*`.
 * Paths relativos (sem `/` inicial) e `index` para a Home — padrão correto
 * de descendant routes do React Router 6.
 * Páginas em lazy para reduzir o custo do primeiro open do módulo.
 */
export default function ChemFlowRoutes() {
  return (
    <PermissionProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="acesso-negado" element={<AcessoNegado />} />
            <Route index element={<Home />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="cadastro" element={<Cadastro />} />
            <Route path="entrada" element={<Entrada />} />
            <Route path="saida" element={<Saida />} />
            <Route path="saida/novo" element={<SaidaForm />} />
            <Route path="saida/editar/:id" element={<SaidaForm />} />
            <Route path="saida/visualizar/:id" element={<SaidaView />} />
            <Route path="transbordo" element={<Transbordo />} />
            <Route path="validacao" element={<Validacao />} />
            <Route path="vasilhames" element={<Vasilhames />} />
            <Route path="filtracao" element={<Filtracao />} />
            <Route path="estoque" element={<Estoque />} />
            <Route path="estoque-envio" element={<EstoqueEnvio />} />
            <Route path="tankagem" element={<Tankagem />} />
          </Route>
          <Route path="*" element={<Navigate to="/chemflow" replace />} />
        </Routes>
      </Suspense>
    </PermissionProvider>
  );
}
