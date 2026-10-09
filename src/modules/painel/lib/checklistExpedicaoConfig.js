/**
 * Checklist de Expedição configurável por cliente.
 * Painel → Configuração → Check List Expedição
 */

import {
  chemflowSupabase,
  isChemFlowConfigured,
} from '@/services/supabase/chemflow';
import { entities } from '@transbordo/services/entities';
import {
  CONVENCIONAL_CHECKS,
  EMBALADO_CHECKS,
} from '@painel/lib/carregamentoChecklistConfig';
import { isMissingRpcError } from '@painel/lib/saidaReservas';
import { listNomesClientesIndustrializacao } from '@painel/lib/saidaClientes';
import { buildSaidaClienteOptions } from '@painel/lib/recebimentoCatalog';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RPC_SETUP_MESSAGE =
  'Execute o script 039_t_checklist_expedicao_itens.sql no SQL Editor do ChemFlow para habilitar o checklist de expedição por cliente.';

let tableAvailable = true;

export function isChecklistExpedicaoTableAvailable() {
  return tableAvailable;
}

function isTableMissingError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('pgrst205') ||
    msg.includes("could not find the table 'public.t_checklist_expedicao_itens'") ||
    (msg.includes('t_checklist_expedicao_itens') &&
      (msg.includes('does not exist') ||
        msg.includes('schema cache') ||
        msg.includes('could not find') ||
        msg.includes('relation')))
  );
}

function isPersistedId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

function normalizeClienteId(clienteId) {
  const id = String(clienteId || '').trim();
  return UUID_RE.test(id) ? id : null;
}

function sortByOrdem(rows = []) {
  return [...(rows || [])].sort((a, b) => {
    const oa = Number(a?.ordem) || 0;
    const ob = Number(b?.ordem) || 0;
    if (oa !== ob) return oa - ob;
    return String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
  });
}

/**
 * Converte linhas do banco em definições de verificação usadas no modal operacional.
 * @param {Array<{ id: string, descricao: string }>} rows
 * @returns {Array<{ key: string, label: string, section: string }>}
 */
export function toCheckDefs(rows = []) {
  return sortByOrdem(rows).map((row) => ({
    key: String(row.id),
    label: String(row.descricao || '').trim(),
    section: 'verificacoes',
  }));
}

/**
 * Descrições padrão (traduzidas) a partir dos checks hardcoded atuais.
 * Usado pelo botão "Usar itens padrão" na tela de configuração.
 */
export function getDefaultChecklistDescricoes(t) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const seen = new Set();
  const out = [];
  for (const def of [...CONVENCIONAL_CHECKS, ...EMBALADO_CHECKS]) {
    const label = String(translate(def.labelKey) || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export async function listChecklistExpedicaoItens(clienteId) {
  const id = normalizeClienteId(clienteId);
  if (!id) return [];
  try {
    const rows = await entities.checklistExpedicaoItens.filter({ cliente_id: id });
    tableAvailable = true;
    return sortByOrdem(rows);
  } catch (err) {
    if (isTableMissingError(err)) {
      tableAvailable = false;
      return [];
    }
    throw err;
  }
}

/**
 * Carrega itens de vários clientes em uma única query.
 * @returns {Map<string, Array<{ key: string, label: string, section: string }>>}
 */
export async function listChecklistExpedicaoByClienteIds(clienteIds = []) {
  const ids = [...new Set((clienteIds || []).map(normalizeClienteId).filter(Boolean))];
  const map = new Map();
  if (ids.length === 0) return map;

  if (!isChemFlowConfigured || !chemflowSupabase) {
    return map;
  }

  try {
    const { data, error } = await chemflowSupabase
      .from('t_checklist_expedicao_itens')
      .select('*')
      .in('cliente_id', ids)
      .order('ordem', { ascending: true });

    if (error) throw error;
    tableAvailable = true;

    const byCliente = new Map();
    for (const row of data || []) {
      const cid = String(row.cliente_id);
      if (!byCliente.has(cid)) byCliente.set(cid, []);
      byCliente.get(cid).push(row);
    }

    for (const [cid, rows] of byCliente) {
      const defs = toCheckDefs(rows);
      if (defs.length > 0) map.set(cid, defs);
    }
    return map;
  } catch (err) {
    if (isTableMissingError(err)) {
      tableAvailable = false;
      return map;
    }
    throw err;
  }
}

/**
 * Persiste a lista completa de itens de um cliente via RPC atômica.
 * @param {{ clienteId: string, itens: Array<{ id?: string, descricao: string }> }} args
 */
export async function saveChecklistExpedicao({ clienteId, itens = [] } = {}) {
  const id = normalizeClienteId(clienteId);
  if (!id) throw new Error('Selecione um cliente.');

  const payload = (itens || []).map((item, index) => {
    const descricao = String(item?.descricao || '').trim();
    if (!descricao) {
      const err = new Error('Descrição do item não pode ser vazia.');
      err.code = 'EMPTY_DESCRICAO';
      throw err;
    }
    const row = { descricao, ordem: index };
    if (isPersistedId(item?.id)) row.id = item.id;
    return row;
  });

  // Detecta duplicatas no cliente (case-insensitive)
  const seen = new Set();
  for (const row of payload) {
    const key = row.descricao.toLowerCase();
    if (seen.has(key)) {
      const err = new Error('Há itens com a mesma descrição.');
      err.code = 'DUPLICATE_DESCRICAO';
      throw err;
    }
    seen.add(key);
  }

  if (!isChemFlowConfigured || !chemflowSupabase) {
    throw new Error(RPC_SETUP_MESSAGE);
  }

  const { data, error } = await chemflowSupabase.rpc('t_salvar_checklist_expedicao', {
    p_cliente_id: id,
    p_itens: payload,
  });

  if (error) {
    if (isMissingRpcError(error) || isTableMissingError(error)) {
      tableAvailable = false;
      throw new Error(RPC_SETUP_MESSAGE);
    }
    throw new Error(error.message || 'Não foi possível salvar o checklist.');
  }

  tableAvailable = true;
  return sortByOrdem(data || []);
}

export function createTempItemId() {
  return `tmp:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isTempItemId(id) {
  return String(id || '').startsWith('tmp:');
}

/**
 * Clientes para a tela de configuração: cadastro Transbordo (deduplicado por nome)
 * + nomes usados na Industrialização e em produtos/estoque/vasilhames do Transbordo.
 * Espelha a união feita em Saída / Etiquetas.
 */
export async function listChecklistExpedicaoClientes() {
  const [clientesTb, nomesInd, produtos, estoque, vasilhames] = await Promise.all([
    entities.clientes.list('nome').catch(() => []),
    listNomesClientesIndustrializacao().catch(() => []),
    entities.produtos.list('produto', { select: 'cliente_nome' }).catch(() => []),
    entities.estoque.list('-created_at', { select: 'cliente_nome' }).catch(() => []),
    entities.vasilhames.list('-created_at', { select: 'cliente_nome' }).catch(() => []),
  ]);

  return buildSaidaClienteOptions(clientesTb, [
    ...(nomesInd || []),
    ...(produtos || []).map((p) => p.cliente_nome),
    ...(estoque || []).map((e) => e.cliente_nome),
    ...(vasilhames || []).map((v) => v.cliente_nome),
  ]);
}
