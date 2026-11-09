/**
 * Destinos da carga em solicitações de saída.
 *
 * Fonte canônica: tabela t_saida_destinos (Painel → Configuração → Destino Carregamentos).
 * Enquanto o SQL 057 não for aplicado, usa DESTINOS_SAIDA_FALLBACK.
 */

import { entities } from '@transbordo/services/entities';
import { chemflowSupabase, isChemFlowConfigured } from '@/services/supabase/chemflow';

/** Lista histórica usada enquanto o cadastro não existir no banco. */
export const DESTINOS_SAIDA_FALLBACK = Object.freeze([
  'Petrobras',
  'Petrorio',
  'Trident',
  'Total Energies',
  'Shell',
  'Equinor',
  'Derio',
  'Deaçu',
  'Modec',
  'BW',
  'KAROON',
  'YINSON',
]);

/** @deprecated Use DESTINOS_SAIDA_FALLBACK / listDestinosAtivosNomes(). Mantido por compatibilidade. */
export const DESTINOS_SAIDA = DESTINOS_SAIDA_FALLBACK;

/** Id da opção "Em branco" no seletor (nunca persistido). */
export const DESTINO_EM_BRANCO = '__em_branco__';

const TABLE_MISSING_MESSAGE =
  'A tabela de destinos ainda não existe no banco. Execute o script SQL 057_t_saida_destinos.sql no Supabase e recarregue a página.';

/** Cache em memória para normalizeDestino / opções síncronas. */
let destinosCache = [...DESTINOS_SAIDA_FALLBACK];

/**
 * Chave de comparação do destino (sem acentos, caixa e espaços duplicados).
 * @param {unknown} value
 * @returns {string}
 */
export function destinoKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeNome(nome) {
  return String(nome || '').trim().replace(/\s+/g, ' ');
}

function isTableMissingError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('pgrst205') ||
    msg.includes("could not find the table 'public.t_saida_destinos'") ||
    (msg.includes('t_saida_destinos') &&
      (msg.includes('does not exist') ||
        msg.includes('schema cache') ||
        msg.includes('could not find') ||
        msg.includes('relation')))
  );
}

function isVirtualDestino(destinoOrId) {
  if (!destinoOrId) return false;
  if (typeof destinoOrId === 'string') return destinoOrId.startsWith('virtual:');
  return Boolean(destinoOrId._virtual) || String(destinoOrId.id || '').startsWith('virtual:');
}

function virtualRow(nome, ativo = true) {
  return {
    id: `virtual:${nome}`,
    nome,
    ativo,
    _virtual: true,
  };
}

function setDestinosCache(nomes) {
  const cleaned = (nomes || []).map(normalizeNome).filter(Boolean);
  destinosCache = cleaned.length ? cleaned : [...DESTINOS_SAIDA_FALLBACK];
}

export function getDestinosCache() {
  return [...destinosCache];
}

/**
 * Nome canônico do destino ou string vazia quando não pertence à lista conhecida.
 * @param {unknown} value
 * @param {string[]} [knownList]
 * @returns {string}
 */
export function normalizeDestino(value, knownList) {
  const key = destinoKey(value);
  if (!key) return '';
  const list = Array.isArray(knownList) && knownList.length ? knownList : destinosCache;
  return list.find((nome) => destinoKey(nome) === key) || '';
}

/**
 * Opções do seletor de destino (síncrono a partir do cache).
 * Prefira listDestinosAtivosNomes() + getDestinoOptionsFromList em fluxos assíncronos.
 * @param {{ allowBlank?: boolean, excludeDestinoKeys?: string[], destinos?: string[] }} [opts]
 * @returns {Array<{ id: string, nome: string }>}
 */
export function getDestinoOptions({
  allowBlank = true,
  excludeDestinoKeys = [],
  destinos,
} = {}) {
  const source =
    Array.isArray(destinos) && destinos.length ? destinos : destinosCache;
  return getDestinoOptionsFromList(source, { allowBlank, excludeDestinoKeys });
}

/**
 * @param {string[]} nomes
 * @param {{ allowBlank?: boolean, excludeDestinoKeys?: string[] }} [opts]
 */
export function getDestinoOptionsFromList(
  nomes = [],
  { allowBlank = true, excludeDestinoKeys = [] } = {}
) {
  const exclude = new Set(
    (excludeDestinoKeys || []).map((k) => String(k ?? '').trim()).filter(Boolean)
  );
  const destinoOptions = (nomes || [])
    .map(normalizeNome)
    .filter((nome) => nome && !exclude.has(destinoKey(nome)))
    .map((nome) => ({ id: nome, nome }));
  if (!allowBlank) return destinoOptions;
  return [{ id: DESTINO_EM_BRANCO, nome: 'Em branco' }, ...destinoOptions];
}

export async function listDestinosCadastro() {
  try {
    const rows = await entities.saidaDestinos.list('nome');
    const sorted = (rows || []).sort((a, b) =>
      String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', {
        sensitivity: 'base',
      })
    );
    setDestinosCache(sorted.filter((r) => r.ativo !== false).map((r) => r.nome));
    return sorted;
  } catch (err) {
    if (!isTableMissingError(err)) throw err;
    setDestinosCache(DESTINOS_SAIDA_FALLBACK);
    return DESTINOS_SAIDA_FALLBACK.map((nome) => virtualRow(nome, true));
  }
}

/** Nomes ativos para dropdowns (Solicitação de Saída, Check List, etc.). */
export async function listDestinosAtivosNomes() {
  const rows = await listDestinosCadastro();
  if (!rows.length) {
    setDestinosCache(DESTINOS_SAIDA_FALLBACK);
    return [...DESTINOS_SAIDA_FALLBACK];
  }
  const nomes = rows
    .filter((r) => r.ativo !== false)
    .map((r) => normalizeNome(r.nome))
    .filter(Boolean);
  setDestinosCache(nomes.length ? nomes : DESTINOS_SAIDA_FALLBACK);
  return nomes.length ? nomes : [...DESTINOS_SAIDA_FALLBACK];
}

export async function createDestino(nome) {
  const trimmed = normalizeNome(nome);
  if (!trimmed) throw new Error('Informe o nome do destino.');
  try {
    const created = await entities.saidaDestinos.create({ nome: trimmed, ativo: true });
    await listDestinosAtivosNomes();
    return created;
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }
}

export async function updateDestino(id, payload) {
  if (isVirtualDestino(id)) throw new Error(TABLE_MISSING_MESSAGE);
  const next = { ...payload };
  if (next.nome != null) next.nome = normalizeNome(next.nome);
  try {
    const updated = await entities.saidaDestinos.update(id, next);
    await listDestinosAtivosNomes();
    return updated;
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }
}

/**
 * Renomeia o destino no cadastro e nos registros que guardam o nome
 * (t_saidas.destino e prazos do checklist por destino).
 */
export async function renameDestinoComHistorico(destino, novoNome) {
  if (isVirtualDestino(destino)) throw new Error(TABLE_MISSING_MESSAGE);

  const oldName = normalizeNome(destino?.nome);
  const nextName = normalizeNome(novoNome);
  if (!destino?.id) throw new Error('Destino inválido.');
  if (!nextName) throw new Error('Informe o nome do destino.');
  if (oldName.toLowerCase() === nextName.toLowerCase() && oldName === nextName) {
    return destino;
  }

  let updated;
  try {
    updated = await entities.saidaDestinos.update(destino.id, { nome: nextName });
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }

  if (oldName.toLowerCase() === nextName.toLowerCase()) {
    await listDestinosAtivosNomes();
    return updated;
  }

  if (!isChemFlowConfigured || !chemflowSupabase) {
    await listDestinosAtivosNomes();
    return updated;
  }

  try {
    const { data: saidas, error: sErr } = await chemflowSupabase
      .from('t_saidas')
      .select('id, destino')
      .ilike('destino', oldName);
    if (sErr) throw sErr;

    const saidaPatches = (saidas || [])
      .filter((row) => destinoKey(row.destino) === destinoKey(oldName))
      .map((row) => ({ id: row.id, destino: nextName }));
    if (saidaPatches.length > 0) {
      await entities.saidas.bulkUpdate(saidaPatches);
    }

    const { data: prazos, error: pErr } = await chemflowSupabase
      .from('t_checklist_expedicao_validade_destinos')
      .select('id, destino')
      .ilike('destino', oldName);
    if (pErr) throw pErr;

    const prazoPatches = (prazos || [])
      .filter((row) => destinoKey(row.destino) === destinoKey(oldName))
      .map((row) => ({ id: row.id, destino: nextName }));
    if (prazoPatches.length > 0) {
      await entities.checklistExpedicaoValidadeDestinos.bulkUpdate(prazoPatches);
    }
  } catch (err) {
    console.warn('[ChemFlow] Falha ao sincronizar nome do destino no histórico:', err);
  }

  await listDestinosAtivosNomes();
  return updated;
}

export async function deleteDestino(id) {
  if (isVirtualDestino(id)) throw new Error(TABLE_MISSING_MESSAGE);
  try {
    await entities.saidaDestinos.delete(id);
    await listDestinosAtivosNomes();
    return true;
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }
}

export async function setDestinoAtivo(id, ativo) {
  if (isVirtualDestino(id)) throw new Error(TABLE_MISSING_MESSAGE);
  try {
    const updated = await entities.saidaDestinos.update(id, { ativo: Boolean(ativo) });
    await listDestinosAtivosNomes();
    return updated;
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }
}
