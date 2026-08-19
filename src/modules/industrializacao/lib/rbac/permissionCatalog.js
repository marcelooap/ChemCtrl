/**
 * ChemCtrl RBAC — permissionCatalog
 *
 * SOURCE OF TRUTH for modules, screens, actions, routes and sidebar.
 *
 * How to add a new screen:
 * 1. Add a Route in App.jsx
 * 2. Register the resource here (module, icon, route, nav, actions)
 * 3. Add i18n keys under rbac.* / sidebar.*
 * 4. (Optional) Align Supabase RLS / has_permission checks for writes
 * 5. Re-seed Admin permissions if migration already applied
 *    (or grant via Perfis UI)
 *
 * Sidebar, route guards and Profiles UI all consume this file.
 */

export const RBAC_ADMIN_SLUG = 'administrador';

export const ADMIN_PROTECTED_KEYS = [
  'profiles.view',
  'profiles.create',
  'profiles.edit',
  'profiles.delete',
  'users.view',
  'users.create',
  'users.edit',
  'users.delete',
];

export const APP_MODULE_IDS = Object.freeze({
  PAINEL: 'painel',
  INDUSTRIALIZACAO: 'industrializacao',
  TRANSBORDO: 'transbordo',
});

export const MODULE_ACCESS_KEYS = Object.freeze({
  painel: 'module.painel',
  industrializacao: 'module.industrializacao',
  transbordo: 'module.transbordo',
});

export const REQUIRED_INTERNAL_KEYS = Object.freeze([
  MODULE_ACCESS_KEYS.painel,
  'painel_home.view',
]);

/** @typedef {{ key: string, labelKey: string }} PermissionAction */
/** @typedef {{
 *  id: string,
 *  labelKey: string,
 *  icon?: string,
 *  route?: string | null,
 *  routePrefixes?: string[],
 *  nav?: { showInSidebar?: boolean, order?: number, groupId?: string | null, groupLabelKey?: string, groupIcon?: string, groupOrder?: number },
 *  actions: PermissionAction[]
 * }} PermissionResource */
/** @typedef {{ id: string, labelKey: string, order: number, appModuleId?: string, resources: PermissionResource[] }} PermissionModule */

/** @type {PermissionModule[]} */
export const permissionModules = [
  {
    id: 'dashboard',
    labelKey: 'rbac.modules.dashboard',
    appModuleId: APP_MODULE_IDS.INDUSTRIALIZACAO,
    order: 10,
    resources: [
      {
        id: 'home',
        labelKey: 'rbac.resources.home',
        icon: 'LayoutDashboard',
        route: '/',
        nav: { showInSidebar: true, order: 1 },
        actions: [{ key: 'view', labelKey: 'rbac.actions.view' }],
      },
      {
        id: 'dashboard',
        labelKey: 'rbac.resources.dashboard',
        icon: 'BarChart3',
        route: '/dashboard',
        nav: { showInSidebar: true, order: 2 },
        actions: [{ key: 'view', labelKey: 'rbac.actions.view' }],
      },
    ],
  },
  {
    id: 'recipes',
    labelKey: 'rbac.modules.recipes',
    appModuleId: APP_MODULE_IDS.INDUSTRIALIZACAO,
    order: 20,
    resources: [
      {
        id: 'recipes',
        labelKey: 'rbac.resources.recipes',
        icon: 'BookOpen',
        route: '/receitas',
        nav: { showInSidebar: true, order: 3 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.createRecipe' },
          { key: 'edit', labelKey: 'rbac.actions.editRecipe' },
          { key: 'delete', labelKey: 'rbac.actions.deleteRecipe' },
          { key: 'approve', labelKey: 'rbac.actions.approveRecipe' },
          { key: 'manage_fds', labelKey: 'rbac.actions.manageFds' },
          { key: 'remove_fds', labelKey: 'rbac.actions.removeFds' },
        ],
      },
    ],
  },
  {
    id: 'orders',
    labelKey: 'rbac.modules.orders',
    appModuleId: APP_MODULE_IDS.INDUSTRIALIZACAO,
    order: 25,
    resources: [
      {
        id: 'orders',
        labelKey: 'rbac.resources.orders',
        icon: 'ClipboardList',
        route: '/pedidos',
        nav: { showInSidebar: true, order: 4 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'programming',
        labelKey: 'rbac.resources.programming',
        icon: 'CalendarDays',
        route: '/programacao',
        nav: { showInSidebar: true, order: 4.5 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
    ],
  },
  {
    id: 'stock',
    labelKey: 'rbac.modules.stock',
    appModuleId: APP_MODULE_IDS.INDUSTRIALIZACAO,
    order: 30,
    resources: [
      {
        id: 'ind_validacao',
        labelKey: 'rbac.resources.indValidacao',
        icon: 'ShieldCheck',
        route: '/validacao',
        nav: { showInSidebar: true, order: 4.8 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
          { key: 'validate', labelKey: 'rbac.actions.validate' },
        ],
      },
      {
        id: 'raw_material_stock',
        labelKey: 'rbac.resources.rawMaterialStock',
        icon: 'Package',
        route: '/estoque',
        nav: { showInSidebar: true, order: 5 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'inventory',
        labelKey: 'rbac.resources.inventory',
        icon: 'ClipboardCheck',
        route: '/inventario',
        routePrefixes: ['/inventario/'],
        nav: { showInSidebar: true, order: 6 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'containers',
        labelKey: 'rbac.resources.containers',
        icon: 'Box',
        route: '/vasilhames',
        nav: { showInSidebar: true, order: 12 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'saida',
        labelKey: 'rbac.resources.saida',
        icon: 'Truck',
        route: '/saida',
        routePrefixes: ['/saida/'],
        nav: { showInSidebar: true, order: 13 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'tankage',
        labelKey: 'rbac.resources.tankage',
        icon: 'Cylinder',
        route: '/tankagem',
        nav: { showInSidebar: true, order: 14 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'transfer',
        labelKey: 'rbac.resources.transfer',
        icon: 'ArrowRightLeft',
        route: '/transbordo',
        nav: { showInSidebar: true, order: 15 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
    ],
  },
  {
    id: 'production',
    labelKey: 'rbac.modules.production',
    appModuleId: APP_MODULE_IDS.INDUSTRIALIZACAO,
    order: 40,
    resources: [
      {
        id: 'new_production',
        labelKey: 'rbac.resources.newProduction',
        icon: 'Plus',
        route: '/nova-producao',
        nav: { showInSidebar: true, order: 7 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.createOp' },
        ],
      },
      {
        id: 'productions',
        labelKey: 'rbac.resources.productions',
        icon: 'ListOrdered',
        route: '/producoes',
        nav: { showInSidebar: true, order: 8 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create_op', labelKey: 'rbac.actions.createOp' },
          { key: 'edit_op', labelKey: 'rbac.actions.editOp' },
          { key: 'complement', labelKey: 'rbac.actions.complementLot' },
          { key: 'cancel', labelKey: 'rbac.actions.cancelOp' },
          { key: 'finish', labelKey: 'rbac.actions.finishOp' },
          { key: 'print_label', labelKey: 'rbac.actions.printLabel' },
          { key: 'export', labelKey: 'rbac.actions.exportExcel' },
        ],
      },
      {
        id: 'production_orders',
        labelKey: 'rbac.resources.productionOrders',
        icon: 'Factory',
        route: '/ordens',
        routePrefixes: ['/producao/'],
        nav: { showInSidebar: true, order: 9 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
    ],
  },
  {
    id: 'quality',
    labelKey: 'rbac.modules.quality',
    appModuleId: APP_MODULE_IDS.INDUSTRIALIZACAO,
    order: 50,
    resources: [
      {
        id: 'quality_tests',
        labelKey: 'rbac.resources.qualityTests',
        icon: 'FlaskConical',
        route: '/qualidade/ensaios',
        nav: {
          showInSidebar: true,
          order: 1,
          groupId: 'qualityControl',
          groupLabelKey: 'sidebar.qualityControl',
          groupIcon: 'Shield',
          groupOrder: 10,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'register_test', labelKey: 'rbac.actions.registerTest' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'quality_analyses',
        labelKey: 'rbac.resources.qualityAnalyses',
        icon: 'ClipboardList',
        route: '/qualidade/lista-ensaios',
        nav: {
          showInSidebar: true,
          order: 2,
          groupId: 'qualityControl',
          groupLabelKey: 'sidebar.qualityControl',
          groupIcon: 'Shield',
          groupOrder: 10,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'quality_pending',
        labelKey: 'rbac.resources.qualityPending',
        icon: 'FileCheck',
        route: '/qualidade/producoes',
        nav: {
          showInSidebar: true,
          order: 3,
          groupId: 'qualityControl',
          groupLabelKey: 'sidebar.qualityControl',
          groupIcon: 'Shield',
          groupOrder: 10,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'release_production', labelKey: 'rbac.actions.releaseProduction' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
        ],
      },
      {
        id: 'quality_coa',
        labelKey: 'rbac.resources.qualityCoa',
        icon: 'Award',
        route: '/qualidade/coa',
        nav: {
          showInSidebar: true,
          order: 4,
          groupId: 'qualityControl',
          groupLabelKey: 'sidebar.qualityControl',
          groupIcon: 'Shield',
          groupOrder: 10,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'issue_coa', labelKey: 'rbac.actions.issueCoa' },
          { key: 'export', labelKey: 'rbac.actions.exportExcel' },
        ],
      },
      {
        id: 'lab_equipment',
        labelKey: 'rbac.resources.labEquipment',
        icon: 'FlaskConical',
        route: '/qualidade/equipamentos',
        nav: { showInSidebar: false },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
    ],
  },
  {
    id: 'clients',
    labelKey: 'rbac.modules.clients',
    appModuleId: APP_MODULE_IDS.INDUSTRIALIZACAO,
    order: 60,
    resources: [
      {
        id: 'client_portal',
        labelKey: 'rbac.resources.clientPortal',
        icon: 'Building2',
        route: '/tela-clientes',
        nav: { showInSidebar: true, order: 17 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
        ],
      },
      {
        id: 'client_stock',
        labelKey: 'rbac.resources.clientStock',
        icon: 'Warehouse',
        route: '/estoque-cliente',
        nav: { showInSidebar: true, order: 18 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
        ],
      },
    ],
  },
  {
    id: 'administration',
    labelKey: 'rbac.modules.administration',
    appModuleId: APP_MODULE_IDS.PAINEL,
    order: 70,
    resources: [
      {
        id: 'users',
        labelKey: 'rbac.resources.users',
        icon: 'Users',
        route: '/painel/usuarios',
        nav: {
          // Nav moved to Painel module sidebar
          showInSidebar: false,
          order: 1,
          groupId: 'usersPermissions',
          groupLabelKey: 'sidebar.usersAndPermissions',
          groupIcon: 'Users',
          groupOrder: 15,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'profiles',
        labelKey: 'rbac.resources.profiles',
        icon: 'Shield',
        route: '/painel/permissoes',
        nav: {
          // Nav moved to Painel module sidebar
          showInSidebar: false,
          order: 2,
          groupId: 'usersPermissions',
          groupLabelKey: 'sidebar.usersAndPermissions',
          groupIcon: 'Users',
          groupOrder: 15,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
    ],
  },
  {
    id: 'painel_hub',
    labelKey: 'rbac.modules.painel',
    appModuleId: APP_MODULE_IDS.PAINEL,
    order: 5,
    resources: [
      {
        id: 'painel_home',
        labelKey: 'rbac.resources.painelHome',
        icon: 'Home',
        route: '/painel/home',
        nav: { showInSidebar: true, order: 1 },
        actions: [{ key: 'view', labelKey: 'rbac.actions.view' }],
      },
      {
        id: 'painel_dashboard',
        labelKey: 'rbac.resources.painelDashboard',
        icon: 'LayoutDashboard',
        route: '/painel/dashboard',
        nav: { showInSidebar: true, order: 2 },
        actions: [{ key: 'view', labelKey: 'rbac.actions.view' }],
      },
      {
        id: 'painel_comercial_reserva',
        labelKey: 'rbac.resources.painelReservarMaterial',
        icon: 'PackagePlus',
        route: '/painel/comercial/reservar-material',
        nav: {
          showInSidebar: true,
          order: 1,
          groupId: 'comercial',
          groupLabelKey: 'painel.nav.comercial',
          groupIcon: 'Briefcase',
          groupOrder: 3,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
        ],
      },
      {
        id: 'painel_comercial_saida',
        labelKey: 'rbac.resources.painelSolicitacoesSaida',
        icon: 'ClipboardList',
        route: '/painel/comercial/solicitacoes-saida',
        routePrefixes: ['/painel/comercial/solicitacoes-saida/'],
        nav: {
          showInSidebar: true,
          order: 2,
          groupId: 'comercial',
          groupLabelKey: 'painel.nav.comercial',
          groupIcon: 'Briefcase',
          groupOrder: 3,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'painel_comercial_agendamentos',
        labelKey: 'rbac.resources.painelAgendamentos',
        icon: 'Calendar',
        route: '/painel/comercial/agendamentos',
        nav: {
          showInSidebar: true,
          order: 3,
          groupId: 'comercial',
          groupLabelKey: 'painel.nav.comercial',
          groupIcon: 'Briefcase',
          groupOrder: 3,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'painel_logistica_agendamentos',
        labelKey: 'rbac.resources.painelLogisticaAgendamentos',
        icon: 'CalendarClock',
        route: '/painel/logistica/agendamentos',
        nav: {
          showInSidebar: true,
          order: 1,
          groupId: 'logistica',
          groupLabelKey: 'painel.nav.logistica',
          groupIcon: 'Truck',
          groupOrder: 4,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'painel_logistica_carregamentos',
        labelKey: 'rbac.resources.painelLogisticaCarregamentos',
        icon: 'PackageCheck',
        route: '/painel/logistica/carregamentos',
        nav: {
          showInSidebar: true,
          order: 2,
          groupId: 'logistica',
          groupLabelKey: 'painel.nav.logistica',
          groupIcon: 'Truck',
          groupOrder: 4,
        },
        actions: [{ key: 'view', labelKey: 'rbac.actions.view' }],
      },
      {
        id: 'painel_logistica_recebimento',
        labelKey: 'rbac.resources.painelLogisticaRecebimento',
        icon: 'Inbox',
        route: '/painel/logistica/recebimento',
        nav: {
          showInSidebar: true,
          order: 3,
          groupId: 'logistica',
          groupLabelKey: 'painel.nav.logistica',
          groupIcon: 'Truck',
          groupOrder: 4,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'painel_operacional_ordem_transbordo',
        labelKey: 'rbac.resources.painelOrdemTransbordo',
        icon: 'ArrowLeftRight',
        route: '/painel/operacional/ordem-transbordo',
        nav: {
          showInSidebar: true,
          order: 1,
          groupId: 'operacional',
          groupLabelKey: 'painel.nav.operacional',
          groupIcon: 'Container',
          groupOrder: 5,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'painel_operacional_estoque',
        labelKey: 'rbac.resources.painelEstoque',
        icon: 'Warehouse',
        route: '/painel/operacional/estoque',
        nav: {
          showInSidebar: true,
          order: 2,
          groupId: 'operacional',
          groupLabelKey: 'painel.nav.operacional',
          groupIcon: 'Container',
          groupOrder: 5,
        },
        actions: [{ key: 'view', labelKey: 'rbac.actions.view' }],
      },
      {
        id: 'painel_config_operadores',
        labelKey: 'rbac.resources.painelOperadores',
        icon: 'HardHat',
        route: '/painel/configuracao/operadores',
        nav: {
          showInSidebar: true,
          order: 1,
          groupId: 'configuracao',
          groupLabelKey: 'painel.nav.configuracao',
          groupIcon: 'Settings',
          groupOrder: 7,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
        ],
      },
      {
        id: 'painel_config_etiquetas',
        labelKey: 'rbac.resources.painelEtiquetas',
        icon: 'Tag',
        route: '/painel/configuracao/etiquetas',
        nav: {
          showInSidebar: true,
          order: 2,
          groupId: 'configuracao',
          groupLabelKey: 'painel.nav.configuracao',
          groupIcon: 'Settings',
          groupOrder: 7,
        },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
        ],
      },
    ],
  },
  {
    id: 'transbordo',
    labelKey: 'rbac.modules.transbordo',
    appModuleId: APP_MODULE_IDS.TRANSBORDO,
    order: 80,
    resources: [
      {
        id: 'tb_home',
        labelKey: 'rbac.resources.tbHome',
        icon: 'LayoutDashboard',
        route: '/chemflow',
        nav: { showInSidebar: true, order: 1 },
        actions: [{ key: 'view', labelKey: 'rbac.actions.view' }],
      },
      {
        id: 'tb_dashboard',
        labelKey: 'rbac.resources.tbDashboard',
        icon: 'BarChart3',
        route: '/chemflow/dashboard',
        nav: { showInSidebar: true, order: 2 },
        actions: [{ key: 'view', labelKey: 'rbac.actions.view' }],
      },
      {
        id: 'tb_cadastro',
        labelKey: 'rbac.resources.tbCadastro',
        icon: 'ClipboardList',
        route: '/chemflow/cadastro',
        nav: { showInSidebar: true, order: 3 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'tb_entrada',
        labelKey: 'rbac.resources.tbEntrada',
        icon: 'PackagePlus',
        route: '/chemflow/entrada',
        nav: { showInSidebar: true, order: 4 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'tb_saida',
        labelKey: 'rbac.resources.tbSaida',
        icon: 'Send',
        route: '/chemflow/saida',
        routePrefixes: ['/chemflow/saida/'],
        nav: { showInSidebar: true, order: 5 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'tb_transbordo',
        labelKey: 'rbac.resources.tbTransbordo',
        icon: 'Truck',
        route: '/chemflow/transbordo',
        nav: { showInSidebar: true, order: 6 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'tb_validacao',
        labelKey: 'rbac.resources.tbValidacao',
        icon: 'ShieldCheck',
        route: '/chemflow/validacao',
        nav: { showInSidebar: true, order: 6.5 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
          { key: 'validate', labelKey: 'rbac.actions.validate' },
        ],
      },
      {
        id: 'tb_vasilhames',
        labelKey: 'rbac.resources.tbVasilhames',
        icon: 'Container',
        route: '/chemflow/vasilhames',
        nav: { showInSidebar: true, order: 7 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'tb_filtracao',
        labelKey: 'rbac.resources.tbFiltracao',
        icon: 'Filter',
        route: '/chemflow/filtracao',
        nav: { showInSidebar: true, order: 8 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'tb_estoque',
        labelKey: 'rbac.resources.tbEstoque',
        icon: 'Boxes',
        route: '/chemflow/estoque',
        nav: { showInSidebar: true, order: 9 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'create', labelKey: 'rbac.actions.create' },
          { key: 'edit', labelKey: 'rbac.actions.edit' },
          { key: 'delete', labelKey: 'rbac.actions.delete' },
        ],
      },
      {
        id: 'tb_estoque_envio',
        labelKey: 'rbac.resources.tbEstoqueEnvio',
        icon: 'PackageSearch',
        route: '/chemflow/estoque-envio',
        nav: { showInSidebar: true, order: 10 },
        actions: [
          { key: 'view', labelKey: 'rbac.actions.view' },
          { key: 'export', labelKey: 'rbac.actions.exportExcel' },
        ],
      },
      {
        id: 'tb_tankagem',
        labelKey: 'rbac.resources.tbTankagem',
        icon: 'Cylinder',
        route: '/chemflow/tankagem',
        nav: { showInSidebar: true, order: 11 },
        actions: [{ key: 'view', labelKey: 'rbac.actions.view' }],
      },
    ],
  },
];

export function permissionKey(resourceId, actionKey) {
  return `${resourceId}.${actionKey}`;
}

export function getAllPermissionKeys() {
  const keys = [...Object.values(MODULE_ACCESS_KEYS)];
  for (const mod of permissionModules) {
    for (const res of mod.resources) {
      for (const action of res.actions) {
        keys.push(permissionKey(res.id, action.key));
      }
    }
  }
  return keys;
}

export function getScreenViewKeys(appModuleId) {
  const keys = [];
  for (const mod of permissionModules) {
    if ((mod.appModuleId || APP_MODULE_IDS.INDUSTRIALIZACAO) !== appModuleId) continue;
    for (const res of mod.resources) {
      if (res.actions.some((a) => a.key === 'view')) {
        keys.push(permissionKey(res.id, 'view'));
      }
    }
  }
  return keys;
}

export function getKeysForAppModule(appModuleId) {
  const keys = [];
  const accessKey = MODULE_ACCESS_KEYS[appModuleId];
  if (accessKey) keys.push(accessKey);
  for (const mod of permissionModules) {
    if ((mod.appModuleId || APP_MODULE_IDS.INDUSTRIALIZACAO) !== appModuleId) continue;
    for (const res of mod.resources) {
      for (const action of res.actions) {
        keys.push(permissionKey(res.id, action.key));
      }
    }
  }
  return keys;
}

/**
 * Árvore Módulo → Tela → Ações para a tela Permissões.
 */
export function getPermissionTree() {
  const appOrder = [
    {
      id: APP_MODULE_IDS.PAINEL,
      labelKey: 'rbac.appModules.painel',
      moduleAccessKey: MODULE_ACCESS_KEYS.painel,
      required: true,
    },
    {
      id: APP_MODULE_IDS.INDUSTRIALIZACAO,
      labelKey: 'rbac.appModules.industrializacao',
      moduleAccessKey: MODULE_ACCESS_KEYS.industrializacao,
      required: false,
    },
    {
      id: APP_MODULE_IDS.TRANSBORDO,
      labelKey: 'rbac.appModules.transbordo',
      moduleAccessKey: MODULE_ACCESS_KEYS.transbordo,
      required: false,
    },
  ];

  return appOrder.map((app) => ({
    ...app,
    screens: permissionModules
      .filter((m) => (m.appModuleId || APP_MODULE_IDS.INDUSTRIALIZACAO) === app.id)
      .flatMap((m) => m.resources.map((res) => ({
        id: res.id,
        labelKey: res.labelKey,
        viewKey: permissionKey(res.id, 'view'),
        actions: res.actions
          .filter((a) => a.key !== 'view')
          .map((a) => ({
            key: permissionKey(res.id, a.key),
            actionKey: a.key,
            labelKey: a.labelKey,
          })),
      }))),
  }));
}

export function getAllResources() {
  return permissionModules.flatMap((m) => m.resources);
}

export function getResourceById(resourceId) {
  return getAllResources().find((r) => r.id === resourceId) || null;
}

export function getResourceByPath(pathname) {
  const resources = getAllResources();
  const exact = resources.find((r) => r.route && r.route === pathname);
  if (exact) return exact;
  const byPrefix = resources
    .filter((r) => Array.isArray(r.routePrefixes) && r.routePrefixes.some((p) => pathname.startsWith(p)))
    .sort((a, b) => (b.routePrefixes?.[0]?.length || 0) - (a.routePrefixes?.[0]?.length || 0));
  if (byPrefix.length) return byPrefix[0];
  const byRoutePrefix = resources
    .filter((r) => r.route && r.route !== '/' && pathname.startsWith(`${r.route}/`))
    .sort((a, b) => (b.route?.length || 0) - (a.route?.length || 0));
  return byRoutePrefix[0] || null;
}

export function getViewPermissionForPath(pathname) {
  const resource = getResourceByPath(pathname);
  if (!resource) return null;
  return permissionKey(resource.id, 'view');
}

/**
 * Builds sidebar nav items from the catalog (flat + groups).
 * @returns {Array}
 */
export function getSidebarNavSpec(appModuleId = APP_MODULE_IDS.INDUSTRIALIZACAO) {
  const flat = [];
  const groups = new Map();

  for (const mod of permissionModules) {
    if ((mod.appModuleId || APP_MODULE_IDS.INDUSTRIALIZACAO) !== appModuleId) continue;
    for (const res of mod.resources) {
      const nav = res.nav;
      if (!nav?.showInSidebar) continue;

      const item = {
        resourceId: res.id,
        labelKey: res.labelKey.startsWith('rbac.') ? mapResourceToSidebarLabel(res.id) : res.labelKey,
        icon: res.icon,
        path: res.route,
        order: nav.order ?? 99,
        viewPermission: permissionKey(res.id, 'view'),
      };

      if (nav.groupId) {
        if (!groups.has(nav.groupId)) {
          groups.set(nav.groupId, {
            labelKey: nav.groupLabelKey,
            icon: nav.groupIcon,
            groupId: nav.groupId,
            path: null,
            order: nav.groupOrder ?? nav.order ?? 99,
            children: [],
          });
        }
        groups.get(nav.groupId).children.push({ ...item, order: nav.order ?? 99 });
      } else {
        flat.push(item);
      }
    }
  }

  for (const group of groups.values()) {
    group.children.sort((a, b) => a.order - b.order);
    flat.push(group);
  }

  flat.sort((a, b) => a.order - b.order);
  return flat;
}

function mapResourceToSidebarLabel(resourceId) {
  const map = {
    home: 'sidebar.home',
    dashboard: 'sidebar.dashboard',
    recipes: 'sidebar.recipes',
    orders: 'sidebar.orders',
    programming: 'sidebar.programming',
    raw_material_stock: 'sidebar.rawMaterialStock',
    ind_validacao: 'sidebar.validacao',
    inventory: 'sidebar.inventory',
    new_production: 'sidebar.newProduction',
    productions: 'sidebar.productions',
    production_orders: 'sidebar.productionOrders',
    quality_tests: 'sidebar.tests',
    quality_analyses: 'sidebar.analysesList',
    quality_pending: 'sidebar.pendingAnalysis',
    quality_coa: 'sidebar.coa',
    containers: 'sidebar.containers',
    saida: 'sidebar.saida',
    tankage: 'sidebar.tankage',
    transfer: 'sidebar.transfer',
    users: 'sidebar.users',
    profiles: 'sidebar.profiles',
    client_portal: 'sidebar.clientScreen',
    client_stock: 'sidebar.clientStock',
    painel_home: 'painel.nav.home',
    painel_dashboard: 'painel.nav.dashboard',
    painel_comercial_reserva: 'painel.nav.reservarMaterial',
    painel_comercial_saida: 'painel.nav.solicitacoesSaida',
    painel_comercial_agendamentos: 'painel.nav.agendamentos',
    painel_logistica_agendamentos: 'painel.nav.logisticaAgendamentos',
    painel_logistica_carregamentos: 'painel.nav.logisticaCarregamentos',
    painel_logistica_recebimento: 'painel.nav.logisticaRecebimento',
    painel_operacional_ordem_transbordo: 'painel.nav.ordemTransbordo',
    painel_operacional_estoque: 'painel.nav.estoque',
    painel_config_operadores: 'painel.nav.operadores',
    painel_config_etiquetas: 'painel.nav.etiquetas',
    tb_home: 'transbordo.nav.home',
    tb_dashboard: 'transbordo.nav.dashboard',
    tb_cadastro: 'transbordo.nav.cadastro',
    tb_entrada: 'transbordo.nav.entrada',
    tb_saida: 'transbordo.nav.saida',
    tb_transbordo: 'transbordo.nav.transbordo',
    tb_validacao: 'transbordo.nav.validacao',
    tb_vasilhames: 'transbordo.nav.vasilhames',
    tb_filtracao: 'transbordo.nav.filtracao',
    tb_estoque: 'transbordo.nav.estoque',
    tb_estoque_envio: 'transbordo.nav.estoqueEnvio',
    tb_tankagem: 'transbordo.nav.tankagem',
  };
  return map[resourceId] || `rbac.resources.${resourceId}`;
}

/** Legacy nivel → permission keys (dual-mode until migration is applied). */
export function getLegacyPermissionsForUser(user) {
  const all = getAllPermissionKeys();
  if (!user) return [];

  if (user.tipo === 'externo') {
    return ['client_portal.view'];
  }

  const nivel = (user.nivel || user.nivel_acesso || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (nivel === 'administrador') return all;

  if (nivel === 'supervisor') {
    return all.filter((k) => !k.startsWith('users.') && !k.startsWith('profiles.'));
  }

  if (nivel === 'operacional' || nivel === 'operador') {
    return [
      'production_orders.view', 'production_orders.create', 'production_orders.edit',
      'inventory.view', 'inventory.create', 'inventory.edit',
      'containers.view',
      'raw_material_stock.view',
      'home.view',
      'programming.view', 'programming.create', 'programming.edit', 'programming.delete',
    ];
  }

  if (nivel === 'visualizacao') {
    return [
      'orders.view',
      'containers.view',
      'tankage.view',
      'client_stock.view',
      'quality_coa.view',
      'home.view',
    ];
  }

  return [];
}

export function getDefaultRouteFromPermissions(permissions, user) {
  if (user?.tipo === 'externo') return '/tela-clientes';
  const set = new Set(permissions || []);
  if (set.has('home.view')) return '/';
  if (set.has('production_orders.view')) return '/ordens';
  if (set.has('containers.view')) return '/vasilhames';
  if (set.has('client_portal.view')) return '/tela-clientes';
  if (set.has('dashboard.view')) return '/dashboard';
  const firstView = (permissions || []).find((k) => k.endsWith('.view'));
  if (firstView) {
    const resourceId = firstView.replace(/\.view$/, '');
    const res = getResourceById(resourceId);
    if (res?.route) return res.route;
  }
  return '/';
}
