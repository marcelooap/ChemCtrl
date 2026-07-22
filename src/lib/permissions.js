import i18n from '@/i18n';
import { ROLE_KEYS } from '@/i18n/domainMaps';
import {
  getDefaultRouteFromPermissions,
  getLegacyPermissionsForUser,
  getViewPermissionForPath,
  permissionKey,
  RBAC_ADMIN_SLUG,
} from '@/lib/rbac/permissionCatalog';

function normalizeNivel(user) {
  return (user?.nivel || user?.nivel_acesso || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function resolvePermissions(user) {
  if (!user) return [];
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return user.permissions;
  }
  return getLegacyPermissionsForUser(user);
}

export function hasPermission(user, key) {
  return resolvePermissions(user).includes(key);
}

export function canAccessRoute(user, path) {
  if (!user) return false;
  if (path === '/acesso-negado' || path.startsWith('/acesso-negado')) return true;
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
