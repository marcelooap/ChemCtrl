import i18n from '@/i18n';
import { ROLE_KEYS } from '@/i18n/domainMaps';

/**
 * Shared display helpers for the platform user menu.
 * Works for ChemCtrl and the ChemFlow module (same auth user shape).
 */

export function getUserDisplayName(user) {
  return user?.nome || user?.full_name || user?.nome_completo || i18n.t('common.defaultUser');
}

export function getUserFirstName(user) {
  const full = getUserDisplayName(user);
  return full.split(' ')[0] || full;
}

export function getSharedRoleLabel(user) {
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
