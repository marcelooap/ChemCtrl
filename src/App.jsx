import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import ProtectedRoute from '@/components/ProtectedRoute';
import { InternalAuthProvider } from '@/lib/InternalAuthContext';
import { PermissionProvider } from '@/lib/rbac/PermissionProvider';
import ScrollToTop from './components/ScrollToTop';
import RealtimeProvider from '@/components/RealtimeProvider';
import { UpdateProvider } from '@/pwa/context/UpdateProvider';
import { UpdateModal } from '@/pwa/components/UpdateModal';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';

// Auth pages
import Login from '@/pages/Login';

// Layout
import AppLayout from '@/components/layout/AppLayout';

// Pages
import Home from '@/pages/Home';
import Dashboard from '@/pages/Dashboard';
import EstoqueCliente from '@/pages/EstoqueCliente';
import TelaClientes from '@/pages/TelaClientes';
import Estoque from '@/pages/Estoque';
import Pedidos from '@/pages/Pedidos';
import Receitas from '@/pages/Receitas';
import NovaProducao from '@/pages/NovaProducao';
import OrdensProducao from '@/pages/OrdensProducao';
import ChecklistProducao from '@/pages/ChecklistProducao';
import Producoes from '@/pages/Producoes';
import Ensaios from '@/pages/qualidade/Ensaios';
import ProducoesCQ from '@/pages/qualidade/ProducoesCQ';
import COA from '@/pages/qualidade/COA';
import EquipamentosLab from '@/pages/qualidade/EquipamentosLab';
import Vasilhames from '@/pages/Vasilhames';
import Tankagem from '@/pages/Tankagem';
import Transbordo from '@/pages/Transbordo';
import Inventario from '@/pages/Inventario';
import InventarioConferencia from '@/pages/InventarioConferencia';
import Usuarios from '@/pages/Usuarios';
import Perfis from '@/pages/Perfis';
import AcessoNegado from '@/pages/AcessoNegado';
import ConsultaPublica from '@/pages/ConsultaPublica';

const AuthenticatedApp = () => {
  return (
    <Routes>
      <Route path="/consulta/:token" element={<ConsultaPublica />} />
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/estoque-cliente" element={<EstoqueCliente />} />
          <Route path="/tela-clientes" element={<TelaClientes />} />
          <Route path="/estoque" element={<Estoque />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/receitas" element={<Receitas />} />
          <Route path="/nova-producao" element={<NovaProducao />} />
          <Route path="/ordens" element={<OrdensProducao />} />
          <Route path="/producao/:id/checklist" element={<ChecklistProducao />} />
          <Route path="/producoes" element={<Producoes />} />
          <Route path="/qualidade/ensaios" element={<Ensaios />} />
          <Route path="/qualidade/equipamentos" element={<EquipamentosLab />} />
          <Route path="/qualidade/producoes" element={<ProducoesCQ />} />
          <Route path="/qualidade/coa" element={<COA />} />
          <Route path="/vasilhames" element={<Vasilhames />} />
          <Route path="/tankagem" element={<Tankagem />} />
          <Route path="/transbordo" element={<Transbordo />} />
          <Route path="/inventario" element={<Inventario />} />
          <Route path="/inventario/:id" element={<InventarioConferencia />} />
          <Route path="/usuarios" element={<Usuarios />} />
          <Route path="/perfis" element={<Perfis />} />
          <Route path="/acesso-negado" element={<AcessoNegado />} />
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
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
                  <PermissionProvider>
                    <RealtimeProvider>
                      <AuthenticatedApp />
                    </RealtimeProvider>
                  </PermissionProvider>
                </InternalAuthProvider>
                <UpdateModal />
              </UpdateProvider>
            </Router>
            <Toaster />
          </QueryClientProvider>
        </TooltipProvider>
      </ThemeProvider>
    </I18nextProvider>
  )
}

export default App
