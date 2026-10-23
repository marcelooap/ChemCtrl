/**
 * Único acesso do aplicativo à tabela estoque_produtos.
 * Entrada, estoque de armazenagem e matéria-prima são a mesma tabela,
 * separadas por origem e pelo papel de cada tela.
 */
import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';
import { parseDensidade } from '@transbordo/lib/format';

const TABLE = 'estoque_produtos';

function assertConfigured(context) {
  if (!isChemFlowConfigured || !chemflowSupabase) {
    throw new Error(`[estoque_produtos:${context}] ${CHEMFLOW_CONFIG_ERROR}`);
  }
}

function throwIfError(error, context) {
  if (error) {
    throw new Error(`[estoque_produtos:${context}] ${error.message || 'Erro no Supabase'}`);
  }
}

function nullIfEmpty(value) {
  if (value === '' || value === undefined) return null;
  return value;
}

/** Converte densidade exibida em PT-BR para numeric do Postgres. */
function densidadeForDb(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!s || s === '-') return null;
  const n = parseDensidade(value);
  return Number.isFinite(n) ? n : null;
}

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function origemCanon(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'MATERIA_PRIMA' || raw === 'INDUSTRIALIZACAO') return 'MATERIA_PRIMA';
  if (!raw) return null;
  return 'ARMAZENAGEM';
}

function isSharedEntradaId(value) {
  return /^E[1-9]\d*$/.test(String(value || '').trim().toUpperCase());
}

function isMateriaPrimaRow(row) {
  return origemCanon(row?.origem) === 'MATERIA_PRIMA';
}

/** Quantidade recebida: em MP o campo canônico é initial_stock. */
function receivedQty(row) {
  if (isMateriaPrimaRow(row) && row?.initial_stock != null && row.initial_stock !== '') {
    return row.initial_stock;
  }
  return row?.quantidade;
}

function loteIdentityKey(row) {
  return [
    String(row?.lote || '').trim().toLowerCase(),
    String(row?.produto_codigo || '').trim().toLowerCase(),
    String(row?.produto_nome || '').trim().toLowerCase(),
  ].join('|');
}

function findUnifiableMpRow(existing, hint) {
  const key = loteIdentityKey(hint);
  const candidates = (existing || []).filter((row) => {
    if (String(row.grupo_entrada || '').startsWith('TB')) return false;
    if (!isMateriaPrimaRow(row)) return false;
    return loteIdentityKey(row) === key;
  });
  if (candidates.length === 0 && !String(hint?.lote || '').trim()) {
    const onlyMp = (existing || []).filter(
      (row) => isMateriaPrimaRow(row) && !String(row.grupo_entrada || '').startsWith('TB')
    );
    return onlyMp.length === 1 ? onlyMp[0] : null;
  }
  return (
    candidates.find((row) => row.legacy_mp_id_text) ||
    candidates[0] ||
    null
  );
}

/**
 * Pares inválidos: linha de MP + espelho da mesma entrada/lote.
 * Vários itens de armazenagem com o mesmo lote (tanques/embalagens) não entram aqui.
 */
async function collapseMpMirrors(lines) {
  const byKey = new Map();
  for (const row of lines || []) {
    const key = loteIdentityKey(row);
    const list = byKey.get(key) || [];
    list.push(row);
    byKey.set(key, list);
  }
  const kept = [];
  for (const list of byKey.values()) {
    const mpRows = list.filter((row) => row.legacy_mp_id_text);
    const mirrors = list.filter((row) => !row.legacy_mp_id_text && isMateriaPrimaRow(row));
    if (mpRows.length !== 1 || mirrors.length === 0) {
      kept.push(...list);
      continue;
    }
    const keep = { ...mpRows[0] };
    for (const ghost of mirrors) {
      const patch = {};
      if (!keep.legacy_estoque_id && ghost.legacy_estoque_id) {
        patch.legacy_estoque_id = ghost.legacy_estoque_id;
      }
      if (!keep.vasilhame_id && ghost.vasilhame_id) {
        patch.vasilhame_id = ghost.vasilhame_id;
      }
      if (Object.keys(patch).length > 0) {
        if (ghost.legacy_estoque_id && patch.legacy_estoque_id) {
          const { error: clearError } = await chemflowSupabase
            .from(TABLE)
            .update(stamp({ legacy_estoque_id: null }))
            .eq('id', ghost.id);
          throwIfError(clearError, 'collapse.clear_estoque_id');
        }
        const { data, error } = await chemflowSupabase
          .from(TABLE)
          .update(stamp(patch))
          .eq('id', keep.id)
          .select()
          .single();
        throwIfError(error, 'collapse.keep');
        Object.assign(keep, data || patch);
      }
      const { error: deleteError } = await chemflowSupabase.from(TABLE).delete().eq('id', ghost.id);
      throwIfError(deleteError, 'collapse.delete');
    }
    kept.push(keep);
  }
  return kept;
}

async function linesForEntrada(lines) {
  try {
    return await collapseMpMirrors(lines);
  } catch (err) {
    console.error('[estoque_produtos] collapse mirrors:', err);
    const mpKeys = new Set(
      (lines || []).filter((row) => row.legacy_mp_id_text).map(loteIdentityKey)
    );
    return (lines || []).filter((row) => {
      if (row.legacy_mp_id_text) return true;
      if (!isMateriaPrimaRow(row)) return true;
      return !mpKeys.has(loteIdentityKey(row));
    });
  }
}

async function nextEntradaId() {
  assertConfigured('next_entrada_id');
  const { data, error } = await chemflowSupabase.rpc('next_entrada_id');
  throwIfError(error, 'next_entrada_id');
  const id = String(data || '').trim().toUpperCase();
  if (!isSharedEntradaId(id)) {
    throw new Error('Não foi possível gerar o id_entrada.');
  }
  return id;
}

function orderOf(sort, columnMap = {}) {
  if (!sort) return { column: 'created_at', ascending: false };
  const ascending = !String(sort).startsWith('-');
  const field = String(sort).replace(/^-/, '');
  const shared = { created_date: 'created_at', updated_date: 'updated_at' };
  return { column: columnMap[field] || shared[field] || field, ascending };
}

async function fetchAll(decorate, { limit } = {}) {
  assertConfigured('select');
  const pageSize = 1000;
  const cap = Number(limit) > 0 ? Number(limit) : Number.POSITIVE_INFINITY;
  const all = [];
  for (let from = 0; all.length < cap; from += pageSize) {
    const size = Math.min(pageSize, cap - all.length);
    const builder = decorate(chemflowSupabase.from(TABLE).select('*'))
      .order('id', { ascending: true })
      .range(from, from + size - 1);
    const { data, error } = await builder;
    throwIfError(error, 'select');
    const rows = data || [];
    all.push(...rows);
    if (rows.length < size) break;
  }
  return all;
}

function stamp(patch) {
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key] = value;
  }
  next.updated_at = new Date().toISOString();
  return next;
}

function margem(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'dentro' || raw === 'fora' ? raw : null;
}

async function vasilhamesById(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const map = new Map();
  if (unique.length === 0) return map;
  for (let i = 0; i < unique.length; i += 200) {
    const slice = unique.slice(i, i + 200);
    const { data, error } = await chemflowSupabase
      .from('t_vasilhames')
      .select('id, placa, barril, volume, tara, lacres, eslinga, gps, menor_teste, fracionado, peso_bruto')
      .in('id', slice);
    throwIfError(error, 'vasilhames');
    for (const row of data || []) map.set(row.id, row);
  }
  return map;
}

function loteFromRow(row, tank) {
  return {
    produto_id: row.produto_id,
    produto_nome: row.produto_nome,
    produto_codigo: row.produto_codigo,
    nota_fiscal: row.nota_fiscal,
    lote: row.lote,
    densidade: row.densidade,
    quantidade: receivedQty(row),
    quantidade_nf: row.quantidade_nf,
    quantidade_declarada: row.quantidade_declarada,
    unidade_medida: row.unidade_medida,
    data_fabricacao: row.data_fabricacao,
    data_validade: row.data_validade,
    preco_unitario: row.preco_unitario,
    tipo_recebimento: row.tipo_recebimento,
    tipo_embalagem: row.tipo_embalagem,
    embalado: row.embalado,
    peso_liquido: row.peso_liquido,
    quantidade_embalagens: row.quantidade_embalagens,
    ind_mp_id: String(row.grupo_entrada || '').startsWith('INDMP:')
      ? String(row.grupo_entrada).slice('INDMP:'.length) || null
      : row.origem === 'MATERIA_PRIMA'
        ? row.legacy_mp_id_text || null
        : null,
    vasilhame_id: row.vasilhame_id || null,
    placa: tank?.placa ?? null,
    barril: tank?.barril ?? null,
    volume: tank?.volume ?? null,
    tara: tank?.tara ?? null,
    lacres: tank?.lacres ?? null,
    eslinga: tank?.eslinga ?? null,
    gps: tank?.gps ?? null,
    menor_teste: tank?.menor_teste ?? null,
    fracionado: tank?.fracionado ?? null,
    peso_bruto: tank?.peso_bruto ?? null,
  };
}

function toEstoque(row, tanks) {
  const tank = row.vasilhame_id ? tanks.get(row.vasilhame_id) : null;
  return {
    id: row.legacy_estoque_id || row.legacy_mp_id_text,
    codigo_estoque: row.codigo_estoque,
    entrada_id: row.legacy_entrada_id,
    entrada_codigo: row.id_entrada,
    grupo_entrada: row.grupo_entrada,
    cliente_id: row.cliente_id,
    cliente_nome: row.cliente_nome,
    produto_id: row.produto_id,
    produto_nome: row.produto_nome,
    produto_codigo: row.produto_codigo,
    nota_fiscal: row.nota_fiscal,
    nota_fiscal_troca: row.nota_fiscal_troca,
    lote: row.lote,
    densidade: row.densidade,
    data_fabricacao: row.data_fabricacao,
    data_validade: row.data_validade,
    quantidade: row.quantidade,
    unidade_medida: row.unidade_medida,
    saldo_atual: row.saldo_atual,
    preco_unitario: row.preco_unitario,
    custo_total: row.custo_total,
    embalado: row.embalado,
    peso_liquido: row.peso_liquido,
    quantidade_embalagens: row.quantidade_embalagens,
    quantidade_nf: row.quantidade_nf,
    quantidade_declarada: row.quantidade_declarada,
    tipo_recebimento: row.tipo_recebimento,
    tipo_embalagem: row.tipo_embalagem,
    vasilhame_id: row.vasilhame_id,
    status_wms: row.status_wms,
    lotes: [loteFromRow(row, tank)],
    origem: row.origem,
    granel_pesagem: row.granel_pesagem,
    granel_ticket: row.granel_ticket,
    granel_peso_bruto: row.granel_peso_bruto,
    granel_validacao_bruto: row.granel_validacao_bruto,
    granel_peso_liquido: row.granel_peso_liquido,
    granel_validacao_liquido: row.granel_validacao_liquido,
    granel_erro_admissivel: row.granel_erro_admissivel,
    granel_peso_minimo: row.granel_peso_minimo,
    granel_peso_maximo: row.granel_peso_maximo,
    granel_margem: row.granel_margem,
    data: row.data,
    fornecedor: row.fornecedor,
    comunicacao_enviada: row.comunicacao_enviada,
    public_token: row.public_token_entrada,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function mapEstoque(rows, options = {}) {
  let tanks = options.tanksById;
  if (!tanks && !options.skipTankHydration) {
    tanks = await vasilhamesById(rows.map((row) => row.vasilhame_id));
  }
  const tankMap = tanks instanceof Map ? tanks : new Map();
  return rows.map((row) => toEstoque(row, tankMap));
}

function toEntrada(lines, tanks) {
  const ordered = [...lines].sort((a, b) => Number(a.id) - Number(b.id));
  const first = ordered[0];
  const lotes = ordered.map((row) => loteFromRow(row, row.vasilhame_id ? tanks.get(row.vasilhame_id) : null));
  const sum = (key) => ordered.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
  const sumQuantidade = ordered.reduce((acc, row) => acc + (Number(receivedQty(row)) || 0), 0);
  return {
    id: first.legacy_entrada_id,
    id_entrada: first.id_entrada,
    cliente_id: first.cliente_id,
    cliente_nome: first.cliente_nome,
    produto_id: first.produto_id,
    produto_nome: first.produto_nome,
    produto_codigo: first.produto_codigo,
    nota_fiscal: first.nota_fiscal,
    lote: first.lote,
    densidade: first.densidade,
    data_fabricacao: first.data_fabricacao,
    data_validade: first.data_validade,
    quantidade: sumQuantidade,
    unidade_medida: first.unidade_medida,
    preco_unitario: first.preco_unitario,
    custo_total: sum('custo_total'),
    saldo_atual: sum('saldo_atual'),
    embalado: first.embalado,
    peso_liquido: first.peso_liquido,
    quantidade_embalagens: first.quantidade_embalagens,
    status_wms: first.status_wms,
    granel_pesagem: first.granel_pesagem,
    granel_ticket: first.granel_ticket,
    granel_peso_bruto: first.granel_peso_bruto,
    granel_validacao_bruto: first.granel_validacao_bruto,
    granel_peso_liquido: first.granel_peso_liquido,
    granel_validacao_liquido: first.granel_validacao_liquido,
    granel_erro_admissivel: first.granel_erro_admissivel,
    granel_peso_minimo: first.granel_peso_minimo,
    granel_peso_maximo: first.granel_peso_maximo,
    granel_margem: first.granel_margem,
    grupo_entrada: first.grupo_entrada,
    lotes,
    origem: first.origem,
    fornecedor: first.fornecedor,
    comunicacao_enviada: first.comunicacao_enviada,
    data: first.data,
    public_token: first.public_token_entrada,
    created_at: first.created_at,
    updated_at: ordered.reduce(
      (max, row) => (row.updated_at > max ? row.updated_at : max),
      first.updated_at
    ),
  };
}

async function groupEntradas(rows) {
  const tanks = await vasilhamesById(rows.map((row) => row.vasilhame_id));
  const groups = new Map();
  for (const row of rows) {
    if (!row.legacy_entrada_id) continue;
    if (String(row.grupo_entrada || '').startsWith('TB')) continue;
    const list = groups.get(row.legacy_entrada_id) || [];
    list.push(row);
    groups.set(row.legacy_entrada_id, list);
  }
  const grouped = [];
  for (const lines of groups.values()) {
    grouped.push(toEntrada(await linesForEntrada(lines), tanks));
  }
  return grouped;
}

function firstLote(payload) {
  const lotes = payload?.lotes;
  if (Array.isArray(lotes) && lotes.length > 0) return lotes[0];
  if (lotes && typeof lotes === 'object') return lotes;
  return null;
}

function rowFromEstoquePayload(payload, ids) {
  const lote = firstLote(payload) || {};
  return {
    id_entrada: ids.idEntrada,
    origem: origemCanon(payload.origem) || 'ARMAZENAGEM',
    produto_id: nullIfEmpty(lote.produto_id || payload.produto_id),
    produto_nome: lote.produto_nome || payload.produto_nome || 'Produto sem nome',
    produto_codigo: nullIfEmpty(lote.produto_codigo || payload.produto_codigo),
    cliente_id: nullIfEmpty(payload.cliente_id),
    cliente_nome: payload.cliente_nome || null,
    data: payload.data || todayISO(),
    nota_fiscal: nullIfEmpty(lote.nota_fiscal ?? payload.nota_fiscal),
    nota_fiscal_troca: nullIfEmpty(payload.nota_fiscal_troca),
    lote: nullIfEmpty(lote.lote ?? payload.lote),
    densidade: densidadeForDb(lote.densidade ?? payload.densidade),
    data_fabricacao: nullIfEmpty(lote.data_fabricacao ?? payload.data_fabricacao),
    data_validade: nullIfEmpty(lote.data_validade ?? payload.data_validade),
    fornecedor: nullIfEmpty(payload.fornecedor),
    quantidade: Number(payload.quantidade ?? lote.quantidade) || 0,
    initial_stock: Number(payload.quantidade ?? lote.quantidade) || 0,
    unidade_medida: lote.unidade_medida || payload.unidade_medida || 'kg',
    preco_unitario: payload.preco_unitario ?? lote.preco_unitario ?? null,
    custo_total: payload.custo_total ?? null,
    saldo_atual: Number(payload.saldo_atual ?? payload.quantidade ?? lote.quantidade) || 0,
    embalado: Boolean(lote.embalado ?? payload.embalado),
    peso_liquido: lote.peso_liquido ?? payload.peso_liquido ?? null,
    quantidade_embalagens: lote.quantidade_embalagens ?? payload.quantidade_embalagens ?? null,
    quantidade_nf: lote.quantidade_nf ?? null,
    quantidade_declarada: lote.quantidade_declarada ?? null,
    tipo_recebimento: nullIfEmpty(lote.tipo_recebimento),
    tipo_embalagem: nullIfEmpty(lote.tipo_embalagem),
    vasilhame_id: nullIfEmpty(lote.vasilhame_id || lote.vasilhame_existente_id),
    status_wms: Boolean(payload.status_wms),
    granel_pesagem: Boolean(payload.granel_pesagem),
    granel_ticket: nullIfEmpty(payload.granel_ticket),
    granel_peso_bruto: payload.granel_peso_bruto ?? null,
    granel_validacao_bruto: payload.granel_validacao_bruto ?? null,
    granel_peso_liquido: payload.granel_peso_liquido ?? null,
    granel_validacao_liquido: payload.granel_validacao_liquido ?? null,
    granel_erro_admissivel: payload.granel_erro_admissivel ?? null,
    granel_peso_minimo: payload.granel_peso_minimo ?? null,
    granel_peso_maximo: payload.granel_peso_maximo ?? null,
    granel_margem: margem(payload.granel_margem),
    legacy_estoque_id: ids.legacyEstoqueId,
    legacy_entrada_id: ids.legacyEntradaId,
    legacy_entrada_codigo: nullIfEmpty(payload.entrada_codigo),
    grupo_entrada: nullIfEmpty(payload.grupo_entrada),
    codigo_estoque: payload.codigo_estoque ?? null,
    comunicacao_enviada: Boolean(payload.comunicacao_enviada),
    public_token_entrada: nullIfEmpty(payload.public_token),
  };
}

const HEADER_KEYS = [
  'cliente_id',
  'cliente_nome',
  'data',
  'fornecedor',
  'comunicacao_enviada',
  'status_wms',
  'granel_pesagem',
  'granel_ticket',
  'granel_peso_bruto',
  'granel_validacao_bruto',
  'granel_peso_liquido',
  'granel_validacao_liquido',
  'granel_erro_admissivel',
  'granel_peso_minimo',
  'granel_peso_maximo',
  'granel_margem',
  'grupo_entrada',
];

function headerPatch(payload) {
  const patch = {};
  for (const key of HEADER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) patch[key] = payload[key];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'public_token')) {
    patch.public_token_entrada = nullIfEmpty(payload.public_token);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'cliente_id')) {
    patch.cliente_id = nullIfEmpty(payload.cliente_id);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'granel_margem')) {
    patch.granel_margem = margem(payload.granel_margem);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'granel_ticket')) {
    patch.granel_ticket = nullIfEmpty(payload.granel_ticket);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'fornecedor')) {
    patch.fornecedor = nullIfEmpty(payload.fornecedor);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'grupo_entrada')) {
    patch.grupo_entrada = nullIfEmpty(payload.grupo_entrada);
  }
  const origem = origemCanon(payload.origem);
  if (origem && Object.prototype.hasOwnProperty.call(payload, 'origem')) patch.origem = origem;
  return patch;
}

async function resolveCodigo(legacyEntradaId, hinted) {
  if (legacyEntradaId) {
    const rows = await fetchAll(
      (q) => q.eq('legacy_entrada_id', legacyEntradaId).order('id', { ascending: true }),
      { limit: 1 }
    );
    if (rows[0]?.id_entrada) return rows[0].id_entrada;
  }
  const code = String(hinted || '').trim().toUpperCase();
  if (isSharedEntradaId(code)) return code;
  return nextEntradaId();
}

function applyEstoqueFilter(builder, query) {
  const byEntrada = Boolean(query?.entrada_id || query?.entrada_codigo);
  let next = builder;
  if (!byEntrada) {
    next = next.eq('origem', 'ARMAZENAGEM').not('legacy_estoque_id', 'is', null);
  }
  for (const [key, value] of Object.entries(query || {})) {
    if (key === 'id') next = next.eq('legacy_estoque_id', value);
    else if (key === 'entrada_id') next = next.eq('legacy_entrada_id', value);
    else if (key === 'entrada_codigo') next = next.eq('id_entrada', value);
    else if (key === 'origem') {
      if (!byEntrada) continue;
      const origem = origemCanon(value);
      if (origem) next = next.eq('origem', origem);
    } else next = next.eq(key, value);
  }
  return next;
}

async function updateByLegacyId(id, patch, context) {
  const { data, error } = await chemflowSupabase
    .from(TABLE)
    .update(stamp(patch))
    .eq('legacy_estoque_id', id)
    .select()
    .maybeSingle();
  throwIfError(error, context);
  if (data) return data;
  const retry = await chemflowSupabase
    .from(TABLE)
    .update(stamp(patch))
    .eq('legacy_mp_id_text', String(id))
    .select()
    .maybeSingle();
  throwIfError(retry.error, context);
  return retry.data || null;
}

export function createEntradaEntity() {
  return {
    async list(sort) {
      const { column, ascending } = orderOf(sort, { entrada_codigo: 'id_entrada', id: 'legacy_entrada_id' });
      const rows = await fetchAll((q) => q.order(column, { ascending }));
      const grouped = await groupEntradas(rows);
      grouped.sort((a, b) => {
        const av = a[column === 'id_entrada' ? 'id_entrada' : 'created_at'] || '';
        const bv = b[column === 'id_entrada' ? 'id_entrada' : 'created_at'] || '';
        return ascending ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
      return grouped;
    },
    async get(id) {
      const rows = await fetchAll((q) => q.eq('legacy_entrada_id', id).order('id', { ascending: true }));
      const grouped = await groupEntradas(rows);
      return grouped[0] || null;
    },
    async filter(query = {}) {
      const columnOf = {
        id: 'legacy_entrada_id',
        id_entrada: 'id_entrada',
        cliente_id: 'cliente_id',
        public_token: 'public_token_entrada',
        produto_id: 'produto_id',
        produto_codigo: 'produto_codigo',
      };
      const rows = await fetchAll((q) => {
        let next = q;
        for (const [key, value] of Object.entries(query || {})) {
          if (key === 'origem' || key === 'grupo_entrada' || value == null) continue;
          const column = columnOf[key];
          if (column) next = next.eq(column, value);
        }
        return next;
      });
      const ids = [...new Set(rows.map((row) => row.legacy_entrada_id).filter(Boolean))];
      const full = [];
      for (let i = 0; i < ids.length; i += 100) {
        const slice = ids.slice(i, i + 100);
        full.push(...await fetchAll((q) => q.in('legacy_entrada_id', slice)));
      }
      let grouped = await groupEntradas(full);
      if (query.origem) {
        const origem = origemCanon(query.origem);
        grouped = grouped.filter((row) => row.origem === origem);
      }
      if (query.grupo_entrada) {
        grouped = grouped.filter((row) => row.grupo_entrada === query.grupo_entrada);
      }
      return grouped;
    },
    async create(payload) {
      const id = payload.id || crypto.randomUUID();
      const id_entrada = await nextEntradaId();
      return {
        ...payload,
        id,
        id_entrada,
        origem: origemCanon(payload.origem) || 'ARMAZENAGEM',
        lotes: Array.isArray(payload.lotes) ? payload.lotes : [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },
    async update(id, payload) {
      const patch = headerPatch(payload);
      if (Object.keys(patch).length > 0) {
        assertConfigured('entrada.update');
        const { error } = await chemflowSupabase
          .from(TABLE)
          .update(stamp(patch))
          .eq('legacy_entrada_id', id)
          .or('grupo_entrada.is.null,grupo_entrada.not.like.TB*');
        throwIfError(error, 'entrada.update');
      }
      return this.get(id);
    },
    async delete(id) {
      assertConfigured('entrada.delete');
      const { error } = await chemflowSupabase.from(TABLE).delete().eq('legacy_entrada_id', id);
      throwIfError(error, 'entrada.delete');
      return true;
    },
    async bulkCreate(payloads) {
      const created = [];
      for (const payload of payloads || []) created.push(await this.create(payload));
      return created;
    },
    async bulkUpdate(records) {
      const updated = [];
      for (const record of records || []) {
        const { id, ...changes } = record;
        updated.push(await this.update(id, changes));
      }
      return updated;
    },
    async deleteMany(query = {}) {
      if (query.id) return this.delete(query.id);
      const rows = await this.filter(query);
      for (const row of rows) await this.delete(row.id);
      return true;
    },
  };
}

export function createEstoqueEntity() {
  const estoqueOrder = {
    entrada_codigo: 'id_entrada',
    entrada_id: 'legacy_entrada_id',
    id: 'legacy_estoque_id',
    created_date: 'created_at',
  };

  return {
    async list(sort, options = {}) {
      const { column, ascending } = orderOf(sort, estoqueOrder);
      const rows = await fetchAll(
        (q) => q.eq('origem', 'ARMAZENAGEM').not('legacy_estoque_id', 'is', null).order(column, { ascending }),
        { limit: options.limit }
      );
      return mapEstoque(rows, {
        skipTankHydration: options.skipTankHydration,
        tanksById: options.tanksById,
      });
    },
    async get(id) {
      let rows = await fetchAll((q) => q.eq('legacy_estoque_id', id), { limit: 1 });
      if (!rows[0]) {
        rows = await fetchAll((q) => q.eq('legacy_mp_id_text', String(id)), { limit: 1 });
      }
      const mapped = await mapEstoque(rows);
      return mapped[0] || null;
    },
    async filter(query = {}) {
      const rows = await fetchAll((q) => applyEstoqueFilter(q, query));
      const collapsed = query.entrada_id || query.entrada_codigo
        ? await linesForEntrada(rows)
        : rows;
      return mapEstoque(collapsed);
    },
    async create(payload) {
      const legacyEntradaId = payload.entrada_id || crypto.randomUUID();
      const legacyEstoqueId = payload.id || crypto.randomUUID();
      const idEntrada = await resolveCodigo(payload.entrada_id, payload.entrada_codigo);
      const lote = firstLote(payload) || {};
      const existing = legacyEntradaId
        ? await fetchAll((q) => q.eq('legacy_entrada_id', legacyEntradaId))
        : [];
      const reusable = findUnifiableMpRow(existing, {
        lote: lote.lote || payload.lote,
        produto_codigo: lote.produto_codigo || payload.produto_codigo,
        produto_nome: lote.produto_nome || payload.produto_nome,
      });
      assertConfigured('estoque.create');
      const body = rowFromEstoquePayload(payload, {
        idEntrada,
        legacyEntradaId,
        legacyEstoqueId,
      });
      if (reusable) {
        const { data, error } = await chemflowSupabase
          .from(TABLE)
          .update(stamp({
            ...body,
            origem: reusable.origem || body.origem,
            legacy_mp_id_text: reusable.legacy_mp_id_text,
            legacy_mp_entry_id: reusable.legacy_mp_entry_id,
            legacy_estoque_id: reusable.legacy_estoque_id || legacyEstoqueId,
          }))
          .eq('id', reusable.id)
          .select()
          .single();
        throwIfError(error, 'estoque.create');
        const mapped = await mapEstoque([data]);
        return mapped[0];
      }
      const { data, error } = await chemflowSupabase
        .from(TABLE)
        .insert(body)
        .select()
        .single();
      throwIfError(error, 'estoque.create');
      const mapped = await mapEstoque([data]);
      return mapped[0];
    },
    async bulkCreate(payloads) {
      if (!payloads?.length) return [];
      const created = [];
      for (const payload of payloads) created.push(await this.create(payload));
      return created;
    },
    async update(id, payload) {
      const lote = firstLote(payload);
      const patch = {};
      const copy = [
        'produto_id', 'produto_nome', 'produto_codigo', 'cliente_id', 'cliente_nome',
        'nota_fiscal', 'nota_fiscal_troca', 'lote', 'densidade', 'data_fabricacao',
        'data_validade', 'quantidade', 'unidade_medida', 'preco_unitario', 'custo_total',
        'saldo_atual', 'embalado', 'peso_liquido', 'quantidade_embalagens', 'status_wms',
        'grupo_entrada', 'codigo_estoque',
      ];
      for (const key of copy) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
        patch[key] = key === 'densidade' ? densidadeForDb(payload[key]) : payload[key];
      }
      Object.assign(patch, headerPatch(payload));
      if (lote) {
        if (lote.produto_nome) patch.produto_nome = lote.produto_nome;
        if (lote.lote != null) patch.lote = nullIfEmpty(lote.lote);
        if (lote.nota_fiscal != null) patch.nota_fiscal = nullIfEmpty(lote.nota_fiscal);
        if (lote.tipo_recebimento) patch.tipo_recebimento = lote.tipo_recebimento;
        if (lote.vasilhame_id || lote.vasilhame_existente_id) {
          patch.vasilhame_id = nullIfEmpty(lote.vasilhame_id || lote.vasilhame_existente_id);
        }
        if (lote.ind_mp_id && !patch.grupo_entrada) {
          patch.grupo_entrada = `INDMP:${lote.ind_mp_id}`;
        }
      }
      for (const key of ['produto_id', 'cliente_id', 'vasilhame_id']) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) patch[key] = nullIfEmpty(patch[key]);
      }
      // ARMAZENAGEM: initial_stock é snapshot da quantidade recebida na linha.
      if (Object.prototype.hasOwnProperty.call(patch, 'quantidade')) {
        patch.initial_stock = patch.quantidade;
      }
      assertConfigured('estoque.update');
      const data = await updateByLegacyId(id, patch, 'estoque.update');
      if (!data) return null;
      const mapped = await mapEstoque([data]);
      return mapped[0];
    },
    async bulkUpdate(records) {
      const updated = [];
      for (const record of records || []) {
        const { id, ...changes } = record;
        updated.push(await this.update(id, changes));
      }
      return updated;
    },
    async delete(id) {
      assertConfigured('estoque.delete');
      const first = await chemflowSupabase
        .from(TABLE)
        .delete()
        .eq('legacy_estoque_id', id)
        .select('id');
      throwIfError(first.error, 'estoque.delete');
      if (first.data?.length) return true;
      const retry = await chemflowSupabase
        .from(TABLE)
        .delete()
        .eq('legacy_mp_id_text', String(id))
        .select('id');
      throwIfError(retry.error, 'estoque.delete');
      return true;
    },
    async deleteMany(query = {}) {
      assertConfigured('estoque.deleteMany');
      let builder = chemflowSupabase.from(TABLE).delete();
      builder = applyEstoqueFilter(builder, query);
      const { error } = await builder;
      throwIfError(error, 'estoque.deleteMany');
      return true;
    },
  };
}

function densityText(value) {
  return densidadeForDb(value);
}

function densityNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = parseDensidade(value);
  return Number.isFinite(n) ? n : null;
}

function toMateriaPrima(row) {
  return {
    id: row.legacy_mp_id_text,
    created_date: row.created_at,
    updated_date: row.updated_at,
    created_by_id: row.created_by_id,
    entry_id: row.id_entrada,
    entry_date: row.data,
    // produto_codigo é a fonte oficial; mp_code na API é só o nome lógico legado.
    mp_code: row.produto_codigo,
    mp_name: row.produto_nome,
    client: row.cliente_nome,
    lot: row.lote,
    nota_fiscal: row.nota_fiscal,
    supplier: row.fornecedor,
    manufacture_date: row.data_fabricacao,
    expiry_date: row.data_validade,
    initial_stock: row.initial_stock,
    current_stock: row.saldo_atual,
    unit: row.unidade_medida,
    unit_price: row.preco_unitario,
    density: densityNumber(row.densidade),
    status_wms: row.status_wms,
    observations: row.observations,
    tank_storage: row.tank_storage,
    tank_entries: row.tank_entries,
    packaging_type: row.packaging_type,
    packaging_capacity: row.packaging_capacity,
    packaging_quantity: row.packaging_quantity,
    public_token: row.public_token,
  };
}

function rowFromMp(payload, ids) {
  const nome = payload.mp_name || payload.produto_nome || 'Matéria-prima sem nome';
  return {
    id_entrada: ids.idEntrada,
    origem: 'MATERIA_PRIMA',
    produto_nome: nome,
    produto_codigo: nullIfEmpty(payload.mp_code),
    cliente_nome: nullIfEmpty(payload.client),
    data: payload.entry_date || todayISO(),
    nota_fiscal: nullIfEmpty(payload.nota_fiscal),
    lote: nullIfEmpty(payload.lot),
    densidade: densityText(payload.density),
    data_fabricacao: nullIfEmpty(payload.manufacture_date),
    data_validade: nullIfEmpty(payload.expiry_date),
    fornecedor: nullIfEmpty(payload.supplier),
    quantidade: Number(payload.initial_stock ?? payload.current_stock) || 0,
    initial_stock: payload.initial_stock ?? null,
    unidade_medida: payload.unit || 'kg',
    preco_unitario: payload.unit_price ?? null,
    saldo_atual: Number(payload.current_stock ?? payload.initial_stock) || 0,
    status_wms: Boolean(payload.status_wms),
    observations: nullIfEmpty(payload.observations),
    tank_storage: payload.tank_storage ?? null,
    tank_entries: payload.tank_entries ?? null,
    packaging_type: nullIfEmpty(payload.packaging_type),
    packaging_capacity: payload.packaging_capacity ?? null,
    packaging_quantity: payload.packaging_quantity ?? null,
    public_token: nullIfEmpty(payload.public_token),
    legacy_entrada_id: ids.legacyEntradaId,
    legacy_estoque_id: ids.legacyEstoqueId || null,
    legacy_mp_id_text: ids.mpId,
    legacy_mp_entry_id: ids.idEntrada,
    created_by_id: nullIfEmpty(payload.created_by_id),
  };
}

async function sharedEntradaUuid(idEntrada) {
  const rows = await fetchAll(
    (q) => q.eq('origem', 'MATERIA_PRIMA').eq('id_entrada', idEntrada).order('id', { ascending: true }),
    { limit: 1 }
  );
  return rows[0]?.legacy_entrada_id || crypto.randomUUID();
}

const MP_ORDER = {
  created_date: 'created_at',
  updated_date: 'updated_at',
  entry_date: 'data',
  entry_id: 'id_entrada',
  current_stock: 'saldo_atual',
  mp_name: 'produto_nome',
  lot: 'lote',
  client: 'cliente_nome',
};

function applyMpFilter(builder, query) {
  let next = builder.eq('origem', 'MATERIA_PRIMA').not('legacy_mp_id_text', 'is', null);
  for (const [key, value] of Object.entries(query || {})) {
    if (key === 'id') next = next.eq('legacy_mp_id_text', value);
    else if (key === 'entry_id') next = next.eq('id_entrada', value);
    else if (key === 'client') next = next.eq('cliente_nome', value);
    else if (key === 'lot') next = next.eq('lote', value);
    else if (key === 'mp_name') next = next.eq('produto_nome', value);
    else if (key === 'mp_code') next = next.eq('produto_codigo', value);
    else if (key === 'supplier') next = next.eq('fornecedor', value);
    else next = next.eq(key, value);
  }
  return next;
}

async function syncEntradaMirrorsFromMp(canonical, patch) {
  if (!canonical?.legacy_entrada_id || !patch || Object.keys(patch).length === 0) return;
  const mirrors = await fetchAll(
    (q) => q.eq('legacy_entrada_id', canonical.legacy_entrada_id).is('legacy_mp_id_text', null)
  );
  const siblings = (mirrors || []).filter((row) => Number(row.id) !== Number(canonical.id));
  if (siblings.length === 0) return;
  const lote = String(canonical.lote || '').trim();
  const targets = siblings.filter((row) => {
    if (siblings.length === 1) return true;
    return String(row.lote || '').trim() === lote;
  });
  if (targets.length === 0) return;
  const mirrorPatch = {};
  for (const key of [
    'produto_nome', 'produto_codigo', 'cliente_nome', 'nota_fiscal', 'lote',
    'densidade', 'data_fabricacao', 'data_validade', 'fornecedor',
    'quantidade', 'initial_stock', 'unidade_medida', 'preco_unitario',
    'saldo_atual', 'status_wms',
  ]) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) mirrorPatch[key] = patch[key];
  }
  if (Object.keys(mirrorPatch).length === 0) return;
  const { error } = await chemflowSupabase
    .from(TABLE)
    .update(stamp(mirrorPatch))
    .in('id', targets.map((row) => row.id));
  throwIfError(error, 'mp.sync_mirrors');
}

export function createMateriaPrimaEntity() {
  return {
    async list(sort, limit) {
      const { column, ascending } = orderOf(sort, MP_ORDER);
      const rows = await fetchAll(
        (q) => q.eq('origem', 'MATERIA_PRIMA').not('legacy_mp_id_text', 'is', null).order(column, { ascending }),
        { limit }
      );
      return rows.map(toMateriaPrima);
    },
    async filter(query = {}, sort, limit) {
      const { column, ascending } = orderOf(sort, MP_ORDER);
      const rows = await fetchAll(
        (q) => applyMpFilter(q, query).order(column, { ascending }),
        { limit }
      );
      return rows.map(toMateriaPrima);
    },
    async get(id) {
      const rows = await fetchAll((q) => q.eq('legacy_mp_id_text', String(id)), { limit: 1 });
      if (!rows[0]) throw new Error('Registro não encontrado');
      return toMateriaPrima(rows[0]);
    },
    async create(payload) {
      const hinted = String(payload.entry_id || '').trim().toUpperCase();
      const idEntrada = isSharedEntradaId(hinted) ? hinted : await nextEntradaId();
      const legacyEntradaId = await sharedEntradaUuid(idEntrada);
      const mpId = payload.id || crypto.randomUUID();
      const legacyEstoqueId = crypto.randomUUID();
      const existing = await fetchAll((q) => q.eq('legacy_entrada_id', legacyEntradaId));
      const reusable = findUnifiableMpRow(existing, {
        lote: payload.lot,
        produto_codigo: payload.mp_code,
        produto_nome: payload.mp_name || payload.produto_nome,
      });
      assertConfigured('mp.create');
      const body = rowFromMp(payload, {
        idEntrada,
        legacyEntradaId,
        mpId: reusable?.legacy_mp_id_text || mpId,
        legacyEstoqueId: reusable?.legacy_estoque_id || legacyEstoqueId,
      });
      if (reusable) {
        const { data, error } = await chemflowSupabase
          .from(TABLE)
          .update(stamp(body))
          .eq('id', reusable.id)
          .select()
          .single();
        throwIfError(error, 'mp.create');
        return toMateriaPrima(data);
      }
      const { data, error } = await chemflowSupabase
        .from(TABLE)
        .insert(body)
        .select()
        .single();
      throwIfError(error, 'mp.create');
      return toMateriaPrima(data);
    },
    async bulkCreate(payloads) {
      const created = [];
      for (const payload of payloads || []) created.push(await this.create(payload));
      return created;
    },
    async update(id, payload) {
      const patch = {};
      if (payload.mp_name != null) patch.produto_nome = payload.mp_name;
      if (payload.mp_code != null) {
        patch.produto_codigo = nullIfEmpty(payload.mp_code);
      }
      if (payload.client != null) patch.cliente_nome = nullIfEmpty(payload.client);
      if (payload.entry_date != null) patch.data = payload.entry_date;
      if (payload.nota_fiscal != null) patch.nota_fiscal = nullIfEmpty(payload.nota_fiscal);
      if (payload.lot != null) patch.lote = nullIfEmpty(payload.lot);
      if (payload.density != null) patch.densidade = densityText(payload.density);
      if (payload.manufacture_date != null) patch.data_fabricacao = nullIfEmpty(payload.manufacture_date);
      if (payload.expiry_date != null) patch.data_validade = nullIfEmpty(payload.expiry_date);
      if (payload.supplier != null) patch.fornecedor = nullIfEmpty(payload.supplier);
      if (payload.initial_stock != null) {
        patch.initial_stock = payload.initial_stock;
        // quantidade deve sempre refletir o estoque inicial registrado.
        // A tela de Entradas (Transbordo) lê este campo para exibir a quantidade;
        // sem essa atribuição, uma edição em Estoque MP não aparece em Entradas.
        patch.quantidade = payload.initial_stock;
      }
      if (payload.unit != null) patch.unidade_medida = payload.unit || 'kg';
      if (payload.unit_price != null) patch.preco_unitario = payload.unit_price;
      if (payload.current_stock != null) patch.saldo_atual = payload.current_stock;
      if (payload.status_wms != null) patch.status_wms = Boolean(payload.status_wms);
      if (payload.observations != null) patch.observations = nullIfEmpty(payload.observations);
      if (payload.tank_storage != null) patch.tank_storage = payload.tank_storage;
      if (payload.tank_entries != null) patch.tank_entries = payload.tank_entries;
      if (payload.packaging_type != null) patch.packaging_type = nullIfEmpty(payload.packaging_type);
      if (payload.packaging_capacity != null) patch.packaging_capacity = payload.packaging_capacity;
      if (payload.packaging_quantity != null) patch.packaging_quantity = payload.packaging_quantity;
      if (payload.public_token != null) patch.public_token = nullIfEmpty(payload.public_token);
      assertConfigured('mp.update');
      const { data, error } = await chemflowSupabase
        .from(TABLE)
        .update(stamp(patch))
        .eq('legacy_mp_id_text', String(id))
        .select()
        .maybeSingle();
      throwIfError(error, 'mp.update');
      if (!data) throw new Error('Registro não encontrado');
      await syncEntradaMirrorsFromMp(data, patch);
      return toMateriaPrima(data);
    },
    async bulkUpdate(items) {
      const updated = [];
      for (const item of items || []) {
        const { id, ...changes } = item;
        updated.push(await this.update(id, changes));
      }
      return updated;
    },
    async delete(id) {
      assertConfigured('mp.delete');
      const { error } = await chemflowSupabase
        .from(TABLE)
        .delete()
        .eq('legacy_mp_id_text', String(id));
      throwIfError(error, 'mp.delete');
      return true;
    },
    async deleteMany(query = {}) {
      assertConfigured('mp.deleteMany');
      let builder = chemflowSupabase.from(TABLE).delete();
      builder = applyMpFilter(builder, query);
      const { error } = await builder;
      throwIfError(error, 'mp.deleteMany');
      return [];
    },
    subscribe: () => () => {},
    schema: () => ({ properties: {} }),
  };
}
