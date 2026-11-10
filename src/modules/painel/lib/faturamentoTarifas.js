/**
 * CRUD e resolução de tarifas versionadas do faturamento embalado.
 * Tabela: t_faturamento_tarifas
 */
import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';

const TABLE = 't_faturamento_tarifas';

const DEFAULT_RATES = Object.freeze({
  vigencia_inicio: '2000-01-01',
  movimentacao_palete: 25.57,
  armazenagem_tenda: 2.0,
  armazenagem_patio: 1.25,
});

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

function toMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeTarifa(row) {
  if (!row) return null;
  return {
    id: row.id,
    vigencia_inicio: toIsoDate(row.vigencia_inicio),
    movimentacao_palete: Number(row.movimentacao_palete) || 0,
    armazenagem_tenda: Number(row.armazenagem_tenda) || 0,
    armazenagem_patio: Number(row.armazenagem_patio) || 0,
    observacao: row.observacao || null,
    created_by: row.created_by || null,
    created_at: row.created_at || null,
  };
}

/** Lista tarifas ordenadas da mais recente para a mais antiga. */
export async function listFaturamentoTarifas() {
  assertConfigured('list');
  const { data, error } = await chemflowSupabase
    .from(TABLE)
    .select('*')
    .order('vigencia_inicio', { ascending: false });
  throwIfError(error, 'list');
  return (data || []).map(normalizeTarifa).filter(Boolean);
}

/**
 * Resolve a tarifa vigente para a data (última vigencia_inicio <= date).
 * @param {Array} tarifas — lista já carregada (qualquer ordem)
 * @param {string} dateIso — YYYY-MM-DD
 */
export function resolveTarifaForDate(tarifas, dateIso) {
  const day = toIsoDate(dateIso);
  if (!day) return { ...DEFAULT_RATES };

  const sorted = [...(tarifas || [])]
    .map(normalizeTarifa)
    .filter((t) => t?.vigencia_inicio)
    .sort((a, b) => String(b.vigencia_inicio).localeCompare(String(a.vigencia_inicio)));

  const match = sorted.find((t) => t.vigencia_inicio <= day);
  if (match) return match;

  const oldest = sorted[sorted.length - 1];
  return oldest || { ...DEFAULT_RATES };
}

/** Tarifa vigente “hoje” (ou data informada). */
export function getTarifaVigente(tarifas, dateIso = todayISO()) {
  return resolveTarifaForDate(tarifas, dateIso);
}

/**
 * Cria nova vigência (reajuste). Não altera registros anteriores.
 */
export async function createFaturamentoTarifa({
  vigencia_inicio,
  movimentacao_palete,
  armazenagem_tenda,
  armazenagem_patio,
  observacao,
  created_by,
} = {}) {
  assertConfigured('create');

  const vigencia = toIsoDate(vigencia_inicio) || todayISO();
  const mov = toMoney(movimentacao_palete);
  const tenda = toMoney(armazenagem_tenda);
  const patio = toMoney(armazenagem_patio);

  if (mov == null || tenda == null || patio == null) {
    throw new Error('Informe valores válidos para as tarifas.');
  }

  const payload = {
    vigencia_inicio: vigencia,
    movimentacao_palete: mov,
    armazenagem_tenda: tenda,
    armazenagem_patio: patio,
    observacao: observacao ? String(observacao).trim() || null : null,
    created_by: created_by ? String(created_by) : null,
  };

  const { data, error } = await chemflowSupabase
    .from(TABLE)
    .insert(payload)
    .select('*')
    .single();
  throwIfError(error, 'create');
  return normalizeTarifa(data);
}

export function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function currentMonthRange() {
  const today = todayISO();
  const [y, m] = today.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from: start, to: end };
}

export { DEFAULT_RATES };
