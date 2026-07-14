import moment from 'moment';
import { matchesClient } from '@/lib/permissions';
import {
  getManualMonthlyTotal,
  getManualMonthlyClients,
} from '@/lib/dashboardManualData';

const CLIENT_LABEL_MAX = 14;

function truncateClientLabel(name) {
  const s = (name || '—').trim();
  if (s.length <= CLIENT_LABEL_MAX) return s;
  return `${s.slice(0, CLIENT_LABEL_MAX)}…`;
}

export function getFinishDate(production) {
  return production.end_time || production.updated_date || null;
}

export function getMass(production) {
  const mass = parseFloat(production.mass);
  if (!Number.isNaN(mass) && mass > 0) return mass;
  const volume = parseFloat(production.volume) || 0;
  const density = parseFloat(production.density) || 1;
  return volume * density;
}

/** Massa real registrada na OP (sem estimativa volume × densidade). */
export function getRegisteredMass(production) {
  const mass = parseFloat(production.mass);
  if (!Number.isNaN(mass) && mass > 0) return mass;
  return 0;
}

export function sumRegisteredMass(productions) {
  return productions.reduce((s, p) => s + getRegisteredMass(p), 0);
}

export function getRevenue(production) {
  return getMass(production) * (parseFloat(production.unit_price) || 0);
}

export function getFinishedProductions(productions, { month, year } = {}) {
  return productions.filter((p) => {
    if (p.status !== 'Finalizado') return false;
    const finishDate = getFinishDate(p);
    if (!finishDate) return false;
    const m = moment(finishDate);
    if (month != null && m.month() !== month) return false;
    if (year != null && m.year() !== year) return false;
    return true;
  });
}

export function monthComparison(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function resolveMonthTotals(productions, year, month) {
  const manual = getManualMonthlyTotal(year, month);
  if (manual) {
    return {
      volume: manual.volume,
      revenue: manual.revenue,
      hasData: true,
    };
  }

  const monthProds = getFinishedProductions(productions, { month, year });
  const volume = monthProds.reduce((s, p) => s + (parseFloat(p.volume) || 0), 0);
  const revenue = monthProds.reduce((s, p) => s + getRevenue(p), 0);

  return {
    volume,
    revenue,
    hasData: monthProds.length > 0,
  };
}

export function computeExecutiveKpis(productions, referenceDate = new Date()) {
  const ref = moment(referenceDate);
  const currentMonth = ref.month();
  const currentYear = ref.year();
  const prev = ref.clone().subtract(1, 'month');
  const prevMonth = prev.month();
  const prevYear = prev.year();

  const finishedCurrent = getFinishedProductions(productions, { month: currentMonth, year: currentYear });
  const finishedPrevious = getFinishedProductions(productions, { month: prevMonth, year: prevYear });

  const currentTotals = resolveMonthTotals(productions, currentYear, currentMonth);
  const previousTotals = resolveMonthTotals(productions, prevYear, prevMonth);

  const volumeCurrent = currentTotals.volume;
  const volumePrevious = previousTotals.volume;

  const revenueCurrent = currentTotals.revenue;
  const revenuePrevious = previousTotals.revenue;

  // massaTotalMes — única fonte para card de volume e preço médio/kg
  const massCurrent = sumRegisteredMass(finishedCurrent);
  const massPrevious = sumRegisteredMass(finishedPrevious);

  const avgPriceCurrent = massCurrent > 0 ? revenueCurrent / massCurrent : 0;
  const avgPricePrevious = massPrevious > 0 ? revenuePrevious / massPrevious : 0;

  const productMap = {};
  finishedCurrent.forEach((p) => {
    const key = p.product || '—';
    productMap[key] = (productMap[key] || 0) + (parseFloat(p.volume) || 0);
  });

  let topProduct = null;
  let entries = Object.entries(productMap).sort((a, b) => b[1] - a[1]);

  const manualEntry = getManualMonthlyTotal(currentYear, currentMonth);
  if (manualEntry) {
    entries = (manualEntry.products || [])
      .map((p) => [p.product || '—', parseFloat(p.volume) || 0])
      .sort((a, b) => b[1] - a[1]);
  }

  if (entries.length > 0 && volumeCurrent > 0) {
    const [name, volume] = entries[0];
    topProduct = {
      name,
      volume,
      percent: (volume / volumeCurrent) * 100,
    };
  }

  return {
    volumeCurrent,
    volumePrevious,
    volumeChange: monthComparison(volumeCurrent, volumePrevious),
    revenueCurrent,
    revenuePrevious,
    revenueChange: monthComparison(revenueCurrent, revenuePrevious),
    massCurrent,
    massPrevious,
    avgPriceCurrent,
    avgPricePrevious,
    avgPriceChange: massCurrent > 0 && massPrevious > 0
      ? monthComparison(avgPriceCurrent, avgPricePrevious)
      : null,
    topProduct,
    hasCurrentData: currentTotals.hasData,
  };
}

export function buildMonthlySeries(productions, year, referenceDate = new Date(), locale = 'pt-BR') {
  const ref = moment(referenceDate);
  const currentMonth = ref.month();
  const currentYear = ref.year();
  const months = [];

  for (let m = 0; m < 12; m++) {
    const monthMoment = moment({ year, month: m, day: 1 }).locale(locale);
    const totals = resolveMonthTotals(productions, year, m);
    months.push({
      monthIndex: m,
      month: monthMoment.format('MMM'),
      monthLabel: monthMoment.format('MMM'),
      volume: Math.round(totals.volume),
      revenue: Math.round(totals.revenue),
      isCurrent: year === currentYear && m === currentMonth,
    });
  }

  return months;
}

export function buildProductDistribution(
  productions,
  referenceDate = new Date(),
  { year, month } = {},
) {
  const ref = moment(referenceDate);
  const filterYear = year ?? ref.year();
  const filterMonth = month ?? ref.month();

  // Mês com consolidado manual: usa apenas o breakdown de produtos (mesmo se vazio).
  const manualEntry = getManualMonthlyTotal(filterYear, filterMonth);
  if (manualEntry) {
    const manualProducts = manualEntry.products || [];
    const items = manualProducts
      .map((p) => ({
        product: p.product || '—',
        volume: parseFloat(p.volume) || 0,
        percent: 0,
      }))
      .sort((a, b) => b.volume - a.volume);
    const total = items.reduce((s, i) => s + i.volume, 0);
    return {
      items: items.map((i) => ({
        ...i,
        percent: total > 0 ? (i.volume / total) * 100 : 0,
      })),
      total,
    };
  }

  const finished = getFinishedProductions(productions, {
    month: filterMonth,
    year: filterYear,
  });
  const productMap = {};
  finished.forEach((p) => {
    const key = p.product || '—';
    productMap[key] = (productMap[key] || 0) + (parseFloat(p.volume) || 0);
  });

  const total = Object.values(productMap).reduce((s, v) => s + v, 0);
  const items = Object.entries(productMap)
    .map(([product, volume]) => ({
      product,
      volume,
      percent: total > 0 ? (volume / total) * 100 : 0,
    }))
    .sort((a, b) => b.volume - a.volume);

  return { items, total };
}

export function buildProducoesFilterUrl({ product, referenceDate = new Date() } = {}) {
  const ref = moment(referenceDate);
  const from = ref.clone().startOf('month').format('YYYY-MM-DD');
  const to = ref.clone().endOf('month').format('YYYY-MM-DD');
  const params = new URLSearchParams({
    status: 'Finalizado',
    from,
    to,
  });
  if (product) params.set('product', product);
  return `/producoes?${params.toString()}`;
}

export function buildClientVolumeRevenueSeries(
  productions,
  { year, month, client, product, referenceDate = new Date() } = {},
) {
  const ref = moment(referenceDate);
  const filterYear = year ?? ref.year();
  const filterMonth = month ?? ref.month();

  if (!client && !product) {
    const manualClients = getManualMonthlyClients(filterYear, filterMonth);
    if (manualClients) {
      return manualClients
        .map((row) => {
          const vol = parseFloat(row.volume) || 0;
          const rev = parseFloat(row.revenue) || 0;
          const mass = parseFloat(row.mass) > 0 ? parseFloat(row.mass) : vol;
          return {
            client: row.client,
            clientLabel: truncateClientLabel(row.client),
            volume: Math.round(vol),
            mass,
            revenue: Math.round(rev),
            avgPricePerKg: mass > 0 ? rev / mass : null,
          };
        })
        .sort((a, b) => b.volume - a.volume);
    }
  }

  let finished = getFinishedProductions(productions, {
    year: filterYear,
    month: filterMonth,
  });
  if (client) finished = finished.filter((p) => matchesClient(p, client));
  if (product) finished = finished.filter((p) => (p.product || '') === product);

  const clientMap = {};
  finished.forEach((p) => {
    const key = (p.client || '').trim() || '—';
    if (!clientMap[key]) {
      clientMap[key] = { volume: 0, mass: 0, revenue: 0 };
    }
    clientMap[key].volume += parseFloat(p.volume) || 0;
    clientMap[key].mass += getMass(p);
    clientMap[key].revenue += getRevenue(p);
  });

  return Object.entries(clientMap)
    .map(([clientName, agg]) => ({
      client: clientName,
      clientLabel: truncateClientLabel(clientName),
      volume: Math.round(agg.volume),
      mass: agg.mass,
      revenue: Math.round(agg.revenue),
      avgPricePerKg: agg.mass > 0 ? agg.revenue / agg.mass : null,
    }))
    .sort((a, b) => b.volume - a.volume);
}

export function buildPedidosFilterUrl({ client } = {}) {
  const params = new URLSearchParams();
  if (client && client !== '—') params.set('client', client);
  const qs = params.toString();
  return qs ? `/pedidos?${qs}` : '/pedidos';
}
