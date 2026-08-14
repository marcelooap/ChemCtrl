export const WEEKDAY_COUNT = 6;

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISODate(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isSameISODate(a, b) {
  return String(a) === String(b);
}

export function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function todayISO() {
  return toISODate(new Date());
}

export function scheduleDateKey(row) {
  return String(row?.scheduled_date || '').slice(0, 10);
}

function makeCell(date, inMonth) {
  return {
    date,
    iso: toISODate(date),
    day: date.getDate(),
    weekday: date.getDay(),
    inMonth,
  };
}

/**
 * Semanas operacionais do mês (segunda–sábado).
 * Dias de outros meses preenchem o alinhamento da grade (inMonth: false).
 */
export function getMonthWeeksMonSat(year, monthIndex) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const weeks = [];
  let current = [];

  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, monthIndex, day);
    const jsDay = date.getDay();
    if (jsDay === 0) continue;

    const weekday = jsDay;
    if (current.length === 0 && weekday > 1) {
      for (let i = 1; i < weekday; i += 1) {
        current.push(makeCell(new Date(year, monthIndex, day - (weekday - i)), false));
      }
    }

    current.push(makeCell(date, true));

    if (weekday === 6) {
      weeks.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    let offset = 1;
    while (current.length < WEEKDAY_COUNT) {
      const pad = new Date(year, monthIndex, lastDay + offset);
      offset += 1;
      if (pad.getDay() === 0) continue;
      current.push(makeCell(pad, false));
    }
    weeks.push(current);
  }

  return weeks;
}
