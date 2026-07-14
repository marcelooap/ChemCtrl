import { callRPC } from '@/api/rpcClient';
import { base44 } from '@/api/base44Client';

export async function listProfiles() {
  try {
    const result = await callRPC('list_profiles', {});
    if (Array.isArray(result)) return result;
    if (result?.profiles) return result.profiles;
    if (result?.success === false) throw new Error(result.error || 'list_profiles failed');
  } catch (_) {
    // Fallback REST when RPC not deployed yet
  }
  return base44.entities.Perfil.list('nome', 200);
}

export async function getProfilePermissions(perfilId) {
  const result = await callRPC('get_profile_permissions', { p_perfil_id: perfilId });
  if (Array.isArray(result)) return result;
  if (result?.permissions) return result.permissions;
  if (result?.keys) return result.keys;
  return [];
}

export async function createProfile({ nome, descricao = '', status = 'Ativo' }) {
  return callRPC('create_profile', {
    p_nome: nome,
    p_descricao: descricao,
    p_status: status,
  });
}

export async function updateProfileMeta(perfilId, { nome, descricao, status }) {
  return callRPC('update_profile_meta', {
    p_perfil_id: perfilId,
    p_nome: nome,
    p_descricao: descricao,
    p_status: status,
  });
}

export async function replaceProfilePermissions(perfilId, keys) {
  return callRPC('replace_profile_permissions', {
    p_perfil_id: perfilId,
    p_permissions: keys,
  });
}

export async function duplicateProfile(perfilId, novoNome) {
  return callRPC('duplicate_profile', {
    p_perfil_id: perfilId,
    p_novo_nome: novoNome,
  });
}

export async function deleteProfile(perfilId) {
  return callRPC('delete_profile', {
    p_perfil_id: perfilId,
  });
}
