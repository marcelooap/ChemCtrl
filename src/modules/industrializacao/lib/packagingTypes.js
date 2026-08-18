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
 * Usado na etiqueta para não depender do valor exato de `type`.
 */
export function isUnitPackagingLike(type, containerNumber = '') {
  if (isUnitPackagingType(type)) return true;
  if (UNIT_PACKAGING_HINT.test(String(type || ''))) return true;
  const plate = String(containerNumber || '');
  return /^\d+\s*x\s+/i.test(plate.trim()) && UNIT_PACKAGING_HINT.test(plate);
}

/** Remove o prefixo "02 x " da placa agregada. */
export function stripAggregatedQtyPrefix(label) {
  return String(label || '').replace(/^\d+\s*x\s+/i, '').trim();
}

/**
 * Quantidade de embalagens físicas para a etiqueta (placa, tipo, ou campo explícito).
 */
export function getLabelPackageQty(container) {
  if (!container) return 1;
  const plate = container.container_number || container.placa || '';
  const type = container.type || container.tipo || '';
  if (!isUnitPackagingLike(type, plate)) return 1;

  const fromPlate = parseAggregatedPackageQty(plate);
  if (fromPlate != null) return fromPlate;

  const fromField = Number(container.quantidade_embalagens);
  if (Number.isFinite(fromField) && fromField >= 1) return Math.round(fromField);

  const fromComp = Array.isArray(container.composicao)
    ? container.composicao.find((c) => Number(c.quantidade_embalagens) > 0)?.quantidade_embalagens
    : null;
  if (Number(fromComp) >= 1) return Math.round(Number(fromComp));

  return getContainerPackageQty(container);
}

/**
 * Métricas por unidade física para etiqueta de IBC / tambor / bombona.
 * Líquido = total ÷ qtd; bruto = líquido unitário + tara (por embalagem).
 * copies = qtd para gerar uma etiqueta por embalagem no pátio.
 */
export function resolveUnitLabelMetrics(container, options = {}) {
  const plate = container?.container_number || container?.placa || '';
  const type = container?.type || container?.tipo || '';
  const requestedQty = Number(options.packageQty);
  const qty = Math.max(
    1,
    (Number.isFinite(requestedQty) && requestedQty >= 1)
      ? Math.round(requestedQty)
      : getLabelPackageQty(container),
  );
  const totalNet = Number(container?.net_weight) || 0;
  const totalGross = Number(container?.gross_weight) || 0;
  const tare = Number(container?.tare ?? container?.tara) || 0;
  const totalVol = Number(container?.volume ?? options.volume) || 0;
  const barril = container?.barril_number || container?.barril || '';
  const fullEmbalagem = barril ? `${plate} (${barril})` : (plate || '—');
  const unitLike = isUnitPackagingLike(type, plate);

  if (qty <= 1 || !unitLike) {
    return {
      qty: 1,
      copies: 1,
      netWeight: totalNet,
      grossWeight: totalGross,
      volume: totalVol,
      embalagem: fullEmbalagem,
    };
  }

  const unitNet = totalNet / qty;
  const unitTypeLabel = stripAggregatedQtyPrefix(plate);
  return {
    qty,
    copies: qty,
    netWeight: unitNet,
    grossWeight: unitNet + tare,
    volume: totalVol > 0 ? totalVol / qty : 0,
    embalagem: unitTypeLabel || fullEmbalagem,
  };
}
