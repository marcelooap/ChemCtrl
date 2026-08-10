import { Route, Routes, Navigate } from 'react-router-dom';
import MainLayout from '@painel/layouts/MainLayout';
import Home from '@painel/pages/Home';
import Dashboard from '@painel/pages/Dashboard';
import Comercial from '@painel/pages/Comercial';
import Logistica from '@painel/pages/Logistica';

/**
 * Rotas internas do Painel, montadas em `/painel/*`.
 * Paths relativos — padrão de descendant routes do React Router 6.
 * A rota índice redireciona para `/painel/home`.
 */
export default function PainelRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Navigate to="home" replace />} />
        <Route path="home" element={<Home />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="comercial" element={<Comercial />} />
        <Route path="logistica" element={<Logistica />} />
      </Route>
      <Route path="*" element={<Navigate to="/painel/home" replace />} />
    </Routes>
  );
}
