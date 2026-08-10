import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';

/**
 * Camada de dados do ChemFlow — substitui 100% o antigo facade Base44
 * (`entities.<nome>`). Fala exclusivamente com o Supabase Projeto B,
 * isolado do Supabase Projeto A usado pelo ChemCtrl.
 *
 * Mantém a mesma API usada pelas telas legadas (list/get/filter/create/
 * update/delete/bulkCreate/bulkUpdate/deleteMany) para minimizar o churn
 * nos componentes migrados de `entities.X.metodo(...)` para
 * `entities.X.metodo(...)`.
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
  clientes: createEntity('clientes'),
  produtos: createEntity('produtos'),
  isotanques: createEntity('isotanques'),
  descontaminacoes: createEntity('descontaminacoes'),
  entradas: createEntity('entradas'),
  estoque: createEntity('estoque'),
  transbordos: createEntity('transbordos'),
  vasilhames: createEntity('vasilhames'),
  saidas: createEntity('saidas'),
  filtracoes: createEntity('filtracoes'),
  elementos_filtrantes: createEntity('elementos_filtrantes'),
};
