import { getLatestRecipeForProduct } from '@industrializacao/lib/recipeRevisions';
import { formatOriginalAggregatedLabel, isUnitPackagingLike } from '@industrializacao/lib/packagingTypes';
import { originsOfContainer, originMergeKey, recordBelongsToProduction } from '@industrializacao/lib/containerOrigins';

export const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
};

export const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export const normalizeUnit = (unit) => {
  const u = String(unit || 'kg').trim().toLowerCase();
  if (u === 'l' || u === 'lt' || u === 'litro' || u === 'litros') return 'L';
  if (u === 'kg' || u === 'kgs' || u === 'quilo' || u === 'quilos') return 'kg';
  if (u === 'gal' || u === 'gallon' || u === 'gallons') return 'gal';
  if (u === 'lb' || u === 'lbs') return 'lb';
  return unit || 'kg';
};

export const convertToKg = (value, unit, density) => {
  const d = density || 1;
  switch (normalizeUnit(unit)) {
    case 'kg': return value;
    case 'L': return value * d;
    case 'gal': return value * 3.78541 * d;
    case 'lb': return value * 0.453592;
    default: return value;
  }
};

export const convertFromKg = (kg, unit, density) => {
  const d = density || 1;
  switch (normalizeUnit(unit)) {
    case 'kg': return kg;
    case 'L': return kg / d;
    case 'gal': return kg / (3.78541 * d);
    case 'lb': return kg / 0.453592;
    default: return kg;
  }
};

/** Resolve the live stock row for a production MP line (id first, then lot+code). */
export const resolveStockOf = (mp, stocks) => {
  const list = stocks || [];
  if (!mp) return null;
  if (mp.stock_id) {
    const byId = list.find((x) => x.id === mp.stock_id);
    if (byId) return byId;
  }
  const lot = (mp.lot || '').trim();
  const code = (mp.mp_code || '').trim();
  if (lot && code) {
    return list.find((x) => (x.lot || '').trim() === lot && (x.mp_code || '').trim() === code) || null;
  }
  return null;
};

export const stockUnitOf = (mp, stocks) => {
  const s = resolveStockOf(mp, stocks);
  if (s && s.unit) return normalizeUnit(s.unit);
  if (mp?.unit) return normalizeUnit(mp.unit);
  return 'kg';
};

export const stockDensityOf = (mp, stocks) => {
  const s = resolveStockOf(mp, stocks);
  const fromStock = parseFloat(s?.density);
  if (Number.isFinite(fromStock) && fromStock > 0) return fromStock;
  const fromMp = parseFloat(mp?.density);
  if (Number.isFinite(fromMp) && fromMp > 0) return fromMp;
  return 1;
};

/**
 * Fiscal qty in the CURRENT stock/note unit.
 *
 * Prefers the stored qty_fiscal (valor lançado na OP).
 * Only converts from qty_operational (kg) when the stored fiscal looks like a kg
 * snapshot left behind after a unit change (qty_fiscal ≈ qty_operational while unit ≠ kg).
 */
export const fiscalQtyOf = (mp, stocks) => {
  const unit = stockUnitOf(mp, stocks);
  const dens = stockDensityOf(mp, stocks);
  const opKg = parseFloat(mp?.qty_operational);
  const stored = parseFloat(mp?.qty_fiscal);
  const hasOp = Number.isFinite(opKg);
  const hasStored = Number.isFinite(stored);

  if (normalizeUnit(unit) === 'kg') {
    return round3(hasStored ? stored : (hasOp ? opKg : 0));
  }

  // Gravado em kg e a nota hoje está em L/gal/lb → converte.
  if (hasOp && hasStored && Math.abs(stored - opKg) <= 0.0005) {
    return round3(convertFromKg(opKg, unit, dens));
  }

  if (hasStored) return round3(stored);
  if (hasOp) return round3(convertFromKg(opKg, unit, dens));
  return 0;
};

export const liveLotOf = (mp, stocks) => {
  const s = resolveStockOf(mp, stocks);
  if (s && s.lot) return s.lot;
  return mp?.lot;
};

export const stockUnitPriceOf = (mp, stocks) => {
  const s = resolveStockOf(mp, stocks);
  if (s) return s.unit_price || 0;
  return 0;
};

function sumDistinctInitialVolumes(origins) {
  const map = new Map();
  for (const o of origins || []) {
    const key = originMergeKey(o) || o.id || `row:${map.size}`;
    const iv = parseFloat(o.initial_volume) || 0;
    map.set(key, Math.max(map.get(key) || 0, iv));
  }
  return [...map.values()].reduce((s, v) => s + v, 0);
}

/** Volume inicial do envase deste container (preferência: origens da OP). */
export function initialVolumeForProductionPackaging(container, origins = [], production = null) {
  if (!container?.id) return 0;
  const all = originsOfContainer(origins, container.id).filter((o) => !o._legacy);
  if (all.length === 0) return 0;
  const forProd = all.filter((o) => recordBelongsToProduction(o, production));
  return sumDistinctInitialVolumes(forProd.length ? forProd : all);
}

/**
 * Embalagens que receberam o produto na OP — quantidade envasada, não saldo de pátio.
 */
export function formatContainerPackagingForProduction(container, production, origins = []) {
  if (!container) return production?.packaging_info || production?.packaging_type || '';
  if (!isUnitPackagingLike(container.type, container.container_number)) {
    return container.container_number || production?.packaging_type || '';
  }
  return formatOriginalAggregatedLabel(container, {
    initialVolume: initialVolumeForProductionPackaging(container, origins, production),
    productionVolume: production?.volume,
  }) || container.container_number || production?.packaging_type || '';
}

export const uniqueContainersFromPackagingRows = (rows) => {
  const list = [];
  const seen = new Set();
  for (const r of rows || []) {
    if (r.container?.id && !seen.has(r.container.id)) {
      seen.add(r.container.id);
      list.push(r.container);
    }
  }
  return list;
};

/**
 * Vasilhames vinculados ao lote da OP (inclui destinos de transbordo).
 * Fallback sem lote: production_id ou op_number originais.
 */
export const containersOfProductionLot = (containers, production) => {
  if (!production || !containers?.length) return [];

  const lot = (production.lot || '').trim();
  let matched;
  if (lot) {
    matched = containers.filter(c => (c.lot || '').trim() === lot);
  } else {
    matched = containers.filter(c =>
      (production.id && c.production_id === production.id)
      || (production.op_number && c.op_number === production.op_number)
    );
  }

  const seen = new Set();
  const unique = [];
  for (const c of matched) {
    const key = c.id || `${c.container_number || ''}|${c.barril_number || ''}|${c.op_number || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  // Sequência de envase: registration_id crescente (atribuído na ordem do envase / TB).
  // Fallback: created_date; sem ambos, vão para o fim.
  return unique.sort((a, b) => {
    const ra = a.registration_id != null && a.registration_id !== '' ? Number(a.registration_id) : NaN;
    const rb = b.registration_id != null && b.registration_id !== '' ? Number(b.registration_id) : NaN;
    const aHasReg = Number.isFinite(ra);
    const bHasReg = Number.isFinite(rb);
    if (aHasReg && bHasReg && ra !== rb) return ra - rb;
    if (aHasReg !== bHasReg) return aHasReg ? -1 : 1;

    const ta = a.created_date ? new Date(a.created_date).getTime() : NaN;
    const tb = b.created_date ? new Date(b.created_date).getTime() : NaN;
    const aHasDate = Number.isFinite(ta);
    const bHasDate = Number.isFinite(tb);
    if (aHasDate && bHasDate && ta !== tb) return ta - tb;
    if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;

    return String(a.container_number || '').localeCompare(String(b.container_number || ''));
  });
};

/** Destino de transbordo (vasilhame criado em TB…). */
export const isTransferDestinationContainer = (c) =>
  Boolean(c?.op_number && String(c.op_number).startsWith('TB'));

export const resolveProductDensity = (production, container, recipes = []) => {
  const fromProd = parseFloat(production?.density);
  if (Number.isFinite(fromProd) && fromProd > 0) return fromProd;
  const product = container?.product || production?.product;
  const recipe = getLatestRecipeForProduct(recipes, product);
  const fromRecipe = parseFloat(recipe?.density);
  if (Number.isFinite(fromRecipe) && fromRecipe > 0) return fromRecipe;
  return null;
};

/**
 * Peso líquido alinhado ao saldo atual (volume × densidade).
 * Após transbordo o volume é atualizado, mas net_weight armazenado pode permanecer estagnado.
 */
export const containerLiveNetWeight = (container, production, recipes = []) => {
  const volume = parseFloat(container?.volume) || 0;
  if (volume <= 0) return 0;
  const dens = resolveProductDensity(production, container, recipes);
  if (dens) return Math.round(volume * dens);
  return Math.round(parseFloat(container?.net_weight) || 0);
};

export const containerLiveGrossWeight = (container, production, recipes = []) => {
  const net = containerLiveNetWeight(container, production, recipes);
  return Math.round(net + (parseFloat(container?.tare) || 0));
};
