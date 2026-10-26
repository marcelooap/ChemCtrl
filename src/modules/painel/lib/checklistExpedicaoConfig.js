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
import {
  TESTE_LEGADO_NOME,
  VALIDADE_TESTES_PRAZO_PADRAO_DIAS,
  normalizeColorCod,
  normalizePrazoDias,
  normalizeTestesConfig,
  parsePrazoDias,
  validarPrazosPorDestino,
} from '@painel/lib/validadeTestesTanque';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RPC_SETUP_MESSAGE =
  'Execute o script 039_t_checklist_expedicao_itens.sql no SQL Editor do ChemFlow para habilitar o checklist de expedição por cliente.';

const TANQUE_VAZIO_RPC_SETUP_MESSAGE =
  'Execute o script 051_t_checklist_expedicao_tanque_vazio.sql no SQL Editor do ChemFlow para habilitar o checklist de tanque vazio.';

let tanqueVazioColumnAvailable = true;

export function isChecklistExpedicaoTanqueVazioAvailable() {
  return tanqueVazioColumnAvailable;
}

const CONFIG_RPC_SETUP_MESSAGE =
  'Execute o script 040_t_checklist_expedicao_config.sql no SQL Editor do ChemFlow para habilitar a verificação da validade dos testes.';

const DESTINOS_RPC_SETUP_MESSAGE =
  'Execute o script 042_t_checklist_expedicao_validade_destinos.sql (e 043_t_checklist_expedicao_validade_destinos_color_cod.sql) no SQL Editor do ChemFlow para habilitar os prazos de validade por destino.';

const TESTES_RPC_SETUP_MESSAGE =
  'Execute o script 044_t_checklist_expedicao_validade_testes.sql no SQL Editor do ChemFlow para habilitar os testes de verificação por destino.';

const VALIDADE_RPC_SETUP_MESSAGE =
  'Execute o script 054_t_checklist_expedicao_validade_testes_validade.sql no SQL Editor do ChemFlow para gravar a validade de cada teste.';

let tableAvailable = true;
let configTableAvailable = true;
let destinosTableAvailable = true;
let testesColumnAvailable = true;

export function isChecklistExpedicaoTableAvailable() {
  return tableAvailable;
}

export function isChecklistExpedicaoConfigAvailable() {
  return configTableAvailable;
}

export function isChecklistExpedicaoDestinosAvailable() {
  return destinosTableAvailable;
}

export function isChecklistExpedicaoTestesAvailable() {
  return testesColumnAvailable;
}

/** A coluna `testes` só existe depois do script 044. Linhas antigas não trazem a chave. */
function noteTestesColumn(rows) {
  if (!rows?.length) return;
  testesColumnAvailable = rows.some(
    (row) => row != null && Object.prototype.hasOwnProperty.call(row, 'testes')
  );
}

/**
 * Testes do destino. Sem a coluna nova, o prazo único antigo vira um teste
 * para a conferência não sumir antes da migração.
 */
function testesFromDestinoRow(row) {
  if (row != null && Object.prototype.hasOwnProperty.call(row, 'testes')) {
    return normalizeTestesConfig(row.testes);
  }
  const dias = parsePrazoDias(row?.prazo_validade_testes_dias);
  return dias == null ? [] : [{ nome: TESTE_LEGADO_NOME, dias }];
}

function isMissingTableError(err, table) {
  const msg = String(err?.message || err || '').toLowerCase();
  const name = String(table || '').toLowerCase();
  if (!name || !msg.includes(name)) return false;
  // "column … does not exist" é coluna ausente, não tabela ausente.
  if (/\bcolumn\b/.test(msg)) return false;
  return (
    msg.includes('pgrst205') ||
    msg.includes('could not find the table') ||
    (msg.includes('schema cache') && msg.includes('table')) ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

function isConfigTableMissingError(err) {
  return isMissingTableError(err, 't_checklist_expedicao_config');
}

function isDestinosTableMissingError(err) {
  return isMissingTableError(err, 't_checklist_expedicao_validade_destinos');
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

function isTanqueVazioColumnMissingError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('tanque_vazio') &&
    (msg.includes('column') ||
      msg.includes('pgrst204') ||
      msg.includes('could not find') ||
      msg.includes('schema cache') ||
      msg.includes('does not exist'))
  );
}

function filterItensByTanqueVazio(rows = [], tanqueVazio = false) {
  const want = Boolean(tanqueVazio);
  return (rows || []).filter((row) => {
    if (row == null || !Object.prototype.hasOwnProperty.call(row, 'tanque_vazio')) {
      return !want;
    }
    return Boolean(row.tanque_vazio) === want;
  });
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

/**
 * Itens do checklist de um cliente.
 * @param {string} clienteId
 * @param {{ tanqueVazio?: boolean }} [opts]
 */
export async function listChecklistExpedicaoItens(clienteId, opts = {}) {
  const id = normalizeClienteId(clienteId);
  if (!id) return [];
  const tanqueVazio = Boolean(opts.tanqueVazio);
  try {
    if (tanqueVazioColumnAvailable) {
      const rows = await entities.checklistExpedicaoItens.filter({
        cliente_id: id,
        tanque_vazio: tanqueVazio,
      });
      tableAvailable = true;
      tanqueVazioColumnAvailable = true;
      return sortByOrdem(rows);
    }
    if (tanqueVazio) return [];
    const rows = await entities.checklistExpedicaoItens.filter({ cliente_id: id });
    tableAvailable = true;
    return sortByOrdem(filterItensByTanqueVazio(rows, false));
  } catch (err) {
    if (isTableMissingError(err)) {
      tableAvailable = false;
      return [];
    }
    if (isTanqueVazioColumnMissingError(err)) {
      tanqueVazioColumnAvailable = false;
      if (tanqueVazio) return [];
      const rows = await entities.checklistExpedicaoItens.filter({ cliente_id: id });
      tableAvailable = true;
      return sortByOrdem(rows);
    }
    throw err;
  }
}

/**
 * Configuração padrão: verificação da validade dos testes desativada, prazo de 180 dias
 * e nenhum prazo específico por destino.
 */
export const DEFAULT_VALIDADE_TESTES_CONFIG = Object.freeze({
  ativo: false,
  dias: VALIDADE_TESTES_PRAZO_PADRAO_DIAS,
  prazosPorDestino: Object.freeze([]),
});

/** Linhas de destino do banco → `[{ destino, color_cod, testes }]` na ordem de cadastro. */
function toPrazosPorDestino(rows = []) {
  noteTestesColumn(rows);
  return [...(rows || [])]
    .sort((a, b) => String(a?.created_at || '').localeCompare(String(b?.created_at || '')))
    .map((row) => ({
      destino: String(row.destino || '').trim(),
      color_cod: normalizeColorCod(row.color_cod),
      testes: testesFromDestinoRow(row),
    }))
    .filter((row) => row.destino);
}

/** Linha do banco → `{ ativo, dias, prazosPorDestino }` usado pela interface. */
function toValidadeTestesConfig(row, destinoRows = []) {
  return {
    ativo: Boolean(row?.verificar_validade_testes),
    dias: normalizePrazoDias(row?.prazo_validade_testes_dias),
    prazosPorDestino: toPrazosPorDestino(destinoRows),
  };
}

/** Prazos por destino ausentes (tabela não criada) equivalem a "nenhum cadastrado". */
async function listPrazosDestinoRows(clienteId) {
  try {
    const rows = await entities.checklistExpedicaoValidadeDestinos.filter({
      cliente_id: clienteId,
    });
    destinosTableAvailable = true;
    return rows || [];
  } catch (err) {
    if (isDestinosTableMissingError(err)) {
      destinosTableAvailable = false;
      return [];
    }
    throw err;
  }
}

/**
 * Configuração da validade dos testes de um cliente (padrão quando não há registro).
 * @returns {Promise<{ ativo: boolean, dias: number, prazosPorDestino: Array<{ destino: string, color_cod: string|null, testes: Array<{ nome: string, dias: number }> }> }>}
 */
export async function getChecklistExpedicaoConfig(clienteId) {
  const id = normalizeClienteId(clienteId);
  if (!id) return { ...DEFAULT_VALIDADE_TESTES_CONFIG };
  try {
    const [rows, destinoRows] = await Promise.all([
      entities.checklistExpedicaoConfig.filter({ cliente_id: id }),
      listPrazosDestinoRows(id),
    ]);
    configTableAvailable = true;
    return rows?.[0]
      ? toValidadeTestesConfig(rows[0], destinoRows)
      : { ...DEFAULT_VALIDADE_TESTES_CONFIG };
  } catch (err) {
    if (isConfigTableMissingError(err)) {
      configTableAvailable = false;
      return { ...DEFAULT_VALIDADE_TESTES_CONFIG };
    }
    throw err;
  }
}

/**
 * Substitui os prazos por destino de um cliente (RPC atômica). Exige a configuração
 * do cliente já gravada (FK), por isso é chamada após `t_salvar_checklist_expedicao_config`.
 */
async function savePrazosPorDestino(clienteId, items) {
  // Nada a gravar e a tabela nem existe: não bloqueia quem não usa o recurso.
  if (items.length === 0 && !destinosTableAvailable) return [];

  const { data, error } = await chemflowSupabase.rpc(
    't_salvar_checklist_expedicao_validade_destinos',
    {
      p_cliente_id: clienteId,
      p_prazos: items.map(({ destino, color_cod, testes }) => ({
        destino,
        // Coluna legada, ainda obrigatória: guarda o maior prazo dos testes do destino.
        dias:
          (testes || []).reduce((max, teste) => Math.max(max, teste.dias), 0) ||
          VALIDADE_TESTES_PRAZO_PADRAO_DIAS,
        color_cod: color_cod || null,
        testes: (testes || []).map(({ nome, dias, validade }) => ({
          nome,
          prazo_dias: dias,
          validade_dias: validade,
        })),
      })),
    }
  );

  if (error) {
    if (isMissingRpcError(error) || isDestinosTableMissingError(error)) {
      destinosTableAvailable = false;
      throw new Error(DESTINOS_RPC_SETUP_MESSAGE);
    }
    throw new Error(error.message || 'Não foi possível salvar os testes por destino.');
  }

  destinosTableAvailable = true;
  const returned = data || [];
  const sentCount = items.reduce((total, item) => total + (item.testes?.length || 0), 0);
  const gotCount = returned.reduce(
    (total, row) => total + (Array.isArray(row?.testes) ? row.testes.length : 0),
    0
  );
  if (sentCount > 0 && gotCount === 0) {
    testesColumnAvailable = false;
    throw new Error(TESTES_RPC_SETUP_MESSAGE);
  }
  if (!validadeFoiPersistida(items, returned)) {
    throw new Error(VALIDADE_RPC_SETUP_MESSAGE);
  }
  return returned;
}

/**
 * A função antiga grava só nome e prazo e descarta `validade_dias`.
 * Se o valor enviado não voltar, o script 054 ainda não foi executado.
 */
function validadeFoiPersistida(items, returned) {
  const savedByKey = new Map();
  for (const row of returned || []) {
    const destino = String(row?.destino || '').trim().toLowerCase();
    for (const teste of Array.isArray(row?.testes) ? row.testes : []) {
      savedByKey.set(`${destino}|${String(teste?.nome || '').trim().toLowerCase()}`, teste);
    }
  }
  for (const item of items || []) {
    const destino = String(item?.destino || '').trim().toLowerCase();
    for (const teste of item.testes || []) {
      if (teste?.validade == null) continue;
      const saved = savedByKey.get(
        `${destino}|${String(teste?.nome || '').trim().toLowerCase()}`
      );
      if (parsePrazoDias(saved?.validade_dias) !== teste.validade) return false;
    }
  }
  return true;
}

/**
 * Persiste a configuração da validade dos testes de um cliente (RPC com validação no banco).
 * Quando `prazosPorDestino` é informado, também substitui os prazos por destino do cliente;
 * quando omitido, os prazos por destino existentes não são alterados.
 *
 * @param {{
 *   clienteId: string,
 *   ativo: boolean,
 *   dias: number|string,
 *   prazosPorDestino?: Array<{ destino: string, color_cod?: string|null, testes: Array<{ nome: string, dias: number }> }>,
 * }} args
 * @returns {Promise<{ ativo: boolean, dias: number, prazosPorDestino: Array<{ destino: string, color_cod: string|null, testes: Array<{ nome: string, dias: number }> }> }>}
 */
export async function saveChecklistExpedicaoConfig({
  clienteId,
  ativo,
  dias,
  prazosPorDestino,
} = {}) {
  const id = normalizeClienteId(clienteId);
  if (!id) throw new Error('Selecione um cliente.');

  const prazo = parsePrazoDias(dias);
  if (prazo == null) {
    const err = new Error('Informe um prazo de validade entre 1 e 3650 dias.');
    err.code = 'INVALID_PRAZO';
    throw err;
  }

  let destinoItems = null;
  if (Array.isArray(prazosPorDestino)) {
    const validation = validarPrazosPorDestino(prazosPorDestino);
    if (!validation.ok) {
      const err = new Error('Revise os prazos por destino.');
      err.code = validation.errors[0].code;
      throw err;
    }
    destinoItems = validation.items;
  }

  if (!isChemFlowConfigured || !chemflowSupabase) {
    throw new Error(CONFIG_RPC_SETUP_MESSAGE);
  }

  const { data, error } = await chemflowSupabase.rpc('t_salvar_checklist_expedicao_config', {
    p_cliente_id: id,
    p_verificar_validade_testes: Boolean(ativo),
    p_prazo_validade_testes_dias: prazo,
  });

  if (error) {
    if (isMissingRpcError(error) || isConfigTableMissingError(error)) {
      configTableAvailable = false;
      throw new Error(CONFIG_RPC_SETUP_MESSAGE);
    }
    throw new Error(error.message || 'Não foi possível salvar a configuração.');
  }

  configTableAvailable = true;
  const destinoRows = destinoItems
    ? await savePrazosPorDestino(id, destinoItems)
    : await listPrazosDestinoRows(id);
  return toValidadeTestesConfig(data, destinoRows);
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
 * Agrupa os clientes informados com todos os ids de `t_clientes` que compartilham o
 * mesmo nome (o cadastro pode ter ids duplicados).
 */
async function resolveClienteGroups(clientes = []) {
  const requested = (clientes || [])
    .map((c) => ({ id: normalizeClienteId(c?.id), nome: c?.nome }))
    .filter((c) => c.id || clienteNomeKey(c.nome));
  if (requested.length === 0) return { groups: [], allIds: [] };

  const { idsByNome, nomeById } = await loadClienteIdIndex();
  const groups = requested.map((c) => {
    const nomeKey = clienteNomeKey(c.nome) || (c.id && nomeById.get(c.id)) || '';
    const ids = new Set(nomeKey ? idsByNome.get(nomeKey) || [] : []);
    if (c.id) ids.add(c.id);
    return { id: c.id, nome: c.nome, ids };
  });
  const allIds = [...new Set(groups.flatMap((g) => [...g.ids]))];
  return { groups, allIds };
}

/** Entre os ids do grupo, escolhe as linhas salvas mais recentemente. */
function pickLatestRows(group, rowsByCliente) {
  let best = null;
  for (const id of group.ids) {
    const rows = rowsByCliente.get(id);
    if (!rows?.length) continue;
    const stamp = latestUpdatedAt(rows);
    if (!best || stamp > best.stamp) best = { rows, stamp };
  }
  return best?.rows || null;
}

function groupByClienteId(rows = []) {
  const byCliente = new Map();
  for (const row of rows || []) {
    const cid = String(row.cliente_id);
    if (!byCliente.has(cid)) byCliente.set(cid, []);
    byCliente.get(cid).push(row);
  }
  return byCliente;
}

function setForGroup(map, group, value) {
  if (group.id) map.set(group.id, value);
  const nomeKey = checkDefsNomeKey(group.nome);
  if (nomeKey) map.set(nomeKey, value);
}

async function fetchItensRows(allIds) {
  try {
    const { data, error } = await chemflowSupabase
      .from('t_checklist_expedicao_itens')
      .select('*')
      .in('cliente_id', allIds)
      .order('ordem', { ascending: true });
    if (error) throw error;
    tableAvailable = true;
    return data || [];
  } catch (err) {
    if (isTableMissingError(err)) {
      tableAvailable = false;
      return [];
    }
    throw err;
  }
}

/** Configuração ausente (tabela não criada) equivale a "verificação desativada". */
async function fetchConfigRows(allIds) {
  try {
    const { data, error } = await chemflowSupabase
      .from('t_checklist_expedicao_config')
      .select('*')
      .in('cliente_id', allIds);
    if (error) throw error;
    configTableAvailable = true;
    return data || [];
  } catch (err) {
    if (isConfigTableMissingError(err)) {
      configTableAvailable = false;
      return [];
    }
    throw err;
  }
}

/** Prazos por destino ausentes (tabela não criada) equivalem a "nenhum cadastrado". */
async function fetchDestinoRows(allIds) {
  try {
    const { data, error } = await chemflowSupabase
      .from('t_checklist_expedicao_validade_destinos')
      .select('*')
      .in('cliente_id', allIds);
    if (error) throw error;
    destinosTableAvailable = true;
    return data || [];
  } catch (err) {
    if (isDestinosTableMissingError(err)) {
      destinosTableAvailable = false;
      return [];
    }
    throw err;
  }
}

/**
 * Carrega, em uma única ida ao banco por tabela, a configuração operacional dos
 * clientes informados: verificações do checklist e validade dos testes do tanque
 * (prazo único e prazos por destino).
 *
 * O mesmo cliente pode existir mais de uma vez em `t_clientes` (ids duplicados com o
 * mesmo nome). Por isso a configuração é buscada em todos os ids do cliente e, havendo
 * mais de uma, vale a salva mais recentemente (a que a tela de Configuração editou).
 *
 * @param {Array<{ id?: string|null, nome?: string|null }>} clientes
 * @returns {Promise<{
 *   checkDefs: Map<string, Array<{ key: string, label: string, section: string }>>,
 *   checkDefsTanqueVazio: Map<string, Array<{ key: string, label: string, section: string }>>,
 *   validadeTestes: Map<string, { ativo: boolean, dias: number, prazosPorDestino: Array<{ destino: string, color_cod: string|null, testes: Array<{ nome: string, dias: number }> }> }>,
 * }>} Chaves dos mapas: id do cliente e `checkDefsNomeKey(nome)`.
 */
export async function loadChecklistExpedicaoOperacional(clientes = []) {
  const checkDefs = new Map();
  const checkDefsTanqueVazio = new Map();
  const validadeTestes = new Map();
  const result = { checkDefs, checkDefsTanqueVazio, validadeTestes };

  if (!isChemFlowConfigured || !chemflowSupabase) return result;

  const { groups, allIds } = await resolveClienteGroups(clientes);
  if (allIds.length === 0) return result;

  const [itensRows, configRows, destinoRows] = await Promise.all([
    fetchItensRows(allIds),
    fetchConfigRows(allIds),
    fetchDestinoRows(allIds),
  ]);
  if (
    itensRows.length > 0 &&
    !Object.prototype.hasOwnProperty.call(itensRows[0], 'tanque_vazio')
  ) {
    tanqueVazioColumnAvailable = false;
  }
  const itensByCliente = groupByClienteId(itensRows);
  const configByCliente = groupByClienteId(configRows);
  const destinosByCliente = groupByClienteId(destinoRows);

  for (const group of groups) {
    const itens = pickLatestRows(group, itensByCliente) || [];
    const defsCheio = toCheckDefs(filterItensByTanqueVazio(itens, false));
    if (defsCheio.length > 0) setForGroup(checkDefs, group, defsCheio);
    const defsVazio = toCheckDefs(filterItensByTanqueVazio(itens, true));
    if (defsVazio.length > 0) setForGroup(checkDefsTanqueVazio, group, defsVazio);

    // Os prazos por destino pertencem ao mesmo id de cliente da configuração escolhida.
    const config = pickLatestRows(group, configByCliente)?.[0];
    if (config) {
      const prazos = destinosByCliente.get(String(config.cliente_id)) || [];
      setForGroup(validadeTestes, group, toValidadeTestesConfig(config, prazos));
    }
  }
  return result;
}

/**
 * Verificações configuradas dos clientes informados (sem a validade dos testes).
 * @see loadChecklistExpedicaoOperacional
 */
export async function listChecklistExpedicaoByClientes(clientes = []) {
  return (await loadChecklistExpedicaoOperacional(clientes)).checkDefs;
}

/**
 * Persiste a lista de itens de um cliente via RPC atômica (um tipo por chamada).
 * @param {{ clienteId: string, itens: Array<{ id?: string, descricao: string }>, tanqueVazio?: boolean }} args
 */
export async function saveChecklistExpedicao({
  clienteId,
  itens = [],
  tanqueVazio = false,
} = {}) {
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

  if (tanqueVazio && !tanqueVazioColumnAvailable) {
    throw new Error(TANQUE_VAZIO_RPC_SETUP_MESSAGE);
  }

  const { data, error } = await chemflowSupabase.rpc('t_salvar_checklist_expedicao', {
    p_cliente_id: id,
    p_itens: payload,
    p_tanque_vazio: Boolean(tanqueVazio),
  });

  if (error) {
    if (isTanqueVazioColumnMissingError(error) || /p_tanque_vazio|051_t_checklist/i.test(String(error.message || ''))) {
      tanqueVazioColumnAvailable = false;
      throw new Error(TANQUE_VAZIO_RPC_SETUP_MESSAGE);
    }
    if (isMissingRpcError(error) || isTableMissingError(error)) {
      tableAvailable = false;
      throw new Error(RPC_SETUP_MESSAGE);
    }
    throw new Error(error.message || 'Não foi possível salvar o checklist.');
  }

  tableAvailable = true;
  tanqueVazioColumnAvailable = true;
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
