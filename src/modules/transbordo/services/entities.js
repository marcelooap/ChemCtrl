import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';

/**
 * Camada de dados do módulo Transbordo.
 * Fala com as tabelas do Supabase unificado (`t_*`, exceto
 * `cadastro_produtos` — ex-`t_produtos`, ver migration 046).
 *
 * Mantém a mesma API usada pelas telas (list/get/filter/create/
 * update/delete/bulkCreate/bulkUpdate/deleteMany) — as chaves do
 * objeto `entities` (clientes, produtos, ...) não mudam.
 */

function normalizeOrder(sort) {
  if (!sort) return { column: 'created_at', ascending: false };
  const ascending = !sort.startsWith('-');
  const field = sort.replace(/^-/, '');
  const column = field === 'created_date' ? 'created_at' : field;
  return { column, ascending };
}

function throwIfError(error, context) {
  if (error) {
    throw new Error(`[ChemFlow:${context}] ${error.message || 'Erro desconhecido no Supabase'}`);
  }
}

function assertConfigured(context) {
  if (!isChemFlowConfigured || !chemflowSupabase) {
    throw new Error(`[ChemFlow:${context}] ${CHEMFLOW_CONFIG_ERROR}`);
  }
}

const TABLE_FALLBACKS = {
  cadastro_produtos: ['cadastro_produtos', 't_produtos'],
  // Pós-049 cutover: mestre único (sem fallback t_isotanques).
  cadastro_tanka: ['cadastro_tanka'],
};
const physicalTableCache = new Map();
const physicalTableInFlight = new Map();

function isMissingRelationError(error) {
  const msg = String(error?.message || error?.details || '');
  const code = String(error?.code || '');
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /Could not find the table|relation .* does not exist|schema cache/i.test(msg)
  );
}

async function resolvePhysicalTable(preferredName) {
  if (physicalTableCache.has(preferredName)) {
    return physicalTableCache.get(preferredName);
  }
  const pending = physicalTableInFlight.get(preferredName);
  if (pending) return pending;

  const request = (async () => {
    assertConfigured(`${preferredName}.resolve`);
    const candidates = TABLE_FALLBACKS[preferredName] || [preferredName];
    for (const name of candidates) {
      const { error } = await chemflowSupabase
        .from(name)
        .select('id')
        .limit(1);
      if (!error) {
        physicalTableCache.set(preferredName, name);
        return name;
      }
      if (!isMissingRelationError(error)) {
        throwIfError(error, `${preferredName}.resolve`);
      }
    }
    physicalTableCache.set(preferredName, preferredName);
    return preferredName;
  })().finally(() => {
    physicalTableInFlight.delete(preferredName);
  });

  physicalTableInFlight.set(preferredName, request);
  return request;
}

function createEntity(preferredTable) {
  const tableOf = async () => resolvePhysicalTable(preferredTable);

  return {
    async list(sort, options = {}) {
      const table = await tableOf();
      assertConfigured(`${table}.list`);
      const { column, ascending } = normalizeOrder(sort);
      let builder = chemflowSupabase
        .from(table)
        .select(options.select || '*')
        .order(column, { ascending });
      if (Number.isFinite(options.limit) && options.limit > 0) {
        const from = Number.isFinite(options.offset) ? options.offset : 0;
        builder = builder.range(from, from + options.limit - 1);
      }
      const { data, error } = await builder;
      throwIfError(error, `${table}.list`);
      return data || [];
    },

    async listPage({ sort, page = 1, pageSize = 50, select = '*' } = {}) {
      const table = await tableOf();
      assertConfigured(`${table}.listPage`);
      const { column, ascending } = normalizeOrder(sort);
      const size = Math.min(200, Math.max(1, Number(pageSize) || 50));
      const p = Math.max(1, Number(page) || 1);
      const from = (p - 1) * size;
      const to = from + size - 1;
      const { data, error, count } = await chemflowSupabase
        .from(table)
        .select(select, { count: 'exact' })
        .order(column, { ascending })
        .range(from, to);
      throwIfError(error, `${table}.listPage`);
      return { rows: data || [], page: p, pageSize: size, total: count };
    },

    async get(id) {
      const table = await tableOf();
      assertConfigured(`${table}.get`);
      const { data, error } = await chemflowSupabase
        .from(table)
        .select('*')
        .eq('id', id)
        .maybeSingle();
      throwIfError(error, `${table}.get`);
      return data;
    },

    async filter(query = {}) {
      const table = await tableOf();
      assertConfigured(`${table}.filter`);
      let builder = chemflowSupabase.from(table).select('*');
      for (const [key, value] of Object.entries(query)) {
        builder = builder.eq(key, value);
      }
      const { data, error } = await builder;
      throwIfError(error, `${table}.filter`);
      return data || [];
    },

    async create(payload) {
      const table = await tableOf();
      assertConfigured(`${table}.create`);
      const { data, error } = await chemflowSupabase
        .from(table)
        .insert(payload)
        .select()
        .single();
      throwIfError(error, `${table}.create`);
      return data;
    },

    async bulkCreate(payloads) {
      const table = await tableOf();
      assertConfigured(`${table}.bulkCreate`);
      if (!payloads || payloads.length === 0) return [];
      const { data, error } = await chemflowSupabase
        .from(table)
        .insert(payloads)
        .select();
      throwIfError(error, `${table}.bulkCreate`);
      return data || [];
    },

    async update(id, payload) {
      const table = await tableOf();
      assertConfigured(`${table}.update`);
      const { data, error } = await chemflowSupabase
        .from(table)
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      throwIfError(error, `${table}.update`);
      return data;
    },

    async bulkUpdate(records) {
      const table = await tableOf();
      assertConfigured(`${table}.bulkUpdate`);
      if (!records || records.length === 0) return [];
      const results = await Promise.all(
        records.map(({ id, ...changes }) =>
          chemflowSupabase.from(table).update(changes).eq('id', id).select().single()
        )
      );
      results.forEach((r) => throwIfError(r.error, `${table}.bulkUpdate`));
      return results.map((r) => r.data);
    },

    async delete(id) {
      const table = await tableOf();
      assertConfigured(`${table}.delete`);
      const { error } = await chemflowSupabase.from(table).delete().eq('id', id);
      throwIfError(error, `${table}.delete`);
      return true;
    },

    async deleteMany(query = {}) {
      const table = await tableOf();
      assertConfigured(`${table}.deleteMany`);
      let builder = chemflowSupabase.from(table).delete();
      for (const [key, value] of Object.entries(query)) {
        builder = builder.eq(key, value);
      }
      const { error } = await builder;
      throwIfError(error, `${table}.deleteMany`);
      return true;
    },
  };
}

export const entities = {
  clientes: createEntity('t_clientes'),
  produtos: createEntity('cadastro_produtos'),
  /** Mestre único cadastro_tanka (pós-049 cutover). */
  isotanques: createEntity('cadastro_tanka'),
  descontaminacoes: createEntity('t_descontaminacoes'),
  entradas: createEntity('t_entradas'),
  estoque: createEntity('t_estoque'),
  transbordos: createEntity('t_transbordos'),
  vasilhames: createEntity('t_vasilhames'),
  saidas: createEntity('t_saidas'),
  filtracoes: createEntity('t_filtracoes'),
  elementos_filtrantes: createEntity('t_elementos_filtrantes'),
  materialReservas: createEntity('t_material_reservas'),
  agendamentosCarregamento: createEntity('t_agendamentos_carregamento'),
  saidaLeituras: createEntity('t_saida_leituras'),
  validacaoLeituras: createEntity('t_validacao_leituras'),
  operadores: createEntity('t_operadores'),
  etiquetaConfigs: createEntity('t_etiqueta_configs'),
  checklistExpedicaoItens: createEntity('t_checklist_expedicao_itens'),
  checklistExpedicaoConfig: createEntity('t_checklist_expedicao_config'),
  checklistExpedicaoValidadeDestinos: createEntity('t_checklist_expedicao_validade_destinos'),
  transbordoValidacoes: createEntity('t_transbordo_validacoes'),
};
