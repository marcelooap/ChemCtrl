/**
 * Carga anual dos carregamentos concluídos para o Dashboard Logística.
 */

import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';
import { computePainelLogisticaDashboard } from '@painel/lib/dashboardLogisticaMetrics';

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

const SELECT_COLS = [
  'id',
  'data',
  'horario',
  'status',
  'hora_carregamento',
  'data_carregamento',
  'cliente_nome',
  'justificativa_atraso_responsavel',
  'justificativa_atraso_motivo',
  'grupo_conclusao_id',
  'transportadora',
  'motorista',
  'placa',
  'operador_conclusao_nome',
  'usuario_nome',
  'saida_codigo',
  'updated_at',
].join(', ');

function assertConfigured(context) {
  if (!isChemFlowConfigured || !chemflowSupabase) {
    throw new Error(`[PainelDashboardLogistica:${context}] ${CHEMFLOW_CONFIG_ERROR}`);
  }
}

async function fetchAllPages(buildQuery, context) {
  assertConfigured(context);
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) {
      throw new Error(
        `[PainelDashboardLogistica:${context}] ${error.message || 'Erro Supabase'}`
      );
    }
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return rows;
}

/** Carregamentos concluídos com data agendada no ano (e vizinhança para virada). */
export async function fetchCarregamentosConcluidosByYear(year) {
  const y = Number(year);
  const fromDate = `${y}-01-01`;
  const toDate = `${y}-12-31`;

  const byData = await fetchAllPages(
    () =>
      chemflowSupabase
        .from('t_agendamentos_carregamento')
        .select(SELECT_COLS)
        .eq('status', 'concluido')
        .gte('data', fromDate)
        .lte('data', toDate)
        .order('data', { ascending: true }),
    'agendamentos.by_data'
  );

  // Inclui concluídos cuja data_carregamento cai no ano, mesmo se agendados antes.
  let byCarregamento = [];
  try {
    byCarregamento = await fetchAllPages(
      () =>
        chemflowSupabase
          .from('t_agendamentos_carregamento')
          .select(SELECT_COLS)
          .eq('status', 'concluido')
          .gte('data_carregamento', fromDate)
          .lte('data_carregamento', toDate)
          .order('data_carregamento', { ascending: true }),
      'agendamentos.by_carregamento'
    );
  } catch (err) {
    console.warn(
      '[PainelDashboardLogistica] data_carregamento filter fallback:',
      err?.message || err
    );
  }

  const byId = new Map();
  for (const row of [...byData, ...byCarregamento]) {
    if (row?.id) byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

export async function loadPainelLogisticaDashboard(year) {
  const rows = await fetchCarregamentosConcluidosByYear(year);
  return {
    source: 'client',
    year: Number(year),
    agendamentos: rows,
    meta: { rows: rows.length },
  };
}

export function buildPainelLogisticaDashboardView(payload, { year, month, t } = {}) {
  return computePainelLogisticaDashboard(payload?.agendamentos || [], {
    year: Number(year ?? payload?.year),
    month,
    t,
  });
}
