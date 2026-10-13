/**
 * Verificação da validade dos testes do tanque (Check List Expedição).
 *
 * As datas trafegam como "YYYY-MM-DD" (data de calendário, sem horário) e a
 * aritmética é feita em UTC, evitando deslocamentos de fuso e de horário de verão.
 */

export const VALIDADE_TESTES_PRAZO_PADRAO_DIAS = 180;
export const VALIDADE_TESTES_PRAZO_MIN_DIAS = 1;
export const VALIDADE_TESTES_PRAZO_MAX_DIAS = 3650;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const MS_PER_DAY = 86_400_000;

/**
 * Converte o prazo informado em inteiro válido.
 * @returns {number|null} `null` quando vazio, não numérico ou fora do intervalo permitido.
 */
export function parsePrazoDias(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const dias = Number(text);
  if (dias < VALIDADE_TESTES_PRAZO_MIN_DIAS || dias > VALIDADE_TESTES_PRAZO_MAX_DIAS) {
    return null;
  }
  return dias;
}

/** Prazo válido ou o padrão (180 dias) — usado ao ler dados persistidos. */
export function normalizePrazoDias(value) {
  return parsePrazoDias(value) ?? VALIDADE_TESTES_PRAZO_PADRAO_DIAS;
}

/**
 * Data limite = dia de calendário local de `base` + `dias`.
 * Ex.: 13/10/2026 + 180 dias → "2027-04-11".
 * @param {number} dias
 * @param {Date} [base]
 * @returns {string} "YYYY-MM-DD"
 */
export function calcularDataLimiteTestes(dias, base = new Date()) {
  const prazo = normalizePrazoDias(dias);
  const utcMs = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()) + prazo * MS_PER_DAY;
  return new Date(utcMs).toISOString().slice(0, 10);
}

/**
 * Formata "YYYY-MM-DD" (ou ISO completo) sem passar por fuso horário.
 * @returns {string} data localizada ou "—" quando inválida.
 */
export function formatDataLimiteTestes(value, language = 'pt-BR') {
  const match = ISO_DATE_RE.exec(String(value || ''));
  if (!match) return '—';
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(language || 'pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
