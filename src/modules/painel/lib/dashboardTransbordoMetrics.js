/**
 * Motor de indicadores do Dashboard Painel — visão Transbordo.
 *
 * Fontes:
 * - t_transbordos (operações elegíveis de transbordo)
 * - ind_lista_producoes status=Finalizado (volume industrializado)
 * - cadastro_produtos.filtrado (sinal de produto, não classificação sozinha)
 *
 * Não usa saldo de estoque, entradas brutas nem t_filtracoes (espelho).
 */

import {
  parseNumero,
  parseDensidade,
  roundVolume,
  litrosFromMassaKg,
} from '@transbordo/lib/format';

export const CATEGORY = Object.freeze({
  CONVENCIONAL: 'convencional',
  INDUSTRIALIZADO: 'industrializado',
  FILTRADO: 'filtrado',
});

const MONTH_SHORT = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

export function buildFilteredProductMap(produtos = []) {
  const map = new Map();
  for (const p of produtos) {
    if (p?.id != null) map.set(String(p.id), Boolean(p.filtrado));
  }
  return map;
}

function isUnidadeMassa(um) {
  const u = String(um || '').trim().toLowerCase();
  return u === 'kg' || u === 'lb';
}

function isOrigemEmbaladoMassa(origem) {
  if (!origem) return false;
  const embalado =
    origem.tipo_origem === 'embalado' || Boolean(origem.embalado);
  if (!embalado) return false;
  return isUnidadeMassa(origem.unidade_medida || 'kg');
}

/**
 * Volume do destino em litros operacionais.
 * Origem embalada em kg/lb: converte via densidade do transbordo.
 */
export function destinoVolumeLitros(destino, origens = [], densidade) {
  const raw = roundVolume(destino?.volume_total ?? destino?.volume ?? 0);
  if (!(raw > 0)) return 0;

  const origem =
    Array.isArray(origens) && destino?.origem_uid
      ? origens.find((o) => o?._uid && o._uid === destino.origem_uid)
      : null;

  if (isOrigemEmbaladoMassa(origem)) {
    const um = String(origem.unidade_medida || 'kg').toLowerCase();
    const kg = um === 'lb' ? raw * 0.453592 : raw;
    return roundVolume(litrosFromMassaKg(kg, densidade));
  }

  return raw;
}

/**
 * Classifica um destino de transbordo.
 *
 * Regras (destino efetivo + flag do produto):
 * - Tankagem → sempre convencional (mesmo produto filtrado)
 * - Vasilhame + produto filtrado → filtrado
 * - Demais destinos (IBC/bombona/tambor, vasilhame sem filtro) → convencional
 *
 * Alinhado a isFiltracaoElegivel (somente tipo Vasilhame entra em filtração).
 */
export function classifyTransbordoDestino(destino, produtoFiltrado) {
  const tipo = String(destino?.tipo_embalagem || '').trim();
  if (tipo === 'Tankagem') return CATEGORY.CONVENCIONAL;
  if (produtoFiltrado && tipo === 'Vasilhame') return CATEGORY.FILTRADO;
  return CATEGORY.CONVENCIONAL;
}

/** Rateia volume entre operadores do transbordo (soma = volume). */
export function attributeVolumeToOperators(operadores, volume) {
  const vol = roundVolume(volume);
  const ops = Array.isArray(operadores)
    ? operadores.map((o) => String(o || '').trim()).filter(Boolean)
    : [];
  if (!ops.length || !(vol > 0)) return [];
  if (ops.length === 1) return [{ name: ops[0], volume: vol }];

  const n = ops.length;
  const base = Math.floor((vol * 1000) / n) / 1000;
  let assigned = 0;
  return ops.map((name, i) => {
    if (i === n - 1) {
      return { name, volume: roundVolume(vol - assigned) };
    }
    assigned = roundVolume(assigned + base);
    return { name, volume: base };
  });
}

function emptyMonthBuckets() {
  return Array.from({ length: 12 }, (_, monthIndex) => ({
    monthIndex,
    monthLabel: MONTH_SHORT[monthIndex],
    total: 0,
    convencional: 0,
    industrializado: 0,
    filtrado: 0,
  }));
}

function parseYearMonthDay(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return {
    year: d.getFullYear(),
    month: d.getMonth(),
    day: d.getDate(),
  };
}

function parseDateOnlyYearMonth(value) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return parseYearMonthDay(value);
  return {
    year: Number(m[1]),
    month: Number(m[2]) - 1,
    day: Number(m[3]),
  };
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function emptyDailyBuckets(year, monthIndex) {
  const days = daysInMonth(year, monthIndex);
  return Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    dayLabel: String(i + 1),
    volume: 0,
  }));
}

function buildDailySeries(slices, year, monthIndex) {
  if (monthIndex == null || Number.isNaN(Number(monthIndex))) return [];
  const daily = emptyDailyBuckets(year, Number(monthIndex));
  for (const s of slices) {
    if (s.year !== year || s.month !== Number(monthIndex)) continue;
    const day = Number(s.day);
    if (!(day >= 1) || day > daily.length) continue;
    daily[day - 1].volume = roundVolume(daily[day - 1].volume + s.volume);
  }
  return daily;
}

export function getProductionFinishDate(production) {
  return production?.end_time || production?.updated_date || null;
}

export function isFinishedProduction(production) {
  if (!production || production.status !== 'Finalizado') return false;
  const op = String(production.op_number || '');
  if (op.startsWith('TB')) return false;
  return Boolean(getProductionFinishDate(production));
}

/**
 * Expande um transbordo em fatias classificadas (por destino).
 * Se não houver destinos, usa volume_total como convencional/filtrado
 * conforme produto + fallback (sem destino Tankagem → usa flag do produto
 * apenas quando não há como inferir destino — permanece convencional).
 */
export function expandTransbordoSlices(transbordo, filteredMap) {
  if (!transbordo) return [];
  const produtoFiltrado =
    transbordo.produto_id != null
      ? Boolean(filteredMap.get(String(transbordo.produto_id)))
      : false;
  const dens = parseDensidade(transbordo.densidade);
  const origens = Array.isArray(transbordo.origens) ? transbordo.origens : [];
  const destinos = Array.isArray(transbordo.destinos) ? transbordo.destinos : [];
  const ym = parseDateOnlyYearMonth(transbordo.data);
  if (!ym) return [];

  const operadores = Array.isArray(transbordo.operadores)
    ? transbordo.operadores
    : [];

  if (destinos.length === 0) {
    const vol = roundVolume(parseNumero(transbordo.volume_total));
    if (!(vol > 0)) return [];
    // Sem destinos não há Tankagem/Vasilhame explícito → convencional
    // (não classificar só pela flag do produto).
    return [
      {
        category: CATEGORY.CONVENCIONAL,
        volume: vol,
        year: ym.year,
        month: ym.month,
        day: ym.day,
        operadores,
        source: 'transbordo',
        id: transbordo.id,
      },
    ];
  }

  return destinos
    .map((destino) => {
      const volume = destinoVolumeLitros(destino, origens, dens);
      if (!(volume > 0)) return null;
      return {
        category: classifyTransbordoDestino(destino, produtoFiltrado),
        volume,
        year: ym.year,
        month: ym.month,
        day: ym.day,
        operadores,
        source: 'transbordo',
        id: `${transbordo.id}:${destino.placa || destino.barril || destino.tanka_codigo || ''}`,
      };
    })
    .filter(Boolean);
}

export function expandProductionSlices(production) {
  if (!isFinishedProduction(production)) return [];
  const finish = getProductionFinishDate(production);
  const ym = parseYearMonthDay(finish);
  if (!ym) return [];
  const volume = roundVolume(parseNumero(production.volume));
  if (!(volume > 0)) return [];
  const operator = String(production.operator || '').trim();
  return [
    {
      category: CATEGORY.INDUSTRIALIZADO,
      volume,
      year: ym.year,
      month: ym.month,
      day: ym.day,
      operadores: operator ? [operator] : [],
      source: 'industrializacao',
      id: production.id,
    },
  ];
}

function buildCategoryTotals(slices) {
  const totals = {
    convencional: 0,
    industrializado: 0,
    filtrado: 0,
  };
  for (const s of slices) {
    if (s.category === CATEGORY.CONVENCIONAL) totals.convencional += s.volume;
    else if (s.category === CATEGORY.INDUSTRIALIZADO) totals.industrializado += s.volume;
    else if (s.category === CATEGORY.FILTRADO) totals.filtrado += s.volume;
  }
  totals.convencional = roundVolume(totals.convencional);
  totals.industrializado = roundVolume(totals.industrializado);
  totals.filtrado = roundVolume(totals.filtrado);
  const total = roundVolume(
    totals.convencional + totals.industrializado + totals.filtrado
  );
  return { ...totals, total };
}

function buildDistribution(totals) {
  const total = totals.total || 0;
  return [
    {
      key: CATEGORY.CONVENCIONAL,
      name: 'Convencional',
      volume: totals.convencional,
    },
    {
      key: CATEGORY.INDUSTRIALIZADO,
      name: 'Industrializado',
      volume: totals.industrializado,
    },
    {
      key: CATEGORY.FILTRADO,
      name: 'Filtrado',
      volume: totals.filtrado,
    },
  ].map((item) => ({
    ...item,
    percent: total > 0 ? (item.volume / total) * 100 : 0,
  }));
}

function buildOperatorSeries(slices) {
  const operatorMap = new Map();
  for (const s of slices) {
    for (const { name, volume } of attributeVolumeToOperators(s.operadores, s.volume)) {
      operatorMap.set(name, roundVolume((operatorMap.get(name) || 0) + volume));
    }
  }
  return Array.from(operatorMap.entries())
    .map(([name, volume]) => ({ name, volume }))
    .sort((a, b) => b.volume - a.volume);
}

/**
 * Consolida indicadores.
 * - `monthly`: sempre o ano inteiro (filtro de mês não afeta).
 * - cards / distribuição / operadores / daily: ano + mês quando `month` (0–11) é informado.
 */
export function computePainelTransbordoDashboard({
  transbordos = [],
  producoes = [],
  produtos = [],
  year,
  month = null,
} = {}) {
  const filteredMap = buildFilteredProductMap(produtos);
  const yearSlices = [];

  for (const t of transbordos) {
    for (const s of expandTransbordoSlices(t, filteredMap)) {
      if (s.year === year) yearSlices.push(s);
    }
  }
  for (const p of producoes) {
    for (const s of expandProductionSlices(p)) {
      if (s.year === year) yearSlices.push(s);
    }
  }

  const monthly = emptyMonthBuckets();
  for (const s of yearSlices) {
    const bucket = monthly[s.month];
    if (!bucket) continue;
    bucket[s.category] = roundVolume((bucket[s.category] || 0) + s.volume);
    bucket.total = roundVolume(bucket.total + s.volume);
  }

  const monthIndex =
    month == null || Number.isNaN(Number(month)) ? null : Number(month);
  const periodSlices =
    monthIndex == null
      ? yearSlices
      : yearSlices.filter((s) => s.month === monthIndex);

  const totals = buildCategoryTotals(periodSlices);

  return {
    year,
    month: monthIndex,
    totals: {
      total: totals.total,
      convencional: totals.convencional,
      industrializado: totals.industrializado,
      filtrado: totals.filtrado,
    },
    monthly,
    daily: buildDailySeries(yearSlices, year, monthIndex),
    distribution: buildDistribution(totals),
    operators: buildOperatorSeries(periodSlices),
  };
}

/** Anos disponíveis a partir dos registros carregados. */
export function collectAvailableYears(transbordos = [], producoes = [], fallbackYear) {
  const years = new Set();
  if (fallbackYear) years.add(fallbackYear);
  for (const t of transbordos) {
    const ym = parseDateOnlyYearMonth(t?.data);
    if (ym) years.add(ym.year);
  }
  for (const p of producoes) {
    if (!isFinishedProduction(p)) continue;
    const ym = parseYearMonthDay(getProductionFinishDate(p));
    if (ym) years.add(ym.year);
  }
  const now = new Date().getFullYear();
  for (let y = now; y >= now - 5; y -= 1) years.add(y);
  return Array.from(years).sort((a, b) => b - a);
}
