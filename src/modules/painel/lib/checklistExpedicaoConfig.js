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
  checkDefsNomeKey,
} from '@painel/lib/carregamentoChecklistConfig';
import { clienteNomeKey } from '@transbordo/lib/saidaOrigem';
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

/** Cadastro de clientes indexado por nome (ids duplicados do mesmo nome) e por id. */
async function loadClienteIdIndex() {
  const idsByNome = new Map();
  const nomeById = new Map();
  try {
    const cadastro = (await entities.clientes.list()) || [];
    for (const row of cadastro) {
      const id = normalizeClienteId(row?.id);
      const nomeKey = clienteNomeKey(row?.nome);
      if (!id || !nomeKey) continue;
      nomeById.set(id, nomeKey);
      idsByNome.set(nomeKey, [...(idsByNome.get(nomeKey) || []), id]);
    }
  } catch {
    // Sem o cadastro, segue apenas com os ids/nomes informados.
  }
  return { idsByNome, nomeById };
}

function latestUpdatedAt(rows) {
  return rows.reduce((max, row) => {
    const stamp = String(row.updated_at || row.created_at || '');
    return stamp > max ? stamp : max;
  }, '');
}

/**
 * Carrega, em uma única query, as verificações configuradas dos clientes informados.
 *
 * O mesmo cliente pode existir mais de uma vez em `t_clientes` (ids duplicados com o
 * mesmo nome). Por isso a configuração é buscada em todos os ids do cliente e, havendo
 * mais de uma, vale a salva mais recentemente (a que a tela de Configuração editou).
 *
 * @param {Array<{ id?: string|null, nome?: string|null }>} clientes
 * @returns {Map<string, Array<{ key: string, label: string, section: string }>>}
 *   Chaves: id do cliente e `checkDefsNomeKey(nome)`.
 */
export async function listChecklistExpedicaoByClientes(clientes = []) {
  const map = new Map();
  const requested = (clientes || [])
    .map((c) => ({ id: normalizeClienteId(c?.id), nome: c?.nome }))
    .filter((c) => c.id || clienteNomeKey(c.nome));
  if (requested.length === 0) return map;

  if (!isChemFlowConfigured || !chemflowSupabase) {
    return map;
  }

  const { idsByNome, nomeById } = await loadClienteIdIndex();
  const groups = requested.map((c) => {
    const nomeKey = clienteNomeKey(c.nome) || (c.id && nomeById.get(c.id)) || '';
    const ids = new Set(nomeKey ? idsByNome.get(nomeKey) || [] : []);
    if (c.id) ids.add(c.id);
    return { id: c.id, nome: c.nome, ids };
  });
  const allIds = [...new Set(groups.flatMap((g) => [...g.ids]))];
  if (allIds.length === 0) return map;

  try {
    const { data, error } = await chemflowSupabase
      .from('t_checklist_expedicao_itens')
      .select('*')
      .in('cliente_id', allIds)
      .order('ordem', { ascending: true });

    if (error) throw error;
    tableAvailable = true;

    const byCliente = new Map();
    for (const row of data || []) {
      const cid = String(row.cliente_id);
      if (!byCliente.has(cid)) byCliente.set(cid, []);
      byCliente.get(cid).push(row);
    }

    for (const group of groups) {
      let best = null;
      for (const id of group.ids) {
        const rows = byCliente.get(id);
        if (!rows?.length) continue;
        const stamp = latestUpdatedAt(rows);
        if (!best || stamp > best.stamp) best = { rows, stamp };
      }
      const defs = best ? toCheckDefs(best.rows) : [];
      if (defs.length === 0) continue;
      if (group.id) map.set(group.id, defs);
      const nomeKey = checkDefsNomeKey(group.nome);
      if (nomeKey) map.set(nomeKey, defs);
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
