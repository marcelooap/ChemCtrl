import { Route, Routes, Navigate } from 'react-router-dom';
import { PermissionProvider } from '@industrializacao/lib/rbac/PermissionProvider';
import RealtimeProvider from '@industrializacao/components/RealtimeProvider';
import AdminRoute from '@/components/AdminRoute';
import MainLayout from '@painel/layouts/MainLayout';
import Home from '@painel/pages/Home';
import Dashboard from '@painel/pages/Dashboard';
import Logistica from '@painel/pages/Logistica';
import ReservarMaterial from '@painel/pages/comercial/ReservarMaterial';
import SolicitacoesSaida from '@painel/pages/comercial/SolicitacoesSaida';
import SolicitacaoSaidaForm from '@painel/pages/comercial/SolicitacaoSaidaForm';
import SolicitacaoSaidaView from '@painel/pages/comercial/SolicitacaoSaidaView';
import ComposicaoCarga from '@painel/pages/comercial/ComposicaoCarga';
import Agendamentos from '@painel/pages/comercial/Agendamentos';
import Usuarios from '@industrializacao/pages/Usuarios';
import Perfis from '@industrializacao/pages/Perfis';

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

            <Route element={<AdminRoute />}>
              <Route path="dashboard" element={<Dashboard />} />
              <Route
                path="comercial"
                element={<Navigate to="/painel/comercial/reservar-material" replace />}
              />
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
              <Route path="comercial/composicao-carga" element={<ComposicaoCarga />} />
              <Route path="comercial/agendamentos" element={<Agendamentos />} />
              <Route path="logistica" element={<Logistica />} />
              <Route path="usuarios" element={<Usuarios />} />
              <Route path="perfis" element={<Perfis />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/painel/home" replace />} />
        </Routes>
      </RealtimeProvider>
    </PermissionProvider>
  );
}
