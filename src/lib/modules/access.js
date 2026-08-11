import { APP_MODULES, MODULE_IDS, getModuleById } from '@/lib/modules/catalog';
import { getDefaultRoute, isAdminUser } from '@industrializacao/lib/permissions';

function normalizeModules(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((k) => typeof k === 'string' && k.trim());
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string' && k.trim()) : [];
    } catch {
      return [];
    }
  }
  return null;
}

/**
 * Módulos permitidos do usuário (do perfil).
 * Fallback pré-migration: admin → ambos; externo → []; demais → industrializacao.
 */
export function getUserModules(user) {
  if (!user) return [];
  if (user.tipo === 'externo') return [];

  const fromSession = normalizeModules(user.modules);
  if (fromSession !== null) {
    return fromSession;
  }

  // Compatibilidade até aplicar migration_perfil_modulos.sql
  if (isAdminUser(user)) {
    return [MODULE_IDS.INDUSTRIALIZACAO, MODULE_IDS.TRANSBORDO];
  }
  return [MODULE_IDS.INDUSTRIALIZACAO];
}

export function canAccessModule(user, moduleId) {
  if (!user || !moduleId) return false;
  return getUserModules(user).includes(moduleId);
}

export function getAccessibleModules(user) {
  const allowed = new Set(getUserModules(user));
  return APP_MODULES.filter((m) => allowed.has(m.id));
}

/** Hub pós-login: Painel Home (seleção de módulos). */
export const PAINEL_HOME_ROUTE = '/painel/home';

/**
 * Destino pós-login / guest redirect.
 * externo → portal cliente; internos → Painel (escolha de módulo).
 */
export function resolvePostLoginRoute(user) {
  if (!user) return '/login';
  if (user.tipo === 'externo') return '/tela-clientes';
  return PAINEL_HOME_ROUTE;
}

/**
 * Redirect quando a URL do módulo é bloqueada → volta ao hub do Painel.
 */
export function resolveModuleDeniedRedirect(user, _deniedModuleId) {
  if (!user) return '/login';
  if (user.tipo === 'externo') return '/tela-clientes';
  return PAINEL_HOME_ROUTE;
}

/**
 * Rota de entrada no módulo, respeitando RBAC interno.
 * Industrialização → primeira tela permitida (getDefaultRoute), não sempre `/`.
 */
export function resolveModuleEntryRoute(user, moduleId) {
  if (!user || !moduleId) return PAINEL_HOME_ROUTE;
  if (moduleId === MODULE_IDS.INDUSTRIALIZACAO) {
    return getDefaultRoute(user);
  }
  const mod = getModuleById(moduleId);
  return mod?.route || PAINEL_HOME_ROUTE;
}

export function getModuleHomeRoute(moduleId, user) {
  if (user) return resolveModuleEntryRoute(user, moduleId);
  return getModuleById(moduleId)?.route || PAINEL_HOME_ROUTE;
}

export { MODULE_IDS };
