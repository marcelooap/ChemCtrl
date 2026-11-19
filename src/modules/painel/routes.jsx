import { lazy } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { PermissionProvider } from '@industrializacao/lib/rbac/PermissionProvider';
import AdminRoute from '@/components/AdminRoute';
import MainLayout from '@painel/layouts/MainLayout';
import ScreenAccessRoute from '@/components/ScreenAccessRoute';
import PageSuspense from '@shared/components/layout/PageSuspense';

const Home = lazy(() => import('@painel/pages/Home'));
const Configuracao = lazy(() => import('@painel/pages/configuracao/Configuracao'));
const Operadores = lazy(() => import('@painel/pages/configuracao/Operadores'));
const Etiquetas = lazy(() => import('@painel/pages/configuracao/Etiquetas'));
const ChecklistExpedicao = lazy(() => import('@painel/pages/configuracao/ChecklistExpedicao'));
const DestinoCarregamentos = lazy(() => import('@painel/pages/configuracao/DestinoCarregamentos'));
const JustificativasAtraso = lazy(() => import('@painel/pages/configuracao/JustificativasAtraso'));
const Dashboard = lazy(() => import('@painel/pages/Dashboard'));
const Faturamento = lazy(() => import('@painel/pages/Faturamento'));
const FaturamentoVasilhames = lazy(() => import('@painel/pages/FaturamentoVasilhames'));
const LogisticaAgendamentos = lazy(() => import('@painel/pages/logistica/Agendamentos'));
const LogisticaCarregamentos = lazy(() => import('@painel/pages/logistica/Carregamentos'));
const LogisticaRecebimento = lazy(() => import('@painel/pages/logistica/Recebimento'));
const OrdemTransbordo = lazy(() => import('@painel/pages/operacional/OrdemTransbordo'));
const OrdemTransbordoRelatorio = lazy(() => import('@painel/pages/operacional/OrdemTransbordoRelatorio'));
const QuitacaoOT = lazy(() => import('@painel/pages/operacional/QuitacaoOT'));
const OperacionalEstoque = lazy(() => import('@painel/pages/operacional/Estoque'));
const ReservarMaterial = lazy(() => import('@painel/pages/comercial/ReservarMaterial'));
const SolicitacoesSaida = lazy(() => import('@painel/pages/comercial/SolicitacoesSaida'));
const SolicitacaoSaidaForm = lazy(() => import('@painel/pages/comercial/SolicitacaoSaidaForm'));
const SolicitacaoSaidaView = lazy(() => import('@painel/pages/comercial/SolicitacaoSaidaView'));
const Agendamentos = lazy(() => import('@painel/pages/comercial/Agendamentos'));
const Usuarios = lazy(() => import('@industrializacao/pages/Usuarios'));
const Permissoes = lazy(() => import('@painel/pages/Permissoes'));

/**
 * Rotas internas do Painel, montadas em `/painel/*`.
 * Sem RealtimeProvider da Industrialização (evita assinar tabelas Ind no hub).
 * Páginas em lazy; Suspense fica no AppShell (mantém sidebar/topbar sem piscar).
 */
export default function PainelRoutes() {
  return (
    <PermissionProvider>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<Home />} />
          <Route
            path="comercial"
            element={<Navigate to="/painel/comercial/reservar-material" replace />}
          />
          <Route
            path="logistica"
            element={<Navigate to="/painel/logistica/agendamentos" replace />}
          />
          <Route
            path="operacional"
            element={<Navigate to="/painel/operacional/ordem-transbordo" replace />}
          />
          <Route
            path="comercial/composicao-carga"
            element={<Navigate to="/painel/comercial/agendamentos" replace />}
          />
          <Route
            path="comercial/composicao-carga/*"
            element={<Navigate to="/painel/comercial/agendamentos" replace />}
          />

          <Route element={<ScreenAccessRoute />}>
            <Route path="dashboard" element={<Dashboard />} />
            <Route
              path="faturamento"
              element={<Navigate to="/painel/faturamento/embalados" replace />}
            />
            <Route path="faturamento/embalados" element={<Faturamento />} />
            <Route path="faturamento/vasilhames" element={<FaturamentoVasilhames />} />
            <Route path="configuracao" element={<Configuracao />} />
            <Route path="configuracao/operadores" element={<Operadores />} />
            <Route path="configuracao/etiquetas" element={<Etiquetas />} />
            <Route path="configuracao/checklist-expedicao" element={<ChecklistExpedicao />} />
            <Route path="configuracao/destino-carregamentos" element={<DestinoCarregamentos />} />
            <Route path="configuracao/justificativas-atraso" element={<JustificativasAtraso />} />
            <Route path="comercial/reservar-material" element={<ReservarMaterial />} />
            <Route path="comercial/solicitacoes-saida" element={<SolicitacoesSaida />} />
            <Route
              path="comercial/solicitacoes-saida/novo"
              element={<SolicitacaoSaidaForm />}
            />
            <Route
              path="comercial/solicitacoes-saida/editar/:id"
              element={<SolicitacaoSaidaForm />}
            />
            <Route
              path="comercial/solicitacoes-saida/visualizar/:id"
              element={<SolicitacaoSaidaView />}
            />
            <Route path="comercial/agendamentos" element={<Agendamentos />} />
            <Route path="logistica/agendamentos" element={<LogisticaAgendamentos />} />
            <Route path="logistica/carregamentos" element={<LogisticaCarregamentos />} />
            <Route path="logistica/recebimento" element={<LogisticaRecebimento />} />
            <Route path="operacional/ordem-transbordo" element={<OrdemTransbordo />} />
            <Route path="operacional/estoque" element={<OperacionalEstoque />} />
            <Route
              path="operacional/quitacao-ot"
              element={<Navigate to="/painel/quitacao-ot" replace />}
            />
            <Route path="quitacao-ot" element={<QuitacaoOT />} />
          </Route>

          <Route element={<AdminRoute />}>
            <Route path="usuarios" element={<Usuarios />} />
            <Route path="permissoes" element={<Permissoes />} />
            <Route path="perfis" element={<Navigate to="/painel/permissoes" replace />} />
          </Route>
        </Route>

        <Route element={<ScreenAccessRoute />}>
          <Route
            path="operacional/ordem-transbordo/relatorio/:destino/:id"
            element={
              <PageSuspense>
                <OrdemTransbordoRelatorio />
              </PageSuspense>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/painel/home" replace />} />
      </Routes>
    </PermissionProvider>
  );
}
