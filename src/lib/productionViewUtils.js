export const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
};

export const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export const convertToKg = (value, unit, density) => {
  const d = density || 1;
  switch (unit) {
    case 'kg': return value;
    case 'L': return value * d;
    case 'gal': return value * 3.78541 * d;
    case 'lb': return value * 0.453592;
    default: return value;
  }
};

export const convertFromKg = (kg, unit, density) => {
  const d = density || 1;
  switch (unit) {
    case 'kg': return kg;
    case 'L': return kg / d;
    case 'gal': return kg / (3.78541 * d);
    case 'lb': return kg / 0.453592;
    default: return kg;
  }
};

export const stockUnitOf = (mp, stocks) => {
  if (mp.stock_id) {
    const s = (stocks || []).find(x => x.id === mp.stock_id);
    if (s && s.unit) return s.unit;
  }
  return 'kg';
};

export const liveLotOf = (mp, stocks) => {
  if (mp.stock_id) {
    const s = (stocks || []).find(x => x.id === mp.stock_id);
    if (s && s.lot) return s.lot;
  }
  return mp.lot;
};

export const stockUnitPriceOf = (mp, stocks) => {
  if (mp.stock_id) {
    const s = (stocks || []).find(x => x.id === mp.stock_id);
    if (s) return s.unit_price || 0;
  }
  return 0;
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
  const recipe = (recipes || []).find((r) => r.product_name === product);
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
