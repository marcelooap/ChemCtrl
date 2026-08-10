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

/** Prefixo usado em rótulos legados (ex.: "IBC 1/5"). */
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

/**
 * Rótulo agregado persistido em container_number (sem coluna nova).
 * Exemplos: "05 x IBC - 1.000 L", "20 x Tambor 200 L"
 */
export function formatAggregatedContainerLabel(qty, type) {
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  const padded = String(n).padStart(2, '0');
  if (type === 'IBC – 1.000 L') return `${padded} x IBC - 1.000 L`;
  if (type === 'Tambor 200 L') return `${padded} x Tambor 200 L`;
  return `${padded} x ${getUnitPackagingLabel(type)}`;
}

/** Extrai a quantidade de um rótulo agregado; null se não for agregado. */
export function parseAggregatedPackageQty(containerNumber) {
  if (!containerNumber) return null;
  const match = String(containerNumber).trim().match(/^(\d+)\s*x\s+/i);
  if (!match) return null;
  const qty = parseInt(match[1], 10);
  return Number.isFinite(qty) && qty >= 1 ? qty : null;
}

/** True quando o registro é lote agregado Tambor/IBC (novo modelo). */
export function isAggregatedUnitContainer(container) {
  if (!container || !isUnitPackagingType(container.type)) return false;
  return parseAggregatedPackageQty(container.container_number) != null;
}

/** Quantidade física representada pelo registro (1 para Contentor/Tankagem/legado). */
export function getContainerPackageQty(container) {
  if (!container) return 1;
  if (!isUnitPackagingType(container.type)) return 1;
  const parsed = parseAggregatedPackageQty(container.container_number);
  return parsed != null ? parsed : 1;
}
