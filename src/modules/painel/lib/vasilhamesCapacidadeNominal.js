/**
 * Persistência da capacidade nominal por identidade física do tanque (placa/barril).
 * Tabela: t_vasilhames_capacidade_nominal
 *
 * Prioridade de uso (no motor de apuração):
 * 1. Registro confirmado (manual/cadastro confirmado)
 * 2. Inferência histórica / campo operacional (não sobrescreve confirmada)
 * 3. Definição manual pelo usuário
 */
import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';
import { sameTanqueIdentity } from '@transbordo/lib/vasilhameComposicao';

const TABLE = 't_vasilhames_capacidade_nominal';

export const CAPACIDADES_NOMINAIS_PADRAO = Object.freeze([1000, 1500, 5000]);

export const ORIGEM_CAPACIDADE = Object.freeze({
  MANUAL: 'manual',
  HISTORICO: 'historico',
  CADASTRO: 'cadastro',
});

function assertConfigured(context) {
  if (!isChemFlowConfigured || !chemflowSupabase) {
    throw new Error(`[${TABLE}:${context}] ${CHEMFLOW_CONFIG_ERROR}`);
  }
}

function throwIfError(error, context) {
  if (error) {
    throw new Error(`[${TABLE}:${context}] ${error.message || 'Erro no Supabase'}`);
  }
}

export function normalizePlaca(value) {
  return String(value || '').trim().toUpperCase();
}

export function normalizeBarril(value) {
  return String(value || '').trim().toUpperCase();
}

/** Chave estável PLACA|BARRIL (exige ao menos um identificador). */
export function buildTankIdentityKey(placa, barril) {
  const p = normalizePlaca(placa);
  const b = normalizeBarril(barril);
  if (!p && !b) return null;
  return `${p}|${b}`;
}

export function roundLiters(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

export function isCapacidadeConhecida(value, known = CAPACIDADES_NOMINAIS_PADRAO) {
  const n = roundLiters(value);
  if (n == null) return false;
  return (known || []).some((k) => Math.abs(Number(k) - n) < 0.5);
}

export function snapCapacidadeConhecida(value, known = CAPACIDADES_NOMINAIS_PADRAO) {
  const n = roundLiters(value);
  if (n == null) return null;
  const match = (known || []).find((k) => Math.abs(Number(k) - n) < 0.5);
  return match != null ? Number(match) : null;
}

function normalizeRow(row) {
  if (!row) return null;
  const capacidade = roundLiters(row.capacidade_litros);
  if (capacidade == null) return null;
  return {
    id: row.id,
    identity_key: row.identity_key || null,
    placa: row.placa || null,
    barril: row.barril || null,
    capacidade_litros: capacidade,
    origem: row.origem || ORIGEM_CAPACIDADE.MANUAL,
    confirmada: Boolean(row.confirmada),
    vasilhame_id: row.vasilhame_id || null,
    updated_by: row.updated_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export async function listCapacidadesNominais() {
  assertConfigured('list');
  const { data, error } = await chemflowSupabase.from(TABLE).select('*');
  throwIfError(error, 'list');
  return (data || []).map(normalizeRow).filter(Boolean);
}

/** Mapa identity_key → registro. */
export function indexCapacidadesByIdentity(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const key = row?.identity_key || buildTankIdentityKey(row?.placa, row?.barril);
    if (!key) continue;
    map.set(key, { ...row, identity_key: key });
  }
  return map;
}

export function findCapacidadeForTank(registryMap, placa, barril) {
  if (!registryMap) return null;
  const key = buildTankIdentityKey(placa, barril);
  if (key && registryMap.has(key)) return registryMap.get(key);

  for (const row of registryMap.values()) {
    if (sameTanqueIdentity(row.placa, row.barril, placa, barril)) return row;
  }
  return null;
}

/**
 * Upsert da capacidade nominal vinculada ao tanque físico.
 * Nunca permite que origem histórica sobrescreva um registro confirmado.
 */
export async function upsertCapacidadeNominal({
  placa,
  barril,
  capacidade_litros,
  origem = ORIGEM_CAPACIDADE.MANUAL,
  confirmada = true,
  vasilhame_id = null,
  updated_by = null,
  force = false,
} = {}) {
  assertConfigured('upsert');

  const identityKey = buildTankIdentityKey(placa, barril);
  if (!identityKey) {
    throw new Error('Informe placa ou número de barril para salvar a capacidade.');
  }

  const capacidade = snapCapacidadeConhecida(capacidade_litros) ?? roundLiters(capacidade_litros);
  if (capacidade == null) {
    throw new Error('Capacidade nominal inválida.');
  }

  const { data: existing, error: existingError } = await chemflowSupabase
    .from(TABLE)
    .select('*')
    .eq('identity_key', identityKey)
    .maybeSingle();
  throwIfError(existingError, 'upsert');

  if (existing?.confirmada && !force && origem === ORIGEM_CAPACIDADE.HISTORICO) {
    return normalizeRow(existing);
  }

  const payload = {
    identity_key: identityKey,
    placa: normalizePlaca(placa) || null,
    barril: normalizeBarril(barril) || null,
    capacidade_litros: capacidade,
    origem,
    confirmada: Boolean(confirmada),
    vasilhame_id: vasilhame_id || null,
    updated_by: updated_by ? String(updated_by) : null,
  };

  if (existing?.id) {
    const { data, error } = await chemflowSupabase
      .from(TABLE)
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single();
    throwIfError(error, 'upsert');
    return normalizeRow(data);
  }

  const { data, error } = await chemflowSupabase
    .from(TABLE)
    .insert(payload)
    .select('*')
    .single();
  throwIfError(error, 'upsert');
  return normalizeRow(data);
}
