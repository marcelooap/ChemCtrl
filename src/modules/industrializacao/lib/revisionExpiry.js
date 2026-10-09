import { toDateInputValue, todayDateInputValue } from '@/i18n/formatters';

/** Prazo de verificação com o cliente, em meses de calendário. */
export const REVISION_EXPIRY_MONTHS = 6;

/** Até este número de dias restantes (inclusive) o badge fica em alerta. */
export const REVISION_EXPIRY_WARNING_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}

/**
 * Soma meses de calendário a uma data YYYY-MM-DD.
 * Se o dia não existir no mês de destino (ex.: 31/08 + 6 meses), usa o último dia desse mês.
 */
export function addCalendarMonths(ymd, months) {
  const { y, m, d } = parseYmd(ymd);
  const monthIndex = (m - 1) + months;
  const targetYear = y + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

function diffCalendarDays(fromYmd, toYmd) {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  const utcFrom = Date.UTC(from.y, from.m - 1, from.d);
  const utcTo = Date.UTC(to.y, to.m - 1, to.d);
  return Math.round((utcTo - utcFrom) / MS_PER_DAY);
}

/**
 * Dias restantes até (data da revisão + 6 meses).
 * Positivo = dentro do prazo, 0 = vence hoje, negativo = vencido.
 * Não persiste o resultado: cada leitura usa a data atual.
 * Retorna null quando não há data de revisão válida.
 */
export function revisionExpiryDaysRemaining(revisionDate, todayYmd = todayDateInputValue()) {
  const start = toDateInputValue(revisionDate);
  if (!start || !todayYmd) return null;
  const due = addCalendarMonths(start, REVISION_EXPIRY_MONTHS);
  return diffCalendarDays(todayYmd, due);
}

/** ok: > 30 dias · warning: 0 a 30 · expired: < 0 · unknown: sem data */
export function revisionExpiryTone(days) {
  if (days == null || !Number.isFinite(days)) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= REVISION_EXPIRY_WARNING_DAYS) return 'warning';
  return 'ok';
}
