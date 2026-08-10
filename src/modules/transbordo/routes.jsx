import { Route, Routes, Navigate } from 'react-router-dom';
import MainLayout from '@transbordo/layouts/MainLayout';
import Home from '@transbordo/pages/Home';
import Dashboard from '@transbordo/pages/Dashboard';
import Entrada from '@transbordo/pages/Entrada';
import Transbordo from '@transbordo/pages/Transbordo';
import Cadastro from '@transbordo/pages/Cadastro';
import Vasilhames from '@transbordo/pages/Vasilhames';
import Tankagem from '@transbordo/pages/Tankagem';
import Saida from '@transbordo/pages/Saida';
import SaidaForm from '@transbordo/pages/SaidaForm';
import SaidaView from '@transbordo/pages/SaidaView';
import Estoque from '@transbordo/pages/Estoque';
import Filtracao from '@transbordo/pages/Filtracao';

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
