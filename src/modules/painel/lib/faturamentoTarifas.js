/**
 * CRUD e resolução de tarifas versionadas do faturamento embalado.
 * Tabela: t_faturamento_tarifas
 *
 * Tarifas são mantidas como string decimal (até 15 casas) para não perder
 * precisão no Number do JS. Cálculos monetários arredondam só o valor final.
 */
import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';
import { isAdminUser } from '@industrializacao/lib/permissions';

const TABLE = 't_faturamento_tarifas';
export const RATE_MAX_DECIMALS = 15;

const DEFAULT_RATES = Object.freeze({
  vigencia_inicio: '2000-01-01',
  movimentacao_palete: '25.57',
  armazenagem_tenda: '2',
  armazenagem_patio: '1.25',
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

function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Editar/excluir histórico: apenas Marcelo Amaral + administrador.
 */
export function canManageFaturamentoTarifaHistory(user) {
  if (!isAdminUser(user)) return false;
  const name = stripDiacritics(user?.nome || user?.full_name || user?.nome_completo || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return name.includes('marcelo') && name.includes('amaral');
}

/**
 * Canonicaliza decimal como string "123.456" (máx. 15 casas), sem float round-trip
 * quando a entrada já é string decimal limpa.
 */
export function normalizeDecimalString(value) {
  if (value == null || value === '') return null;

  let raw = String(value).trim().replace(/\s/g, '');
  if (!raw) return null;

  if (raw.includes(',')) {
    raw = raw.replace(/\./g, '').replace(',', '.');
  }

  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    raw = n.toFixed(RATE_MAX_DECIMALS);
  }

  if (raw.startsWith('-')) return null;

  let [intPart, frac = ''] = raw.split('.');
  intPart = intPart.replace(/^0+(?=\d)/, '') || '0';
  if (frac.length > RATE_MAX_DECIMALS) {
    frac = frac.slice(0, RATE_MAX_DECIMALS);
  }
  frac = frac.replace(/0+$/, '');

  return frac ? `${intPart}.${frac}` : intPart;
}

/** Number para cálculo (mantém o máximo possível da string). */
export function rateToNumber(value) {
  const s = normalizeDecimalString(value);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** @deprecated use normalizeDecimalString / rateToNumber */
export function toRate(value) {
  return rateToNumber(value);
}

/** Exibe tarifa em R$ preservando todas as casas úteis (mín. 2). */
export function formatTarifaRate(value) {
  const s = normalizeDecimalString(value);
  if (s == null) return '—';

  const [intPart, frac = ''] = s.split('.');
  const intFmt = Number(intPart).toLocaleString('pt-BR');
  const shown = frac.length <= 2 ? frac.padEnd(2, '0') : frac;
  return `R$ ${intFmt},${shown}`;
}

/** Valor para input (vírgula decimal, sem zeros à direita). */
export function rateInputValue(value) {
  const s = normalizeDecimalString(value);
  if (s == null) return '';
  return s.replace('.', ',');
}

/** Parse de input de tarifa → string decimal canônica. */
export function parseRateInput(raw) {
  return normalizeDecimalString(raw);
}

function normalizeTarifa(row) {
  if (!row) return null;
  return {
    id: row.id,
    vigencia_inicio: toIsoDate(row.vigencia_inicio),
    movimentacao_palete: normalizeDecimalString(row.movimentacao_palete) ?? '0',
    armazenagem_tenda: normalizeDecimalString(row.armazenagem_tenda) ?? '0',
    armazenagem_patio: normalizeDecimalString(row.armazenagem_patio) ?? '0',
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
 * Cria ou atualiza vigência.
 * Mesma vigencia_inicio → atualiza (correção); data nova → novo histórico.
 * Se `id` for informado, atualiza aquele registro (permite corrigir a data).
 */
export async function createFaturamentoTarifa({
  id,
  vigencia_inicio,
  movimentacao_palete,
  armazenagem_tenda,
  armazenagem_patio,
  observacao,
  created_by,
} = {}) {
  assertConfigured('create');

  const vigencia = toIsoDate(vigencia_inicio) || todayISO();
  const mov = normalizeDecimalString(movimentacao_palete);
  const tenda = normalizeDecimalString(armazenagem_tenda);
  const patio = normalizeDecimalString(armazenagem_patio);

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

  if (id) {
    const { data, error } = await chemflowSupabase
      .from(TABLE)
      .update({
        vigencia_inicio: payload.vigencia_inicio,
        movimentacao_palete: payload.movimentacao_palete,
        armazenagem_tenda: payload.armazenagem_tenda,
        armazenagem_patio: payload.armazenagem_patio,
        observacao: payload.observacao,
        created_by: payload.created_by,
      })
      .eq('id', id)
      .select('*')
      .single();
    throwIfError(error, 'create');
    return normalizeTarifa(data);
  }

  const { data: existing, error: existingError } = await chemflowSupabase
    .from(TABLE)
    .select('id')
    .eq('vigencia_inicio', vigencia)
    .maybeSingle();
  throwIfError(existingError, 'create');

  let data;
  if (existing?.id) {
    const { data: updated, error } = await chemflowSupabase
      .from(TABLE)
      .update({
        movimentacao_palete: payload.movimentacao_palete,
        armazenagem_tenda: payload.armazenagem_tenda,
        armazenagem_patio: payload.armazenagem_patio,
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

/** Exclui uma vigência pelo id. */
export async function deleteFaturamentoTarifa(id) {
  assertConfigured('delete');
  if (!id) throw new Error('Informe o id da vigência.');

  const { error } = await chemflowSupabase.from(TABLE).delete().eq('id', id);
  throwIfError(error, 'delete');
  return true;
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
