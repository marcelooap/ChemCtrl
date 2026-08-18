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

const UNIT_PACKAGING_HINT = /ibc|tambor|bombona|one\s*way/i;

/**
 * IBC / tambor / bombona — inclusive tipos legados e placas agregadas ("02 x IBC").
 */
export function isUnitPackagingLike(type, containerNumber = '') {
  if (isUnitPackagingType(type)) return true;
  if (UNIT_PACKAGING_HINT.test(String(type || ''))) return true;
  const plate = String(containerNumber || '');
  return /^\d+\s*x\s+/i.test(plate.trim()) && UNIT_PACKAGING_HINT.test(plate);
}

/** Volume informado pelo usuário na etiqueta (IBC, tambor, bombona). */
export function labelRequiresManualVolume(container) {
  if (!container) return false;
  return isUnitPackagingLike(
    container.type || container.tipo,
    container.container_number || container.placa,
  );
}

/** Remove o prefixo "02 x " da placa agregada. */
export function stripAggregatedQtyPrefix(label) {
  return String(label || '').replace(/^\d+\s*x\s+/i, '').trim();
}

/** Texto de embalagem na etiqueta (uma unidade, sem quantidade agregada). */
export function formatLabelEmbalagem(container) {
  const plate = container?.container_number || container?.placa || '';
  const barril = container?.barril_number || container?.barril || '';
  if (isUnitPackagingLike(container?.type || container?.tipo, plate)) {
    return stripAggregatedQtyPrefix(plate) || plate || '—';
  }
  return barril ? `${plate} (${barril})` : (plate || '—');
}

/** Placeholder de volume (L) para IBC / tambor / bombona. */
export function suggestLabelVolumePlaceholder(type) {
  const cap = getUnitPackagingCapacity(type);
  if (cap) return cap;
  const match = String(type || '').match(/(\d+(?:[.,]\d+)?)\s*l\b/i);
  if (!match) return '';
  const n = Number(String(match[1]).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : '';
}

/** Líquido = volume × densidade; bruto = líquido + tara. Pesos em kg inteiros. */
export function calcLabelWeightsFromVolume({ volume, density, tare }) {
  const vol = Number(volume) || 0;
  const dens = Number(density) || 0;
  const tareKg = Number(tare) || 0;
  const net = Math.round(vol * dens);
  return {
    volume: vol,
    netWeight: net,
    grossWeight: Math.round(vol * dens + tareKg),
  };
}
