import { Route, Routes, Navigate } from 'react-router-dom';
import MainLayout from '@chemflow/layouts/MainLayout';
import Home from '@chemflow/pages/Home';
import Dashboard from '@chemflow/pages/Dashboard';
import Entrada from '@chemflow/pages/Entrada';
import Transbordo from '@chemflow/pages/Transbordo';
import Cadastro from '@chemflow/pages/Cadastro';
import Vasilhames from '@chemflow/pages/Vasilhames';
import Tankagem from '@chemflow/pages/Tankagem';
import Saida from '@chemflow/pages/Saida';
import SaidaForm from '@chemflow/pages/SaidaForm';
import SaidaView from '@chemflow/pages/SaidaView';
import Estoque from '@chemflow/pages/Estoque';
import Filtracao from '@chemflow/pages/Filtracao';

/**
 * Rotas internas do ChemFlow, montadas em `/chemflow/*`.
 * Paths relativos (sem `/` inicial) e `index` para a Home — padrão correto
 * de descendant routes do React Router 6.
 */
export default function ChemFlowRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Home />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="cadastro" element={<Cadastro />} />
        <Route path="entrada" element={<Entrada />} />
        <Route path="saida" element={<Saida />} />
        <Route path="saida/novo" element={<SaidaForm />} />
        <Route path="saida/editar/:id" element={<SaidaForm />} />
        <Route path="saida/visualizar/:id" element={<SaidaView />} />
        <Route path="transbordo" element={<Transbordo />} />
        <Route path="vasilhames" element={<Vasilhames />} />
        <Route path="filtracao" element={<Filtracao />} />
        <Route path="estoque" element={<Estoque />} />
        <Route path="tankagem" element={<Tankagem />} />
      </Route>
      <Route path="*" element={<Navigate to="/chemflow" replace />} />
    </Routes>
  );
}
