/**
 * Carga dos dados do Dashboard Painel (visão Transbordo).
 * Consultas filtradas por ano + colunas mínimas; paginação até o fim.
 */

import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';
import { computePainelTransbordoDashboard } from '@painel/lib/dashboardTransbordoMetrics';

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

function assertConfigured(context) {
  if (!isChemFlowConfigured || !chemflowSupabase) {
    throw new Error(`[PainelDashboard:${context}] ${CHEMFLOW_CONFIG_ERROR}`);
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
      throw new Error(`[PainelDashboard:${context}] ${error.message || 'Erro Supabase'}`);
    }
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return rows;
}

function yearBounds(year) {
  const y = Number(year);
  return {
    fromDate: `${y}-01-01`,
    toDate: `${y}-12-31`,
    fromTs: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)).toISOString(),
    toTs: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)).toISOString(),
  };
}

/** Transbordos do ano (data operacional). */
export async function fetchTransbordosByYear(year) {
  const { fromDate, toDate } = yearBounds(year);
  return fetchAllPages(
    () =>
      chemflowSupabase
        .from('t_transbordos')
        .select(
          'id, data, produto_id, densidade, volume_total, operadores, origens, destinos'
        )
        .gte('data', fromDate)
        .lte('data', toDate)
        .order('data', { ascending: true }),
    't_transbordos'
  );
}

function productionInYear(production, year) {
  const raw = production?.end_time || production?.updated_date;
  if (!raw) return false;
  const d = new Date(raw);
  return !Number.isNaN(d.getTime()) && d.getFullYear() === Number(year);
}

/**
 * OPs finalizadas do ano (end_time; fallback updated_date no filtro local).
 * Tabela live usa updated_date (não updated_at).
 */
export async function fetchProducoesFinalizadasByYear(year) {
  const { fromTs, toTs } = yearBounds(year);
  const selectCols =
    'id, volume, status, operator, end_time, updated_date, op_number';

  try {
    const [byEndTime, missingEnd] = await Promise.all([
      fetchAllPages(
        () =>
          chemflowSupabase
            .from('ind_lista_producoes')
            .select(selectCols)
            .eq('status', 'Finalizado')
            .gte('end_time', fromTs)
            .lte('end_time', toTs)
            .order('end_time', { ascending: true }),
        'ind_lista_producoes.end_time'
      ),
      fetchAllPages(
        () =>
          chemflowSupabase
            .from('ind_lista_producoes')
            .select(selectCols)
            .eq('status', 'Finalizado')
            .is('end_time', null)
            .order('id', { ascending: true }),
        'ind_lista_producoes.null_end'
      ),
    ]);

    const byId = new Map();
    for (const row of byEndTime) {
      if (row?.id) byId.set(row.id, row);
    }
    for (const row of missingEnd) {
      if (row?.id && productionInYear(row, year)) byId.set(row.id, row);
    }
    return Array.from(byId.values());
  } catch (err) {
    console.warn('[PainelDashboard] fallback producoes por status:', err?.message || err);
    const all = await fetchAllPages(
      () =>
        chemflowSupabase
          .from('ind_lista_producoes')
          .select(selectCols)
          .eq('status', 'Finalizado')
          .order('id', { ascending: true }),
      'ind_lista_producoes.fallback'
    );
    return all.filter((p) => productionInYear(p, year));
  }
}

/** Mapa leve produto → filtrado (cadastro_produtos, fallback t_produtos). */
export async function fetchProdutosFiltradoFlag() {
  try {
    return await fetchAllPages(
      () =>
        chemflowSupabase
          .from('cadastro_produtos')
          .select('id, filtrado')
          .order('id', { ascending: true }),
      'cadastro_produtos'
    );
  } catch (err) {
    console.warn('[PainelDashboard] fallback t_produtos:', err?.message || err);
    return fetchAllPages(
      () =>
        chemflowSupabase
          .from('t_produtos')
          .select('id, filtrado')
          .order('id', { ascending: true }),
      't_produtos'
    );
  }
}

/**
 * Tenta RPC agregada; se indisponível (PGRST202), calcula no cliente.
 */
export async function loadPainelTransbordoDashboard(year) {
  assertConfigured('load');

  // Agregação no cliente: permite filtrar mês sem nova ida ao banco
  // (RPC anual permanece disponível no SQL para uso futuro).

  const [transbordosResult, producoesResult, produtosResult] = await Promise.allSettled([
    fetchTransbordosByYear(year),
    fetchProducoesFinalizadasByYear(year),
    fetchProdutosFiltradoFlag(),
  ]);

  const transbordos =
    transbordosResult.status === 'fulfilled' ? transbordosResult.value : [];
  const producoes =
    producoesResult.status === 'fulfilled' ? producoesResult.value : [];
  const produtos =
    produtosResult.status === 'fulfilled' ? produtosResult.value : [];

  if (transbordosResult.status === 'rejected') {
    throw transbordosResult.reason;
  }
  if (producoesResult.status === 'rejected') {
    console.warn(
      '[PainelDashboard] producoes indisponíveis:',
      producoesResult.reason?.message || producoesResult.reason
    );
  }
  if (produtosResult.status === 'rejected') {
    console.warn(
      '[PainelDashboard] produtos indisponíveis:',
      produtosResult.reason?.message || produtosResult.reason
    );
  }

  return {
    source: 'client',
    year: Number(year),
    transbordos,
    producoes,
    produtos,
    meta: {
      transbordos: transbordos.length,
      producoes: producoes.length,
      produtos: produtos.length,
    },
  };
}

/** Recomputa KPIs/gráficos a partir do payload anual + mês selecionado. */
export function buildPainelTransbordoDashboardView(payload, { year, month } = {}) {
  const y = Number(year ?? payload?.year);
  return computePainelTransbordoDashboard({
    transbordos: payload?.transbordos || [],
    producoes: payload?.producoes || [],
    produtos: payload?.produtos || [],
    year: y,
    month,
  });
}
