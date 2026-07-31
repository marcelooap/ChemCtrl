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
/** @typedef {{ id: string, labelKey: string, order: number, resources: PermissionResource[] }} PermissionModule */

/** @type {PermissionModule[]} */
export const permissionModules = [
  {
    id: 'dashboard',
    labelKey: 'rbac.modules.dashboard',
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
    ],
  },
  {
    id: 'stock',
    labelKey: 'rbac.modules.stock',
    order: 30,
    resources: [
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
        id: 'tankage',
        labelKey: 'rbac.resources.tankage',
        icon: 'Cylinder',
        route: '/tankagem',
        nav: { showInSidebar: true, order: 13 },
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
        nav: { showInSidebar: true, order: 14 },
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
        id: 'quality_pending',
        labelKey: 'rbac.resources.qualityPending',
        icon: 'FileCheck',
        route: '/qualidade/producoes',
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
          order: 3,
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
    order: 70,
    resources: [
      {
        id: 'users',
        labelKey: 'rbac.resources.users',
        icon: 'Users',
        route: '/usuarios',
        nav: {
          showInSidebar: true,
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
        route: '/perfis',
        nav: {
          showInSidebar: true,
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
];

export function permissionKey(resourceId, actionKey) {
  return `${resourceId}.${actionKey}`;
}

export function getAllPermissionKeys() {
  const keys = [];
  for (const mod of permissionModules) {
    for (const res of mod.resources) {
      for (const action of res.actions) {
        keys.push(permissionKey(res.id, action.key));
      }
    }
  }
  return keys;
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
export function getSidebarNavSpec() {
  const flat = [];
  const groups = new Map();

  for (const mod of permissionModules) {
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
    raw_material_stock: 'sidebar.rawMaterialStock',
    inventory: 'sidebar.inventory',
    new_production: 'sidebar.newProduction',
    productions: 'sidebar.productions',
    production_orders: 'sidebar.productionOrders',
    quality_tests: 'sidebar.tests',
    quality_pending: 'sidebar.pendingAnalysis',
    quality_coa: 'sidebar.coa',
    containers: 'sidebar.containers',
    tankage: 'sidebar.tankage',
    transfer: 'sidebar.transfer',
    users: 'sidebar.users',
    profiles: 'sidebar.profiles',
    client_portal: 'sidebar.clientScreen',
    client_stock: 'sidebar.clientStock',
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
