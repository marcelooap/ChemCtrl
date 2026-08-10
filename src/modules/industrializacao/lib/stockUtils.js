export const calcPackagingQty = (stock, capacity) => {
  const s = parseFloat(stock) || 0;
  const c = parseFloat(capacity) || 0;
  return c > 0 ? Math.round((s / c) * 100) / 100 : 0;
};
