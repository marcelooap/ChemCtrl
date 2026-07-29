import moment from "moment";
import { parseNumero, roundVolume } from "@chemflow/lib/format";

const MONTH_SHORT = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

/** Mapa produto_id → filtrado (boolean). */
export function buildFilteredProductMap(produtos = []) {
  const map = new Map();
  for (const p of produtos) {
    if (p?.id != null) map.set(p.id, Boolean(p.filtrado));
  }
  return map;
}

export function getTransbordoVolume(t) {
  return roundVolume(parseNumero(t?.volume_total));
}

export function isFilteredTransbordo(t, filteredMap) {
  if (!t) return false;
  if (t.produto_id != null && filteredMap.has(t.produto_id)) {
    return filteredMap.get(t.produto_id);
  }
  return false;
}

export function getTransbordosInMonth(transbordos, year, month) {
  return (transbordos || []).filter((t) => {
    if (!t?.data) return false;
    const m = moment(t.data);
    return m.isValid() && m.year() === year && m.month() === month;
  });
}

function sumVolumes(list) {
  return list.reduce((s, t) => s + getTransbordoVolume(t), 0);
}

function sumFilteredVolumes(list, filteredMap) {
  return list.reduce((s, t) => {
    if (!isFilteredTransbordo(t, filteredMap)) return s;
    return s + getTransbordoVolume(t);
  }, 0);
}

/**
 * Rateia o volume do transbordo entre os operadores listados
 * (soma por operador = volume total do período).
 */
export function attributeVolumeToOperators(t) {
  const volume = getTransbordoVolume(t);
  const ops = Array.isArray(t?.operadores)
    ? t.operadores.filter((o) => o && String(o).trim())
    : [];
  if (!ops.length || volume === 0) return [];
  if (ops.length === 1) return [{ name: String(ops[0]).trim(), volume }];

  const base = Math.floor(volume / ops.length);
  let resto = volume - base * ops.length;
  return ops.map((name, i) => ({
    name: String(name).trim(),
    volume: base + (i < resto ? 1 : 0),
  }));
}

export function monthComparison(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function computeDashboardKpis(transbordos, produtos, referenceDate = new Date()) {
  const filteredMap = buildFilteredProductMap(produtos);
  const ref = moment(referenceDate);
  const year = ref.year();
  const month = ref.month();
  const prev = ref.clone().subtract(1, "month");

  const currentList = getTransbordosInMonth(transbordos, year, month);
  const previousList = getTransbordosInMonth(transbordos, prev.year(), prev.month());

  const volumeCurrent = sumVolumes(currentList);
  const volumeFiltered = sumFilteredVolumes(currentList, filteredMap);
  const volumePrevious = sumVolumes(previousList);
  const filteredPrevious = sumFilteredVolumes(previousList, filteredMap);

  const productMap = {};
  for (const t of currentList) {
    const key = (t.produto_nome || t.produto_codigo || "—").trim() || "—";
    productMap[key] = (productMap[key] || 0) + getTransbordoVolume(t);
  }
  const topProductEntry = Object.entries(productMap).sort((a, b) => b[1] - a[1])[0];
  const topProduct = topProductEntry
    ? {
        name: topProductEntry[0],
        volume: topProductEntry[1],
        percent: volumeCurrent > 0 ? (topProductEntry[1] / volumeCurrent) * 100 : 0,
      }
    : null;

  const operatorMap = {};
  for (const t of currentList) {
    for (const { name, volume } of attributeVolumeToOperators(t)) {
      operatorMap[name] = (operatorMap[name] || 0) + volume;
    }
  }
  const topOperatorEntry = Object.entries(operatorMap).sort((a, b) => b[1] - a[1])[0];
  const topOperator = topOperatorEntry
    ? {
        name: topOperatorEntry[0],
        volume: topOperatorEntry[1],
        percent: volumeCurrent > 0 ? (topOperatorEntry[1] / volumeCurrent) * 100 : 0,
      }
    : null;

  return {
    volumeCurrent,
    volumeFiltered,
    volumeChange: monthComparison(volumeCurrent, volumePrevious),
    filteredChange: monthComparison(volumeFiltered, filteredPrevious),
    filteredPercent: volumeCurrent > 0 ? (volumeFiltered / volumeCurrent) * 100 : 0,
    topProduct,
    topOperator,
    hasCurrentData: currentList.length > 0,
  };
}

export function buildMonthlyVolumeSeries(transbordos, produtos, year, referenceDate = new Date()) {
  const filteredMap = buildFilteredProductMap(produtos);
  const ref = moment(referenceDate);
  const currentMonth = ref.month();
  const currentYear = ref.year();

  return Array.from({ length: 12 }, (_, monthIndex) => {
    const list = getTransbordosInMonth(transbordos, year, monthIndex);
    const volume = sumVolumes(list);
    const volumeFiltered = sumFilteredVolumes(list, filteredMap);
    return {
      monthIndex,
      monthLabel: MONTH_SHORT[monthIndex],
      volume,
      volumeFiltered,
      isCurrent: monthIndex === currentMonth && year === currentYear,
    };
  });
}

export function buildClientVolumeSeries(transbordos, { year, month } = {}) {
  const list = getTransbordosInMonth(transbordos, year, month);
  const map = {};
  for (const t of list) {
    const key = (t.cliente_nome || "—").trim() || "—";
    map[key] = (map[key] || 0) + getTransbordoVolume(t);
  }
  const total = Object.values(map).reduce((s, v) => s + v, 0);
  return Object.entries(map)
    .map(([name, volume]) => ({
      name,
      volume,
      percent: total > 0 ? (volume / total) * 100 : 0,
    }))
    .sort((a, b) => b.volume - a.volume);
}

export function buildOperatorVolumeSeries(transbordos, { year, month } = {}) {
  const list = getTransbordosInMonth(transbordos, year, month);
  const map = {};
  for (const t of list) {
    for (const { name, volume } of attributeVolumeToOperators(t)) {
      map[name] = (map[name] || 0) + volume;
    }
  }
  return Object.entries(map)
    .map(([name, volume]) => ({ name, volume }))
    .sort((a, b) => b.volume - a.volume);
}
