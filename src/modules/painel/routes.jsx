import { Route, Routes, Navigate } from 'react-router-dom';
import { PermissionProvider } from '@industrializacao/lib/rbac/PermissionProvider';
import RealtimeProvider from '@industrializacao/components/RealtimeProvider';
import AdminRoute from '@/components/AdminRoute';
import MainLayout from '@painel/layouts/MainLayout';
import Home from '@painel/pages/Home';
import Dashboard from '@painel/pages/Dashboard';
import LogisticaAgendamentos from '@painel/pages/logistica/Agendamentos';
import LogisticaCarregamentos from '@painel/pages/logistica/Carregamentos';
import ReservarMaterial from '@painel/pages/comercial/ReservarMaterial';
import SolicitacoesSaida from '@painel/pages/comercial/SolicitacoesSaida';
import SolicitacaoSaidaForm from '@painel/pages/comercial/SolicitacaoSaidaForm';
import SolicitacaoSaidaView from '@painel/pages/comercial/SolicitacaoSaidaView';
import Agendamentos from '@painel/pages/comercial/Agendamentos';
import Usuarios from '@industrializacao/pages/Usuarios';
import Permissoes from '@painel/pages/Permissoes';
import ScreenAccessRoute from '@/components/ScreenAccessRoute';

/**
 * Rotas internas do Painel, montadas em `/painel/*`.
 * Home é o hub de seleção de módulos (todos autenticados).
 * Demais áreas administrativas ficam atrás de AdminRoute.
 */
export default function PainelRoutes() {
  return (
    <PermissionProvider>
      <RealtimeProvider>
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
              path="comercial/composicao-carga"
              element={<Navigate to="/painel/comercial/agendamentos" replace />}
            />
            <Route
              path="comercial/composicao-carga/*"
              element={<Navigate to="/painel/comercial/agendamentos" replace />}
            />

            <Route element={<ScreenAccessRoute />}>
              <Route path="dashboard" element={<Dashboard />} />
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
            </Route>

            <Route element={<AdminRoute />}>
              <Route path="usuarios" element={<Usuarios />} />
              <Route path="permissoes" element={<Permissoes />} />
              <Route path="perfis" element={<Navigate to="/painel/permissoes" replace />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/painel/home" replace />} />
        </Routes>
      </RealtimeProvider>
    </PermissionProvider>
  );
}
