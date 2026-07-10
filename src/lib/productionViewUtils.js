export const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
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
