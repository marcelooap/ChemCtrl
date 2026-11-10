/**
 * CRUD e resolução de tarifas de vasilhames por capacidade nominal.
 * Tabela: t_faturamento_tarifas_vasilhames
 */
import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';
import {
  canManageFaturamentoTarifaHistory,
  normalizeDecimalString,
  rateToNumber,
  formatTarifaRate,
  rateInputValue,
  parseRateInput,
  todayISO,
  currentMonthRange,
} from '@painel/lib/faturamentoTarifas';
import {
  CAPACIDADES_NOMINAIS_PADRAO,
  roundLiters,
  snapCapacidadeConhecida,
} from '@painel/lib/vasilhamesCapacidadeNominal';

const TABLE = 't_faturamento_tarifas_vasilhames';

const DEFAULT_SEEDS = Object.freeze([
  {
    capacidade_litros: 5000,
    tarifa_diaria: '5.63589476994486',
    vigencia_inicio: '2000-01-01',
  },
  {
    capacidade_litros: 1500,
    tarifa_diaria: '1.25242105998775',
    vigencia_inicio: '2000-01-01',
  },
  {
    capacidade_litros: 1000,
    tarifa_diaria: '1.25242105998775',
    vigencia_inicio: '2000-01-01',
  },
]);

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

function toIsoDate(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizeTarifa(row) {
  if (!row) return null;
  const capacidade =
    snapCapacidadeConhecida(row.capacidade_litros) ?? roundLiters(row.capacidade_litros);
  if (capacidade == null) return null;
  return {
    id: row.id,
    capacidade_litros: capacidade,
    tarifa_diaria: normalizeDecimalString(row.tarifa_diaria) ?? '0',
    vigencia_inicio: toIsoDate(row.vigencia_inicio),
    vigencia_fim: toIsoDate(row.vigencia_fim),
    observacao: row.observacao || null,
    created_by: row.created_by || null,
    created_at: row.created_at || null,
  };
}

function coversDate(tarifa, day) {
  if (!tarifa?.vigencia_inicio || !day) return false;
  if (tarifa.vigencia_inicio > day) return false;
  if (tarifa.vigencia_fim && tarifa.vigencia_fim < day) return false;
  return true;
}

/** Lista tarifas (mais recentes primeiro). */
export async function listFaturamentoTarifasVasilhames() {
  assertConfigured('list');
  const { data, error } = await chemflowSupabase
    .from(TABLE)
    .select('*')
    .order('vigencia_inicio', { ascending: false });
  throwIfError(error, 'list');
  return (data || [])
    .map(normalizeTarifa)
    .filter(Boolean)
    .sort((a, b) => {
      const byVig = String(b.vigencia_inicio || '').localeCompare(String(a.vigencia_inicio || ''));
      if (byVig !== 0) return byVig;
      return Number(a.capacidade_litros) - Number(b.capacidade_litros);
    });
}

/**
 * Resolve tarifa vigente para capacidade + data.
 * Preferência: maior vigencia_inicio <= dia, dentro da janela vigencia_fim.
 */
export function resolveTarifaVasilhameForDate(tarifas, capacidadeLitros, dateIso) {
  const day = toIsoDate(dateIso);
  const capacidade =
    snapCapacidadeConhecida(capacidadeLitros) ?? roundLiters(capacidadeLitros);
  if (!day || capacidade == null) return null;

  const sorted = [...(tarifas || [])]
    .map(normalizeTarifa)
    .filter(
      (t) =>
        t?.vigencia_inicio &&
        Math.abs(Number(t.capacidade_litros) - Number(capacidade)) < 0.5
    )
    .sort((a, b) => String(b.vigencia_inicio).localeCompare(String(a.vigencia_inicio)));

  const match = sorted.find((t) => coversDate(t, day));
  if (match) return match;

  // Sem vigencia_fim explícita: maior vigencia_inicio <= dia
  const open = sorted.find((t) => t.vigencia_inicio <= day && !t.vigencia_fim);
  if (open) return open;

  const seed = DEFAULT_SEEDS.find(
    (s) => Math.abs(Number(s.capacidade_litros) - Number(capacidade)) < 0.5
  );
  return seed
    ? {
        ...seed,
        capacidade_litros: Number(seed.capacidade_litros),
        vigencia_fim: null,
        observacao: null,
        id: null,
      }
    : null;
}

/** Tarifas vigentes “hoje” por capacidade (mapa). */
export function getTarifasVigentesPorCapacidade(tarifas, dateIso = todayISO()) {
  const map = new Map();
  for (const cap of CAPACIDADES_NOMINAIS_PADRAO) {
    const t = resolveTarifaVasilhameForDate(tarifas, cap, dateIso);
    if (t) map.set(cap, t);
  }
  // Inclui capacidades extras cadastradas
  for (const row of tarifas || []) {
    const cap = roundLiters(row.capacidade_litros);
    if (cap == null || map.has(cap)) continue;
    const t = resolveTarifaVasilhameForDate(tarifas, cap, dateIso);
    if (t) map.set(cap, t);
  }
  return map;
}

/**
 * Cria/atualiza vigência.
 * Mesma (capacidade + vigencia_inicio) → atualiza; senão novo histórico.
 */
export async function createFaturamentoTarifaVasilhame({
  id,
  capacidade_litros,
  tarifa_diaria,
  vigencia_inicio,
  vigencia_fim,
  observacao,
  created_by,
} = {}) {
  assertConfigured('create');

  const capacidade =
    snapCapacidadeConhecida(capacidade_litros) ?? roundLiters(capacidade_litros);
  const tarifa = normalizeDecimalString(tarifa_diaria);
  const vigencia = toIsoDate(vigencia_inicio) || todayISO();
  const fim = toIsoDate(vigencia_fim);

  if (capacidade == null || tarifa == null) {
    throw new Error('Informe capacidade e tarifa diária válidas.');
  }
  if (fim && fim < vigencia) {
    throw new Error('A data final da vigência deve ser posterior ou igual à inicial.');
  }

  const payload = {
    capacidade_litros: capacidade,
    tarifa_diaria: tarifa,
    vigencia_inicio: vigencia,
    vigencia_fim: fim,
    observacao: observacao ? String(observacao).trim() || null : null,
    created_by: created_by ? String(created_by) : null,
  };

  if (id) {
    const { data, error } = await chemflowSupabase
      .from(TABLE)
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    throwIfError(error, 'create');
    return normalizeTarifa(data);
  }

  const { data: existing, error: existingError } = await chemflowSupabase
    .from(TABLE)
    .select('id')
    .eq('capacidade_litros', capacidade)
    .eq('vigencia_inicio', vigencia)
    .maybeSingle();
  throwIfError(existingError, 'create');

  let data;
  if (existing?.id) {
    const { data: updated, error } = await chemflowSupabase
      .from(TABLE)
      .update({
        tarifa_diaria: payload.tarifa_diaria,
        vigencia_fim: payload.vigencia_fim,
        observacao: payload.observacao,
        created_by: payload.created_by,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    throwIfError(error, 'create');
    data = updated;
  } else {
    const { data: inserted, error } = await chemflowSupabase
      .from(TABLE)
      .insert(payload)
      .select('*')
      .single();
    throwIfError(error, 'create');
    data = inserted;
  }

  return normalizeTarifa(data);
}

export async function deleteFaturamentoTarifaVasilhame(id) {
  assertConfigured('delete');
  if (!id) throw new Error('Informe o id da vigência.');
  const { error } = await chemflowSupabase.from(TABLE).delete().eq('id', id);
  throwIfError(error, 'delete');
  return true;
}

export {
  canManageFaturamentoTarifaHistory,
  formatTarifaRate,
  rateInputValue,
  parseRateInput,
  rateToNumber,
  todayISO,
  currentMonthRange,
  CAPACIDADES_NOMINAIS_PADRAO,
  DEFAULT_SEEDS,
};
