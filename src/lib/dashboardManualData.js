/**
 * Totais mensais informados manualmente (ex.: consolidado de fonte externa
 * ou histórico antes do uso completo do sistema).
 * month: 0 = janeiro … 11 = dezembro
 */
export const MANUAL_MONTHLY_TOTALS = [
  {
    year: 2026,
    month: 5, // junho
    volume: 885735,
    revenue: 510903.03,
  },
];

export function getManualMonthlyTotal(year, month) {
  return MANUAL_MONTHLY_TOTALS.find((e) => e.year === year && e.month === month) ?? null;
}
