import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PermissionProvider } from '@industrializacao/lib/rbac/PermissionProvider';
import RealtimeProvider from '@industrializacao/components/RealtimeProvider';
import AppLayout from '@industrializacao/components/layout/AppLayout';

const Home = lazy(() => import('@industrializacao/pages/Home'));
const Dashboard = lazy(() => import('@industrializacao/pages/Dashboard'));
const EstoqueCliente = lazy(() => import('@industrializacao/pages/EstoqueCliente'));
const TelaClientes = lazy(() => import('@industrializacao/pages/TelaClientes'));
const ClienteEntradas = lazy(() => import('@industrializacao/pages/ClienteEntradas'));
const ClienteFiltracao = lazy(() => import('@industrializacao/pages/ClienteFiltracao'));
const Estoque = lazy(() => import('@industrializacao/pages/Estoque'));
const Pedidos = lazy(() => import('@industrializacao/pages/Pedidos'));
const Programacao = lazy(() => import('@industrializacao/pages/Programacao'));
const Receitas = lazy(() => import('@industrializacao/pages/Receitas'));
const NovaProducao = lazy(() => import('@industrializacao/pages/NovaProducao'));
const OrdensProducao = lazy(() => import('@industrializacao/pages/OrdensProducao'));
const ChecklistProducao = lazy(() => import('@industrializacao/pages/ChecklistProducao'));
const Producoes = lazy(() => import('@industrializacao/pages/Producoes'));
const Ensaios = lazy(() => import('@industrializacao/pages/qualidade/Ensaios'));
const ListaEnsaios = lazy(() => import('@industrializacao/pages/qualidade/ListaEnsaios'));
const ProducoesCQ = lazy(() => import('@industrializacao/pages/qualidade/ProducoesCQ'));
const COA = lazy(() => import('@industrializacao/pages/qualidade/COA'));
const EquipamentosLab = lazy(() => import('@industrializacao/pages/qualidade/EquipamentosLab'));
const Vasilhames = lazy(() => import('@industrializacao/pages/Vasilhames'));
const IndSaida = lazy(() => import('@industrializacao/pages/Saida'));
const IndSaidaForm = lazy(() => import('@industrializacao/pages/SaidaForm'));
const IndSaidaView = lazy(() => import('@industrializacao/pages/SaidaView'));
const Tankagem = lazy(() => import('@industrializacao/pages/Tankagem'));
const Transbordo = lazy(() => import('@industrializacao/pages/Transbordo'));
const Inventario = lazy(() => import('@industrializacao/pages/Inventario'));
const InventarioConferencia = lazy(() => import('@industrializacao/pages/InventarioConferencia'));
const Validacao = lazy(() => import('@industrializacao/pages/Validacao'));
const AcessoNegado = lazy(() => import('@industrializacao/pages/AcessoNegado'));

function PageFallback() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="h-7 w-7 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" />
    </div>
  );
}

/**
 * Rotas principais do ChemCtrl, montadas na raiz `/*`.
 * Paths relativos (sem `/` inicial) — padrão de descendant routes do RR6.
 * Páginas em lazy para reduzir o custo do primeiro open do módulo.
 */
export default function ChemCtrlRoutes() {
  return (
    <PermissionProvider>
      <RealtimeProvider>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="usuarios" element={<Navigate to="/painel/usuarios" replace />} />
            <Route path="perfis" element={<Navigate to="/painel/permissoes" replace />} />
            <Route element={<AppLayout />}>
              <Route index element={<Home />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="estoque-cliente" element={<EstoqueCliente />} />
              <Route path="tela-clientes" element={<TelaClientes />} />
              <Route path="clientes/entradas" element={<ClienteEntradas />} />
              <Route path="clientes/filtracao" element={<ClienteFiltracao />} />
              <Route path="estoque" element={<Estoque />} />
              <Route path="validacao" element={<Validacao />} />
              <Route path="pedidos" element={<Pedidos />} />
              <Route path="programacao" element={<Programacao />} />
              <Route path="receitas" element={<Receitas />} />
              <Route path="nova-producao" element={<NovaProducao />} />
              <Route path="ordens" element={<OrdensProducao />} />
              <Route path="producao/:id/checklist" element={<ChecklistProducao />} />
              <Route path="producoes" element={<Producoes />} />
              <Route path="qualidade/ensaios" element={<Ensaios />} />
              <Route path="qualidade/lista-ensaios" element={<ListaEnsaios />} />
              <Route path="qualidade/equipamentos" element={<EquipamentosLab />} />
              <Route path="qualidade/producoes" element={<ProducoesCQ />} />
              <Route path="qualidade/coa" element={<COA />} />
              <Route path="vasilhames" element={<Vasilhames />} />
              <Route path="saida" element={<IndSaida />} />
              <Route path="saida/novo" element={<IndSaidaForm />} />
              <Route path="saida/editar/:id" element={<IndSaidaForm />} />
              <Route path="saida/visualizar/:id" element={<IndSaidaView />} />
              <Route path="tankagem" element={<Tankagem />} />
              <Route path="transbordo" element={<Transbordo />} />
              <Route path="inventario" element={<Inventario />} />
              <Route path="inventario/:id" element={<InventarioConferencia />} />
              <Route path="acesso-negado" element={<AcessoNegado />} />
            </Route>
          </Routes>
        </Suspense>
      </RealtimeProvider>
    </PermissionProvider>
  );
}
