import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';

/**
 * Camada de dados do módulo Transbordo.
 * Fala com as tabelas prefixadas `t_*` no Supabase unificado.
 *
 * Mantém a mesma API usada pelas telas (list/get/filter/create/
 * update/delete/bulkCreate/bulkUpdate/deleteMany) — as chaves do
 * objeto `entities` (clientes, produtos, ...) não mudam; apenas o
 * nome físico da tabela no Supabase usa o prefixo `t_`.
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

function createEntity(table) {
  return {
    async list(sort) {
      assertConfigured(`${table}.list`);
      const { column, ascending } = normalizeOrder(sort);
      const { data, error } = await chemflowSupabase
        .from(table)
        .select('*')
        .order(column, { ascending });
      throwIfError(error, `${table}.list`);
      return data || [];
    },

    async get(id) {
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
      assertConfigured(`${table}.delete`);
      const { error } = await chemflowSupabase.from(table).delete().eq('id', id);
      throwIfError(error, `${table}.delete`);
      return true;
    },

    async deleteMany(query = {}) {
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
  produtos: createEntity('t_produtos'),
  isotanques: createEntity('t_isotanques'),
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
  operadores: createEntity('t_operadores'),
  etiquetaConfigs: createEntity('t_etiqueta_configs'),
  transbordoValidacoes: createEntity('t_transbordo_validacoes'),
};
