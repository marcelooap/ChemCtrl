import { useMemo } from 'react';
import {
  LayoutDashboard,
  BarChart3,
  ClipboardList,
  PackagePlus,
  Send,
  Truck,
  Container,
  Filter,
  Boxes,
  Cylinder,
} from 'lucide-react';
import ModuleSidebar from '@shared/components/layout/ModuleSidebar';

const NAV_ITEMS = [
  { path: '/chemflow', label: 'Home', icon: LayoutDashboard, end: true },
  { path: '/chemflow/dashboard', label: 'Dashboard', icon: BarChart3 },
  { path: '/chemflow/cadastro', label: 'Cadastro', icon: ClipboardList },
  { path: '/chemflow/entrada', label: 'Entrada', icon: PackagePlus },
  { path: '/chemflow/saida', label: 'Saída', icon: Send },
  { path: '/chemflow/transbordo', label: 'Transbordo', icon: Truck },
  { path: '/chemflow/vasilhames', label: 'Vasilhames', icon: Container },
  { path: '/chemflow/filtracao', label: 'Filtração', icon: Filter },
  { path: '/chemflow/estoque', label: 'Estoque', icon: Boxes },
  { path: '/chemflow/tankagem', label: 'Tankagem', icon: Cylinder },
];

export default function Sidebar({ collapsed, setCollapsed }) {
  const items = useMemo(() => NAV_ITEMS, []);

  return (
    <ModuleSidebar
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      logoSrc="/icons/chemflow-logo.png"
      logoAlt="ChemFlow"
      moduleName="ChemFlow"
      moduleSubtitle="Controle Operacional"
      items={items}
      showModulesLink
    />
  );
}
