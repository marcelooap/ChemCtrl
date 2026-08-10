import { Route, Routes } from 'react-router-dom';
import { PermissionProvider } from '@industrializacao/lib/rbac/PermissionProvider';
import RealtimeProvider from '@industrializacao/components/RealtimeProvider';
import AppLayout from '@industrializacao/components/layout/AppLayout';

import Home from '@industrializacao/pages/Home';
import Dashboard from '@industrializacao/pages/Dashboard';
import EstoqueCliente from '@industrializacao/pages/EstoqueCliente';
import TelaClientes from '@industrializacao/pages/TelaClientes';
import Estoque from '@industrializacao/pages/Estoque';
import Pedidos from '@industrializacao/pages/Pedidos';
import Receitas from '@industrializacao/pages/Receitas';
import NovaProducao from '@industrializacao/pages/NovaProducao';
import OrdensProducao from '@industrializacao/pages/OrdensProducao';
import ChecklistProducao from '@industrializacao/pages/ChecklistProducao';
import Producoes from '@industrializacao/pages/Producoes';
import Ensaios from '@industrializacao/pages/qualidade/Ensaios';
import ListaEnsaios from '@industrializacao/pages/qualidade/ListaEnsaios';
import ProducoesCQ from '@industrializacao/pages/qualidade/ProducoesCQ';
import COA from '@industrializacao/pages/qualidade/COA';
import EquipamentosLab from '@industrializacao/pages/qualidade/EquipamentosLab';
import Vasilhames from '@industrializacao/pages/Vasilhames';
import Tankagem from '@industrializacao/pages/Tankagem';
import Transbordo from '@industrializacao/pages/Transbordo';
import Inventario from '@industrializacao/pages/Inventario';
import InventarioConferencia from '@industrializacao/pages/InventarioConferencia';
import Usuarios from '@industrializacao/pages/Usuarios';
import Perfis from '@industrializacao/pages/Perfis';
import AcessoNegado from '@industrializacao/pages/AcessoNegado';

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
            <Route path="qualidade/lista-ensaios" element={<ListaEnsaios />} />
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
