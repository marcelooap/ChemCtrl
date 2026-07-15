export const PACKAGING_TYPES = ['Contentor', 'IBC – 1.000 L', 'Tambor 200 L', 'Tankagem'];

/** Capacidade nominal (L) para tipos que geram um vasilhame por embalagem física. */
export const UNIT_PACKAGING_CAPACITY = {
  'IBC – 1.000 L': 1000,
  'Tambor 200 L': 200,
};

export function isUnitPackagingType(type) {
  return Object.prototype.hasOwnProperty.call(UNIT_PACKAGING_CAPACITY, type);
}

export function getUnitPackagingCapacity(type) {
  return UNIT_PACKAGING_CAPACITY[type] ?? null;
}

/** Prefixo usado em Nº Placa gerado automaticamente (ex.: "IBC 1/5"). */
export function getUnitPackagingLabel(type) {
  if (type === 'IBC – 1.000 L') return 'IBC';
  if (type === 'Tambor 200 L') return 'Tambor';
  return 'Emb';
}

/** Quantidade sugerida: ceil(volume / capacidade). */
export function suggestPackageQty(type, volume) {
  const capacity = getUnitPackagingCapacity(type);
  if (!capacity) return 1;
  const vol = parseFloat(volume) || 0;
  if (vol <= 0) return 1;
  return Math.ceil(vol / capacity);
}
