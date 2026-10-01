import { toDateInputValue } from '@/i18n/formatters';
import { productsMatch } from '@industrializacao/lib/recipeRevisions';

const normalize = (value) => String(value || '').trim().toLocaleLowerCase('pt-BR');

/** Inteiro positivo de dias de validade, ou null. */
export function parseValidityDays(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * Dias de validade do Cadastro CQ (ind_cq_esp_tec).
 * Prioriza o ensaio do mesmo produto e cliente; se não houver, o do produto.
 * Em empate, usa o registro mais recente.
 */
export function resolveQualityValidityDays(tests, product, client) {
  const clientKey = normalize(client);
  const ranked = (tests || [])
    .filter((row) => productsMatch(row?.product, product))
    .map((row) => ({ row, days: parseValidityDays(row.validity_days) }))
    .filter((item) => item.days != null);

  const sameClient = clientKey
    ? ranked.filter((item) => normalize(item.row.client) === clientKey)
    : [];
  const pool = sameClient.length ? sameClient : ranked;
  if (!pool.length) return null;

  pool.sort((a, b) => {
    const ta = new Date(a.row.updated_date || a.row.created_date || 0).getTime();
    const tb = new Date(b.row.updated_date || b.row.created_date || 0).getTime();
    return tb - ta;
  });
  return pool[0].days;
}

/**
 * Data de validade = data de fabricação (dia de calendário exibido) + dias.
 * Retorna um Date local, ou null se faltar a data ou os dias.
 */
export function addValidityDays(manufactureDate, validityDays) {
  const ymd = toDateInputValue(manufactureDate);
  const days = parseValidityDays(validityDays);
  if (!ymd || days == null) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const local = new Date(y, m - 1, d);
  local.setDate(local.getDate() + days);
  return local;
}
