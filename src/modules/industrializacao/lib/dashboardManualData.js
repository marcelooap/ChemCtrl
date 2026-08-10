/**
 * Totais mensais informados manualmente (ex.: consolidado de fonte externa
 * ou histórico antes do uso completo do sistema).
 * month: 0 = janeiro … 11 = dezembro
 *
 * Quando houver entrada manual para o mês, ela tem prioridade sobre as
 * produções do sistema (totais, clientes e produtos).
 */
export const MANUAL_MONTHLY_TOTALS = [
  {
    year: 2026,
    month: 5, // junho
    volume: 885735.233,
    mass: 868285,
    revenue: 510903.03,
    clients: [
      { client: 'CLARIANT', volume: 100000, revenue: 129473.25 },
      { client: 'REDA ENERGY', volume: 124735.233, revenue: 17818.9 },
      { client: 'ARKEMA COATEX', volume: 125500, revenue: 92269.52 },
      { client: 'VEOLIA', volume: 25000, revenue: 16478 },
      { client: 'BAKER HUGHES', volume: 70500, revenue: 57532.3 },
      { client: 'VIBRA ENERGIA', volume: 440000, revenue: 197331.07 },
    ],
    products: [
      { product: 'MULTITREAT DF 15918', volume: 100000, revenue: 129473.25 },
      { product: 'RO SC F656 (Baixo Teor)', volume: 93987.423, revenue: 13346.21 },
      { product: 'PROCHINOR GM 129', volume: 46500, revenue: 46719.02 },
      { product: 'PROSOLV EB 8379', volume: 25000, revenue: 16478 },
      { product: 'PROCHINOR TL 93', volume: 30000, revenue: 32630.4 },
      { product: 'NE-18 LB', volume: 15000, revenue: 11475 },
      { product: 'INIPOL AD 1700 BW', volume: 9000, revenue: 6138.99 },
      { product: 'SISBRAX ACE 75', volume: 400000, revenue: 179056.61 },
      { product: 'SISBRAX MEG 80', volume: 40000, revenue: 18274.46 },
      { product: 'SCW 17350', volume: 10000, revenue: 8321.68 },
      { product: 'SCW 17397', volume: 15000, revenue: 11399.25 },
      { product: 'INIPOL AH 99', volume: 40000, revenue: 6781.12 },
      { product: 'A -7 LB', volume: 9000, revenue: 8690.41 },
      { product: 'RO SC F611 (Alto Teor)', volume: 30747.81, revenue: 4472.68 },
      { product: 'SCW 17395', volume: 5000, revenue: 3814.49 },
      { product: 'PARAVAN - 25LB', volume: 16500, revenue: 13831.46 },
    ],
  },
];

export function getManualMonthlyTotal(year, month) {
  return MANUAL_MONTHLY_TOTALS.find((e) => e.year === year && e.month === month) ?? null;
}

export function getManualMonthlyClients(year, month) {
  const entry = getManualMonthlyTotal(year, month);
  return entry?.clients?.length ? entry.clients : null;
}

export function getManualMonthlyProducts(year, month) {
  const entry = getManualMonthlyTotal(year, month);
  return entry?.products?.length ? entry.products : null;
}
