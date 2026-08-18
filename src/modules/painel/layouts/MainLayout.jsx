import { useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Home,
  LayoutDashboard,
  Briefcase,
  Truck,
  Users,
  Shield,
  PackagePlus,
  ClipboardList,
  Calendar,
  CalendarClock,
  PackageCheck,
  HardHat,
  Tag,
  Settings,
  Container,
  ArrowLeftRight,
  Warehouse,
} from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { canAccessRoute, isAdminUser } from '@industrializacao/lib/permissions';
import AppShell from '@shared/components/layout/AppShell';
import ModuleSidebar from '@shared/components/layout/ModuleSidebar';

/**
 * Layout do Painel — hub de módulos para usuários internos.
 * Telas de negócio seguem permissões individuais; Usuários/Permissões ficam para admin.
 * Usuários externos não acessam o Painel.
 */
export default function MainLayout() {
  const { t } = useTranslation();
  const { user } = useInternalAuth();
  const admin = isAdminUser(user);

  const items = useMemo(() => {
    const base = [
      { path: '/painel/home', label: t('painel.nav.home'), icon: Home, end: true },
    ];

    const business = [
      { path: '/painel/dashboard', label: t('painel.nav.dashboard'), icon: LayoutDashboard },
      {
        groupId: 'comercial',
        label: t('painel.nav.comercial'),
        icon: Briefcase,
        children: [
          {
            path: '/painel/comercial/reservar-material',
            label: t('painel.nav.reservarMaterial'),
            icon: PackagePlus,
          },
          {
            path: '/painel/comercial/solicitacoes-saida',
            label: t('painel.nav.solicitacoesSaida'),
            icon: ClipboardList,
          },
          {
            path: '/painel/comercial/agendamentos',
            label: t('painel.nav.agendamentos'),
            icon: Calendar,
          },
        ],
      },
      {
        groupId: 'logistica',
        label: t('painel.nav.logistica'),
        icon: Truck,
        children: [
          {
            path: '/painel/logistica/agendamentos',
            label: t('painel.nav.logisticaAgendamentos'),
            icon: CalendarClock,
          },
          {
            path: '/painel/logistica/carregamentos',
            label: t('painel.nav.logisticaCarregamentos'),
            icon: PackageCheck,
          },
        ],
      },
      {
        groupId: 'operacional',
        label: t('painel.nav.operacional'),
        icon: Container,
        children: [
          {
            path: '/painel/operacional/ordem-transbordo',
            label: t('painel.nav.ordemTransbordo'),
            icon: ArrowLeftRight,
          },
          {
            path: '/painel/operacional/estoque',
            label: t('painel.nav.estoque'),
            icon: Warehouse,
          },
        ],
      },
    ];

    const adminItems = admin
      ? [{
        groupId: 'usersPermissions',
        label: t('painel.nav.usersAndPermissions'),
        icon: Users,
        children: [
          { path: '/painel/usuarios', label: t('painel.nav.users'), icon: Users },
          { path: '/painel/permissoes', label: t('painel.nav.permissions'), icon: Shield },
        ],
      }]
      : [];

    const configItem = {
      groupId: 'configuracao',
      label: t('painel.nav.configuracao'),
      icon: Settings,
      children: [
        {
          path: '/painel/configuracao/operadores',
          label: t('painel.nav.operadores'),
          icon: HardHat,
        },
        {
          path: '/painel/configuracao/etiquetas',
          label: t('painel.nav.etiquetas'),
          icon: Tag,
        },
      ],
    };

    return [...base, ...business, ...adminItems, configItem];
  }, [t, admin]);

  if (user?.tipo === 'externo') {
    return <Navigate to="/tela-clientes" replace />;
  }

  return (
    <AppShell
      sidebar={({ collapsed, setCollapsed }) => (
        <ModuleSidebar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          logoSrc="/icons/chemctrl-logo.svg"
          logoAlt="ChemCtrl"
          moduleName={t('sidebar.moduleName')}
          moduleSubtitle={t('painel.subtitle')}
          items={items}
          canAccessPath={(path) =>
            path === '/painel/home'
            || path === '/painel/configuracao'
            || path.startsWith('/painel/configuracao/')
            || canAccessRoute(user, path)
          }
          showModulesLink={false}
        />
      )}
    />
  );
}
