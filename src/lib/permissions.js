import i18n from '@/i18n';
import { ROLE_KEYS } from '@/i18n/domainMaps';

// Role-based access control for ChemCtrl
// nivel_acesso: Administrador, Supervisor, Operacional, Visualização
// tipo: interno, externo

export function canAccessRoute(user, path) {
  if (!user) return false;

  if (user.tipo === 'externo') {
    return path === '/tela-clientes' || path === '/notificacoes';
  }

  const nivel = (user.nivel || user.nivel_acesso || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (nivel === 'administrador') return true;

  if (nivel === 'supervisor') {
    return path !== '/usuarios';
  }

  if (nivel === 'operacional' || nivel === 'operador') {
    return path === '/ordens' || path.startsWith('/producao/') ||
      path === '/inventario' || path.startsWith('/inventario/') ||
      path === '/vasilhames' || path === '/estoque' || path === '/notificacoes';
  }

  if (nivel === 'visualizacao') {
    const allowed = ['/pedidos', '/vasilhames', '/tankagem', '/estoque-cliente', '/qualidade/coa', '/notificacoes'];
    return allowed.includes(path);
  }

  return false;
}

export function isReadOnly(user, path) {
  const nivel = (user?.nivel || user?.nivel_acesso || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (user?.tipo === 'externo') return true;
  if (nivel === 'visualizacao') return true;
  if (nivel === 'operacional' || nivel === 'operador') {
    return ['/vasilhames', '/estoque'].includes(path);
  }
  return false;
}

export function canUseClientFilter(user) {
  const nivel = (user?.nivel || user?.nivel_acesso || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return user?.tipo === 'interno' && ['administrador', 'supervisor', 'visualizacao'].includes(nivel);
}

export function getUserClient(user) {
  if (user?.tipo === 'externo') return user?.cliente || null;
  return null;
}

export function getDefaultRoute(user) {
  if (!user) return '/login';
  if (user.tipo === 'externo') return '/tela-clientes';
  const nivel = (user.nivel || user.nivel_acesso || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (nivel === 'operacional' || nivel === 'operador') return '/ordens';
  if (nivel === 'visualizacao') return '/vasilhames';
  return '/';
}

export function getRoleLabel(user) {
  if (!user) return '';
  if (user.tipo === 'externo') {
    return i18n.t('users.roles.externalClient');
  }
  const role = user.nivel_acesso || user.nivel || '';
  const key = ROLE_KEYS[role];
  if (key) return i18n.t(key);
  return role;
}

export function getNivelOptionsForTipo(tipo) {
  if (tipo === 'externo') {
    return ['Visualização'];
  }
  return ['Administrador', 'Supervisor', 'Operacional', 'Visualização'];
}
