import i18n from '@/i18n';
import { ROLE_KEYS } from '@/i18n/domainMaps';
import {
  getDefaultRouteFromPermissions,
  getLegacyPermissionsForUser,
  getViewPermissionForPath,
  permissionKey,
  RBAC_ADMIN_SLUG,
} from '@industrializacao/lib/rbac/permissionCatalog';

function normalizeNivel(user) {
  return (user?.nivel || user?.nivel_acesso || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function resolvePermissions(user) {
  if (!user) return [];
  const base = Array.isArray(user.permissions) && user.permissions.length > 0
    ? user.permissions
    : getLegacyPermissionsForUser(user);
  return augmentProgrammingPermissions(
    augmentLogisticaPermissions(augmentQualityAnalysesPermissions(base))
  );
}

/** Bridge: Programação herda o acesso de Pedidos até os perfis serem re-semeados. */
export function augmentProgrammingPermissions(permissions) {
  const set = new Set(permissions || []);
  if (set.has('orders.view')) set.add('programming.view');
  if (set.has('orders.create')) set.add('programming.create');
  if (set.has('orders.edit')) set.add('programming.edit');
  if (set.has('orders.delete')) set.add('programming.delete');
  return Array.from(set);
}

/** Bridge: Lista de Ensaios inherits Cadastro CQ access until profiles are re-seeded. */
export function augmentQualityAnalysesPermissions(permissions) {
  const set = new Set(permissions || []);
  if (set.has('quality_tests.view')) set.add('quality_analyses.view');
  if (set.has('quality_tests.register_test') || set.has('quality_tests.edit')) {
    set.add('quality_analyses.create');
    set.add('quality_analyses.edit');
  }
  if (set.has('quality_tests.delete')) set.add('quality_analyses.delete');
  return Array.from(set);
}

/** Bridge: subitens de Logística herdam o acesso antigo da tela única. */
export function augmentLogisticaPermissions(permissions) {
  const set = new Set(permissions || []);
  if (set.has('painel_logistica.view')) {
    set.add('painel_logistica_agendamentos.view');
    set.add('painel_logistica_carregamentos.view');
    set.add('painel_logistica_recebimento.view');
    set.add('painel_logistica_recebimento.create');
  }
  return Array.from(set);
}

export function hasPermission(user, key) {
  return resolvePermissions(user).includes(key);
}

export function canAccessRoute(user, path) {
  if (!user) return false;
  if (
    path === '/acesso-negado'
    || path.startsWith('/acesso-negado')
    || path === '/chemflow/acesso-negado'
    || path.endsWith('/acesso-negado')
  ) {
    return true;
  }
  if (
    (path === '/painel/home' || path === '/painel' || path === '/painel/' || path === '/painel/configuracao' || path.startsWith('/painel/configuracao/'))
    && user.tipo !== 'externo'
  ) {
    return true;
  }
  const viewKey = getViewPermissionForPath(path);
  if (!viewKey) {
    return false;
  }
  return hasPermission(user, viewKey);
}

export function isReadOnly(user, path) {
  if (!user) return true;
  const viewKey = getViewPermissionForPath(path);
  if (!viewKey) return true;
  if (!hasPermission(user, viewKey)) return true;

  const resourceId = viewKey.replace(/\.view$/, '');
  const writeCandidates = [
    'create', 'edit', 'delete', 'create_op', 'edit_op',
    'register_test', 'release_production', 'issue_coa',
    'approve', 'manage_fds', 'complement', 'cancel', 'finish',
  ];
  return !writeCandidates.some((action) => hasPermission(user, permissionKey(resourceId, action)));
}

export function canUseClientFilter(user) {
  if (!user || user.tipo === 'externo') return false;
  return hasPermission(user, 'orders.view')
    || hasPermission(user, 'client_stock.view')
    || hasPermission(user, 'dashboard.view')
    || normalizeNivel(user) === 'administrador'
    || normalizeNivel(user) === 'supervisor'
    || normalizeNivel(user) === 'visualizacao';
}

export function getUserClient(user) {
  if (user?.tipo === 'externo') return user?.cliente || null;
  return null;
}

/** Comparação segura de cliente (case-insensitive, ignora espaços). */
export function matchesClient(item, client) {
  if (!client) return true;
  const itemClient = (item?.client || '').trim().toLowerCase();
  const target = (client || '').trim().toLowerCase();
  return Boolean(itemClient && target && itemClient === target);
}

export function getDefaultRoute(user) {
  if (!user) return '/login';
  return getDefaultRouteFromPermissions(resolvePermissions(user), user);
}

export function getRoleLabel(user) {
  if (!user) return '';
  if (user.perfil?.nome) return user.perfil.nome;
  if (user.tipo === 'externo') {
    return i18n.t('users.roles.externalClient');
  }
  const role = user.nivel_acesso || user.nivel || '';
  const key = ROLE_KEYS[role];
  if (key) return i18n.t(key);
  return role;
}

/** Administrador do sistema (perfil slug/id ou nível legado). */
export function isAdminUser(user) {
  if (!user) return false;
  const perfil = user.perfil;
  if (perfil?.slug === RBAC_ADMIN_SLUG || perfil?.id === 'perfil_administrador') {
    return true;
  }
  return normalizeNivel(user) === 'administrador';
}

export function getNivelOptionsForTipo(tipo) {
  if (tipo === 'externo') {
    return ['Visualização'];
  }
  return ['Administrador', 'Supervisor', 'Operacional', 'Visualização'];
}

export function canManageRecipeFds(user) {
  return hasPermission(user, 'recipes.manage_fds');
}

export function canRemoveRecipeFds(user) {
  return hasPermission(user, 'recipes.remove_fds');
}

export function canViewRecipeFds(user) {
  return hasPermission(user, 'recipes.view') || hasPermission(user, 'recipes.manage_fds');
}
