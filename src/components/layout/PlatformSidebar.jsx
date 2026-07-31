import { useMemo } from 'react';
import {
  LayoutDashboard,
  BarChart3,
  Boxes,
  Briefcase,
  ClipboardList,
  Send,
  Layers,
  Receipt,
  Users,
  User,
  Shield,
} from 'lucide-react';
import ModuleSidebar from '@shared/components/layout/ModuleSidebar';

const NAV_ITEMS = [
  { path: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { path: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { path: '/estoque', label: 'Estoque', icon: Boxes },
  {
    groupId: 'comercial',
    label: 'Comercial',
    icon: Briefcase,
    children: [
      { path: '/comercial/fichado', label: 'Fichado', icon: ClipboardList },
      { path: '/comercial/solicitar-saida', label: 'Solicitar saída', icon: Send },
      { path: '/comercial/composicao-carga', label: 'Composição de carga', icon: Layers },
    ],
  },
  { path: '/faturamento', label: 'Faturamento', icon: Receipt },
  {
    groupId: 'usuarios',
    label: 'Controle de usuários',
    icon: Users,
    children: [
      { path: '/usuarios', label: 'Usuários', icon: User, end: true },
      { path: '/usuarios/permissoes', label: 'Controle de permissão', icon: Shield },
    ],
  },
];

export default function PlatformSidebar({ collapsed, setCollapsed }) {
  const items = useMemo(() => NAV_ITEMS, []);

  return (
    <ModuleSidebar
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      logoSrc="/icons/chemctrl-logo.svg"
      logoAlt="ChemCtrl"
      moduleName="ChemCtrl"
      moduleSubtitle="Controle Operacional"
      items={items}
      showModulesLink={false}
    />
  );
}
