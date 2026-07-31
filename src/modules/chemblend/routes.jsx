import { Route, Routes } from 'react-router-dom';
import { PermissionProvider } from '@chemblend/lib/rbac/PermissionProvider';
import RealtimeProvider from '@chemblend/components/RealtimeProvider';
import AppLayout from '@chemblend/components/layout/AppLayout';

import Home from '@chemblend/pages/Home';
import Dashboard from '@chemblend/pages/Dashboard';
import EstoqueCliente from '@chemblend/pages/EstoqueCliente';
import TelaClientes from '@chemblend/pages/TelaClientes';
import Estoque from '@chemblend/pages/Estoque';
import Pedidos from '@chemblend/pages/Pedidos';
import Receitas from '@chemblend/pages/Receitas';
import NovaProducao from '@chemblend/pages/NovaProducao';
import OrdensProducao from '@chemblend/pages/OrdensProducao';
import ChecklistProducao from '@chemblend/pages/ChecklistProducao';
import Producoes from '@chemblend/pages/Producoes';
import Ensaios from '@chemblend/pages/qualidade/Ensaios';
import ProducoesCQ from '@chemblend/pages/qualidade/ProducoesCQ';
import COA from '@chemblend/pages/qualidade/COA';
import EquipamentosLab from '@chemblend/pages/qualidade/EquipamentosLab';
import Vasilhames from '@chemblend/pages/Vasilhames';
import Tankagem from '@chemblend/pages/Tankagem';
import Transbordo from '@chemblend/pages/Transbordo';
import Inventario from '@chemblend/pages/Inventario';
import InventarioConferencia from '@chemblend/pages/InventarioConferencia';
import Usuarios from '@chemblend/pages/Usuarios';
import Perfis from '@chemblend/pages/Perfis';
import AcessoNegado from '@chemblend/pages/AcessoNegado';

/**
 * Rotas principais do ChemCtrl, montadas na raiz `/*`.
 * Paths relativos (sem `/` inicial) — padrão de descendant routes do RR6.
 * O módulo ChemFlow vive em `/chemflow/*` (admin).
 */
export default function ChemCtrlRoutes() {
  return (
    <PermissionProvider>
      <RealtimeProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Home />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="estoque-cliente" element={<EstoqueCliente />} />
            <Route path="tela-clientes" element={<TelaClientes />} />
            <Route path="estoque" element={<Estoque />} />
            <Route path="pedidos" element={<Pedidos />} />
            <Route path="receitas" element={<Receitas />} />
            <Route path="nova-producao" element={<NovaProducao />} />
            <Route path="ordens" element={<OrdensProducao />} />
            <Route path="producao/:id/checklist" element={<ChecklistProducao />} />
            <Route path="producoes" element={<Producoes />} />
            <Route path="qualidade/ensaios" element={<Ensaios />} />
            <Route path="qualidade/equipamentos" element={<EquipamentosLab />} />
            <Route path="qualidade/producoes" element={<ProducoesCQ />} />
            <Route path="qualidade/coa" element={<COA />} />
            <Route path="vasilhames" element={<Vasilhames />} />
            <Route path="tankagem" element={<Tankagem />} />
            <Route path="transbordo" element={<Transbordo />} />
            <Route path="inventario" element={<Inventario />} />
            <Route path="inventario/:id" element={<InventarioConferencia />} />
            <Route path="usuarios" element={<Usuarios />} />
            <Route path="perfis" element={<Perfis />} />
            <Route path="acesso-negado" element={<AcessoNegado />} />
          </Route>
        </Routes>
      </RealtimeProvider>
    </PermissionProvider>
  );
}
