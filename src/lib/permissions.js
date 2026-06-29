// Role-based access control for ChemCtrl
// nivel_acesso: Administrador, Supervisor, Operacional, Visualização
// tipo: interno, externo

export function canAccessRoute(user, path) {
  if (!user) return false;

  // Externo: somente Tela Clientes
  if (user.tipo === 'externo') {
    return path === '/tela-clientes';
  }

  const nivel = (user.nivel || user.nivel_acesso || '').toLowerCase();

  if (nivel === 'administrador') return true;

  if (nivel === 'supervisor') {
    return path !== '/usuarios';
  }

  if (nivel === 'operacional' || nivel === 'operador') {
    return path === '/ordens' || path.startsWith('/producao/');
  }

  if (nivel === 'visualização' || nivel === 'visualizacao') {
    const allowed = ['/pedidos', '/vasilhames', '/tankagem', '/dashboard', '/estoque-cliente', '/inventario'];
    return allowed.includes(path);
  }

  return false;
}

export function isReadOnly(user) {
  const nivel = (user?.nivel || user?.nivel_acesso || '').toLowerCase();
  if (user?.tipo === 'externo') return true;
  return nivel === 'visualização' || nivel === 'visualizacao';
}

export function canUseClientFilter(user) {
  const nivel = (user?.nivel || user?.nivel_acesso || '').toLowerCase();
  return user?.tipo === 'interno' && ['administrador', 'supervisor'].includes(nivel);
}

export function getUserClient(user) {
  if (user?.tipo === 'externo') return user?.cliente || null;
  return null;
}

export function getDefaultRoute(user) {
  if (!user) return '/login';
  if (user.tipo === 'externo') return '/tela-clientes';
  const nivel = (user.nivel || user.nivel_acesso || '').toLowerCase();
  if (nivel === 'operacional' || nivel === 'operador') return '/ordens';
  if (nivel === 'visualização' || nivel === 'visualizacao') return '/pedidos';
  return '/';
}

export function getRoleLabel(user) {
  if (!user) return '';
  if (user.tipo === 'externo') return 'Cliente Externo';
  return user.nivel_acesso || user.nivel || '';
}

export function getNivelOptionsForTipo(tipo) {
  if (tipo === 'externo') {
    return ['Visualização'];
  }
  return ['Administrador', 'Supervisor', 'Operacional', 'Visualização'];
}
